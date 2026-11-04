import { DataSource, EntityManager, Repository, IsNull, In } from 'typeorm';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppDataSource } from '../../../database/data-source.js';
import {
  CommitTemplateEditingSessionDto,
  TemplateEditingOperationDto,
} from './dto/commit-template-editing-session.dto.js';
import {
  ProductionTemplateChangeClassifier,
  productionTemplateChangeClassifier,
  TemplateChangeClassification,
} from './production-template-change-classifier.js';
import { ProductionTemplateEditingNormalizer } from './production-template-editing-normalizer.js';
import { ProductionTemplateEditingIdempotencyEntity } from './production-template-editing-idempotency.entity.js';
import { ProductionTemplateUploadTokenEntity } from './production-template-upload-token.entity.js';
import {
  ProductionTemplateVersionCloner,
  productionTemplateVersionCloner,
} from './production-template-version-cloner.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from '../template/production-template-guard.service.js';
import {
  ProductionTemplateSharedFileService,
  productionTemplateSharedFileService,
} from '../template/production-template-shared-file.service.js';
import {
  ProductionDepartmentService,
  productionDepartmentService,
} from '../department/production-department.service.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import {
  ProductionTemplateFileCleanupQueueEntity,
  FileCleanupStatus,
} from '../template-stored-file/production-template-file-cleanup-queue.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { resolveTaskDuration } from '../task-duration/task-duration.helper.js';

export interface CommitEditingSessionResult {
  templateId: string;
  targetVersionId: string;
  targetVersionNumber: string;
  createdNewVersion: boolean;
  changeType: TemplateChangeClassification;
  appliedOperationsCount: number;
  tempClientMap: Record<string, string>;
}

export class ProductionTemplateEditingService {
  private classifier: ProductionTemplateChangeClassifier;
  private normalizer: ProductionTemplateEditingNormalizer;
  private cloner: ProductionTemplateVersionCloner;
  private versionService: ProductionTemplateVersionService;
  private guardService: ProductionTemplateGuardService;
  private sharedFileService: ProductionTemplateSharedFileService;
  private departmentService: ProductionDepartmentService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    classifier: ProductionTemplateChangeClassifier = productionTemplateChangeClassifier,
    cloner: ProductionTemplateVersionCloner = productionTemplateVersionCloner,
    versionService: ProductionTemplateVersionService = productionTemplateVersionService,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    sharedFileService: ProductionTemplateSharedFileService = productionTemplateSharedFileService,
    deptService: ProductionDepartmentService = productionDepartmentService,
    normalizer: ProductionTemplateEditingNormalizer = new ProductionTemplateEditingNormalizer()
  ) {
    this.classifier = classifier;
    this.normalizer = normalizer;
    this.cloner = cloner;
    this.versionService = versionService;
    this.guardService = guardService;
    this.sharedFileService = sharedFileService;
    this.departmentService = deptService;
  }

  /**
   * Commits an atomic editing session containing multiple operations in a single transaction.
   * Auto-classifies changes as STRUCTURAL vs MINOR and forks a new version if needed.
   * Executes ONLY normalized net operations and returns cleanly for zero-diff requests.
   */
  async commitEditingSession(
    templateId: string,
    dto: CommitTemplateEditingSessionDto,
    userId?: string
  ): Promise<CommitEditingSessionResult> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template aggregate root
      const template = await this.guardService.lockMutableTemplate(templateId, manager);

      // Compute request fingerprint hash for safe idempotency
      const requestFingerprint = {
        templateId,
        baseVersionId: dto.baseVersionId,
        baseRevision: dto.baseRevision,
        commitDecision: dto.commitDecision || 'AUTO',
        operations: dto.operations,
        userId: userId || null,
      };
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(requestFingerprint))
        .digest('hex');

      // 2. Idempotency check FIRST (retries return stored result immediately)
      if (dto.idempotencyKey) {
        const idempotencyRepo = manager.getRepository(ProductionTemplateEditingIdempotencyEntity);
        const existing = await idempotencyRepo.findOne({
          where: { templateId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          if (existing.userId && userId && existing.userId !== userId) {
            throw new BusinessRuleError(
              'مفتاح عدم التكرار (Idempotency) مرتبط بمستخدم آخر ولا يمكن استخدامه',
              'IDEMPOTENCY_USER_MISMATCH'
            );
          }
          if (existing.requestHash && existing.requestHash !== requestHash) {
            throw new BusinessRuleError(
              'تم استخدام نفس مفتاح عدم التكرار (Idempotency) مع طلب مختلف',
              'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'
            );
          }
          try {
            return JSON.parse(existing.responseJson) as CommitEditingSessionResult;
          } catch {
            throw new BusinessRuleError(
              'الاستجابة المخزنة لمفتاح عدم التكرار تالفة',
              'IDEMPOTENCY_RESPONSE_CORRUPTED'
            );
          }
        }
      }

      // 3. Validate baseVersionId is latest active version
      const baseVersion = await this.versionService.assertIsLatestVersion(
        templateId,
        dto.baseVersionId,
        manager
      );

      // 4. Mandatory concurrency check: baseRevision
      if (!dto.baseRevision || typeof dto.baseRevision !== 'string' || !/^[a-f0-9]{64}$/i.test(dto.baseRevision)) {
        throw new BusinessRuleError(
          'مراجعة الإصدار الأساسية (baseRevision) مطلوبة ويجب أن تكون تجزئة SHA-256 صالحة',
          'PRODUCTION_TEMPLATE_REVISION_REQUIRED'
        );
      }

      const currentRevision = await this.versionService.computeVersionRevision(
        templateId,
        baseVersion.id,
        manager
      );
      if (currentRevision !== dto.baseRevision) {
        throw new BusinessRuleError(
          'تم تعديل هذا القالب بواسطة مستخدم آخر أو جلسة أخرى. يرجى تحديث الصفحة والمحاولة مجدداً.',
          'PRODUCTION_TEMPLATE_CONCURRENT_EDIT_CONFLICT'
        );
      }

      // 5. Semantic diff normalization against baseline
      const normResult = await this.normalizer.normalizeAndClassify(
        templateId,
        baseVersion.id,
        dto.operations,
        manager
      );

      // 6. If no effective changes (diff is NONE), return early with clean result (no DB writes, no version, no tokens consumed)
      if (normResult.classification === 'NONE' || !normResult.hasEffectiveChanges) {
        const cleanResult: CommitEditingSessionResult = {
          templateId,
          targetVersionId: baseVersion.id,
          targetVersionNumber: baseVersion.version,
          createdNewVersion: false,
          changeType: 'NONE',
          appliedOperationsCount: 0,
          tempClientMap: {},
        };

        if (dto.idempotencyKey) {
          const idempotencyRepo = manager.getRepository(ProductionTemplateEditingIdempotencyEntity);
          const record = idempotencyRepo.create({
            id: crypto.randomUUID(),
            templateId,
            idempotencyKey: dto.idempotencyKey,
            requestHash,
            userId: userId || null,
            responseJson: JSON.stringify(cleanResult),
          });
          await idempotencyRepo.save(record);
        }

        return cleanResult;
      }

      // 7. Determine if we must fork a new version
      let shouldCreateNewVersion = false;
      if (normResult.classification === 'STRUCTURAL') {
        if (dto.commitDecision === 'OVERWRITE_CURRENT') {
          throw new BusinessRuleError(
            'التغييرات الهيكلية في بنية القالب تتطلب إنشاء إصدار جديد حتماً ولا يمكن التعديل المباشر على الإصدار الحالي',
            'PRODUCTION_TEMPLATE_STRUCTURAL_CHANGE_REQUIRES_NEW_VERSION'
          );
        }
        // 'AUTO' or 'NEW_VERSION' both fork a new version for STRUCTURAL
        shouldCreateNewVersion = true;
      } else if (normResult.classification === 'MINOR') {
        if (dto.commitDecision === 'NEW_VERSION') {
          shouldCreateNewVersion = true;
        } else {
          // 'OVERWRITE_CURRENT' or 'AUTO' updates current version in place
          shouldCreateNewVersion = false;
        }
      }

      let targetVersionId = baseVersion.id;
      let targetVersionNumber = baseVersion.version;
      const idMap = new Map<string, string>(); // Cloned IDs map: oldId -> newId
      const tempClientMap: Record<string, string> = {}; // Client IDs map: tempClientId -> newDbId

      // 8. Fork new version if required
      if (shouldCreateNewVersion) {
        const nextVersionEntity = await this.versionService.createNextVersion(templateId, manager);
        targetVersionId = nextVersionEntity.id;
        targetVersionNumber = nextVersionEntity.version;

        // Deep clone entire template graph from baseVersion to nextVersion
        const cloneRes = await this.cloner.cloneVersion(
          templateId,
          baseVersion.id,
          targetVersionId,
          manager
        );

        for (const [oldId, newId] of cloneRes.idMap.entries()) {
          idMap.set(oldId, newId);
        }
      }

      // Helper to resolve an ID (checks tempClientMap first, then idMap for cloned IDs, then original)
      const resolveId = (idOrTemp?: string): string => {
        if (!idOrTemp) return '';
        if (tempClientMap[idOrTemp]) return tempClientMap[idOrTemp];
        if (idMap.has(idOrTemp)) return idMap.get(idOrTemp)!;
        return idOrTemp;
      };

      // 9. Apply ONLY normalized operations sequentially
      for (const op of normResult.normalizedOperations) {
        await this.applySingleOperation(
          templateId,
          targetVersionId,
          op,
          manager,
          resolveId,
          tempClientMap,
          userId
        );
      }

      // 10. Ensure workflow dense compactor on target version
      await this.ensureWorkflowDenseCompacted(templateId, targetVersionId, manager);

      const result: CommitEditingSessionResult = {
        templateId,
        targetVersionId,
        targetVersionNumber,
        createdNewVersion: shouldCreateNewVersion,
        changeType: normResult.classification,
        appliedOperationsCount: normResult.normalizedOperations.length,
        tempClientMap,
      };

      // 11. Persist idempotency result if key was provided
      if (dto.idempotencyKey) {
        const idempotencyRepo = manager.getRepository(ProductionTemplateEditingIdempotencyEntity);
        const record = idempotencyRepo.create({
          id: crypto.randomUUID(),
          templateId,
          idempotencyKey: dto.idempotencyKey,
          requestHash,
          userId: userId || null,
          responseJson: JSON.stringify(result),
        });
        await idempotencyRepo.save(record);
      }

      return result;
    });
  }

  /**
   * Previews an atomic editing session without committing any changes to the database.
   * Runs the exact same semantic diff normalizer logic used during commit.
   */
  async previewEditingSession(
    templateId: string,
    dto: CommitTemplateEditingSessionDto,
    userId?: string
  ): Promise<{
    classification: 'STRUCTURAL' | 'MINOR' | 'NONE';
    effectiveChangesCount: number;
    summary: string;
    reasons: string[];
    isNewVersionMandatory: boolean;
    allowsOverwrite: boolean;
    conflicts: string[];
  }> {
    const manager = this.dataSource.manager;

    // 1. Verify template exists
    await this.guardService.requireExistingTemplate(templateId, manager);

    // 2. Assert latest version
    const baseVersion = await this.versionService.assertIsLatestVersion(
      templateId,
      dto.baseVersionId,
      manager
    );

    // 3. Concurrency check
    const currentRevision = await this.versionService.computeVersionRevision(
      templateId,
      baseVersion.id,
      manager
    );
    const conflicts: string[] = [];
    if (dto.baseRevision && currentRevision !== dto.baseRevision) {
      conflicts.push('تم تعديل هذا القالب بالتزامن من قبل مستخدم آخر');
    }

    // 4. Normalize and classify
    const normResult = await this.normalizer.normalizeAndClassify(
      templateId,
      baseVersion.id,
      dto.operations,
      manager
    );

    const isNewVersionMandatory = normResult.classification === 'STRUCTURAL';
    const allowsOverwrite = normResult.classification === 'MINOR';
    const summary =
      normResult.classification === 'STRUCTURAL'
        ? 'تتضمن الجلسة تغييرات هيكلية تتطلب حتماً إنشاء إصدار جديد للقالب'
        : normResult.classification === 'MINOR'
        ? 'تتضمن الجلسة تغييرات وصفية طفيفة يمكن حفظها في الإصدار الحالي أو إنشاء إصدار جديد'
        : 'لا توجد أي تغييرات صافية فعالة في هذه الجلسة';

    return {
      classification: normResult.classification,
      effectiveChangesCount: normResult.normalizedOperations.length,
      summary,
      reasons: normResult.reasons,
      isNewVersionMandatory,
      allowsOverwrite,
      conflicts,
    };
  }

  /**
   * Applies a single atomic operation inside the transaction.
   */
  private async applySingleOperation(
    templateId: string,
    versionId: string,
    op: TemplateEditingOperationDto,
    manager: EntityManager,
    resolveId: (id?: string) => string,
    tempClientMap: Record<string, string>,
    userId?: string
  ): Promise<void> {
    const stageRepo = manager.getRepository(ProductionTemplateStageEntity);
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const optionRepo = manager.getRepository(ProductionTemplatePatternOptionEntity);
    const taskRepo = manager.getRepository(ProductionTemplatePatternOptionTaskEntity);
    const workflowRepo = manager.getRepository(ProductionTemplateWorkflowItemEntity);
    const specRepo = manager.getRepository(ProductionTemplateSpecificationEntity);

    switch (op.type) {
      // ----------------------------------------------------
      // STAGES
      // ----------------------------------------------------
      case 'ADD_STAGE': {
        const payload = op.payload || {};
        await this.departmentService.validateDepartmentForStage(payload.departmentId);

        const duration = resolveTaskDuration(payload);
        const newStageId = crypto.randomUUID();
        const stage = stageRepo.create({
          id: newStageId,
          templateId,
          versionId,
          departmentId: payload.departmentId,
          name: (payload.name || '').trim(),
          description: payload.description ? payload.description.trim() : null,
          estimatedDurationValue: duration.estimatedDurationValue,
          estimatedDurationUnit: duration.estimatedDurationUnit,
          estimatedDurationMinutes: duration.estimatedDurationMinutes,
          estimatedCost: payload.estimatedCost || null,
        });
        await stageRepo.save(stage);

        if (op.tempClientId) {
          tempClientMap[op.tempClientId] = newStageId;
        }

        // Add to workflow
        const activeItems = await workflowRepo.find({
          where: { templateId, versionId, deletedAt: IsNull() },
          order: { sortOrder: 'ASC' },
        });
        const nextOrder = activeItems.length > 0 ? activeItems[activeItems.length - 1].sortOrder + 1 : 1;

        const wfItem = workflowRepo.create({
          id: crypto.randomUUID(),
          templateId,
          versionId,
          itemType: 'STAGE',
          stageId: newStageId,
          patternId: null,
          sortOrder: nextOrder,
        });
        await workflowRepo.save(wfItem);
        break;
      }

      case 'UPDATE_STAGE': {
        const stageId = resolveId(op.targetId);
        const stage = await stageRepo.findOne({
          where: { id: stageId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!stage) {
          throw new BusinessRuleError(`المرحلة المستهدفة للتعديل غير موجودة: ${stageId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.departmentId !== undefined) {
          await this.departmentService.validateDepartmentForStage(payload.departmentId);
          stage.departmentId = payload.departmentId;
        }
        if (payload.name !== undefined) stage.name = payload.name.trim();
        if (payload.description !== undefined) stage.description = payload.description ? payload.description.trim() : null;
        if (
          payload.estimatedDurationValue !== undefined ||
          payload.estimatedDurationUnit !== undefined ||
          payload.estimatedDurationMinutes !== undefined
        ) {
          const duration = resolveTaskDuration(payload, {
            estimatedDurationValue: stage.estimatedDurationValue,
            estimatedDurationUnit: stage.estimatedDurationUnit,
            estimatedDurationMinutes: stage.estimatedDurationMinutes,
          });
          stage.estimatedDurationValue = duration.estimatedDurationValue;
          stage.estimatedDurationUnit = duration.estimatedDurationUnit;
          stage.estimatedDurationMinutes = duration.estimatedDurationMinutes;
        }
        if (payload.estimatedCost !== undefined) stage.estimatedCost = payload.estimatedCost;

        await stageRepo.save(stage);
        break;
      }

      case 'DELETE_STAGE': {
        const stageId = resolveId(op.targetId);
        const stage = await stageRepo.findOne({
          where: { id: stageId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!stage) {
          throw new BusinessRuleError(`المرحلة المستهدفة للحذف غير موجودة أو لا تنتمي لهذا الإصدار: ${stageId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
        }
        await stageRepo.softDelete({ id: stageId, templateId, versionId });
        await workflowRepo.softDelete({ stageId, templateId, versionId });
        break;
      }

      // ----------------------------------------------------
      // PATTERNS
      // ----------------------------------------------------
      case 'ADD_PATTERN': {
        const payload = op.payload || {};
        const newPatternId = crypto.randomUUID();
        const pattern = patternRepo.create({
          id: newPatternId,
          templateId,
          versionId,
          name: (payload.name || '').trim(),
        });
        await patternRepo.save(pattern);

        if (op.tempClientId) {
          tempClientMap[op.tempClientId] = newPatternId;
        }

        // Add to workflow
        const activeItems = await workflowRepo.find({
          where: { templateId, versionId, deletedAt: IsNull() },
          order: { sortOrder: 'ASC' },
        });
        const nextOrder = activeItems.length > 0 ? activeItems[activeItems.length - 1].sortOrder + 1 : 1;

        const wfItem = workflowRepo.create({
          id: crypto.randomUUID(),
          templateId,
          versionId,
          itemType: 'PATTERN',
          stageId: null,
          patternId: newPatternId,
          sortOrder: nextOrder,
        });
        await workflowRepo.save(wfItem);
        break;
      }

      case 'UPDATE_PATTERN': {
        const patternId = resolveId(op.targetId);
        const pattern = await patternRepo.findOne({
          where: { id: patternId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!pattern) {
          throw new BusinessRuleError(`النمط المستهدف للتعديل غير موجود أو لا ينتمي لهذا الإصدار: ${patternId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.name !== undefined) pattern.name = payload.name.trim();
        await patternRepo.save(pattern);
        break;
      }

      case 'DELETE_PATTERN': {
        const patternId = resolveId(op.targetId);
        const pattern = await patternRepo.findOne({
          where: { id: patternId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!pattern) {
          throw new BusinessRuleError(`النمط المستهدف للحذف غير موجود أو لا ينتمي لهذا الإصدار: ${patternId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
        }
        await patternRepo.softDelete({ id: patternId, templateId, versionId });
        await workflowRepo.softDelete({ patternId, templateId, versionId });
        break;
      }

      // ----------------------------------------------------
      // OPTIONS
      // ----------------------------------------------------
      case 'ADD_OPTION': {
        const patternId = resolveId(op.parentId);
        const pattern = await patternRepo.findOne({
          where: { id: patternId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!pattern) {
          throw new BusinessRuleError(`النمط الأب غير موجود أو لا ينتمي لهذا الإصدار: ${patternId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
        }

        const payload = op.payload || {};
        const activeOptions = await optionRepo.find({
          where: { patternId, deletedAt: IsNull() },
          order: { sortOrder: 'ASC' },
        });
        const nextOrder = activeOptions.length > 0 ? activeOptions[activeOptions.length - 1].sortOrder + 1 : 1;

        const newOptionId = crypto.randomUUID();
        const option = optionRepo.create({
          id: newOptionId,
          patternId,
          name: (payload.name || '').trim(),
          sortOrder: payload.sortOrder || nextOrder,
        });
        await optionRepo.save(option);

        if (op.tempClientId) {
          tempClientMap[op.tempClientId] = newOptionId;
        }
        break;
      }

      case 'UPDATE_OPTION': {
        const optionId = resolveId(op.targetId);
        const option = await optionRepo.findOne({
          where: { id: optionId, deletedAt: IsNull() },
          relations: { pattern: true },
        });
        if (
          !option ||
          !option.pattern ||
          option.pattern.deletedAt ||
          option.pattern.templateId !== templateId ||
          option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`الخيار المستهدف للتعديل غير موجود أو لا ينتمي لهذا الإصدار: ${optionId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.name !== undefined) option.name = payload.name.trim();
        await optionRepo.save(option);
        break;
      }

      case 'DELETE_OPTION': {
        const optionId = resolveId(op.targetId);
        const option = await optionRepo.findOne({
          where: { id: optionId, deletedAt: IsNull() },
          relations: { pattern: true },
        });
        if (
          !option ||
          !option.pattern ||
          option.pattern.deletedAt ||
          option.pattern.templateId !== templateId ||
          option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`الخيار المستهدف للحذف غير موجود أو لا ينتمي لهذا الإصدار: ${optionId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
        }
        await optionRepo.softDelete(optionId);
        break;
      }

      // ----------------------------------------------------
      // TASKS
      // ----------------------------------------------------
      case 'ADD_TASK': {
        const optionId = resolveId(op.parentId);
        const option = await optionRepo.findOne({
          where: { id: optionId, deletedAt: IsNull() },
          relations: { pattern: true },
        });
        if (
          !option ||
          !option.pattern ||
          option.pattern.deletedAt ||
          option.pattern.templateId !== templateId ||
          option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`خيار النمط الأب غير موجود أو لا ينتمي لهذا الإصدار: ${optionId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
        }

        const payload = op.payload || {};
        await this.departmentService.validateDepartmentForStage(payload.departmentId);

        const duration = resolveTaskDuration(payload);
        const activeTasks = await taskRepo.find({
          where: { optionId, deletedAt: IsNull() },
          order: { sortOrder: 'ASC' },
        });
        const nextOrder = activeTasks.length > 0 ? activeTasks[activeTasks.length - 1].sortOrder + 1 : 1;

        const newTaskId = crypto.randomUUID();
        const task = taskRepo.create({
          id: newTaskId,
          optionId,
          departmentId: payload.departmentId,
          name: (payload.name || '').trim(),
          description: payload.description ? payload.description.trim() : null,
          sortOrder: payload.sortOrder || nextOrder,
          estimatedDurationValue: duration.estimatedDurationValue,
          estimatedDurationUnit: duration.estimatedDurationUnit,
          estimatedDurationMinutes: duration.estimatedDurationMinutes,
          estimatedCost: payload.estimatedCost || null,
        });
        await taskRepo.save(task);

        if (op.tempClientId) {
          tempClientMap[op.tempClientId] = newTaskId;
        }
        break;
      }

      case 'UPDATE_TASK': {
        const taskId = resolveId(op.targetId);
        const task = await taskRepo.findOne({
          where: { id: taskId, deletedAt: IsNull() },
          relations: { option: { pattern: true } },
        });
        if (
          !task ||
          !task.option ||
          task.option.deletedAt ||
          !task.option.pattern ||
          task.option.pattern.deletedAt ||
          task.option.pattern.templateId !== templateId ||
          task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`المهمة المستهدفة للتعديل غير موجودة أو لا تنتمي لهذا الإصدار: ${taskId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.departmentId !== undefined) {
          await this.departmentService.validateDepartmentForStage(payload.departmentId);
          task.departmentId = payload.departmentId;
        }
        if (payload.name !== undefined) task.name = payload.name.trim();
        if (payload.description !== undefined) task.description = payload.description ? payload.description.trim() : null;
        if (
          payload.estimatedDurationValue !== undefined ||
          payload.estimatedDurationUnit !== undefined ||
          payload.estimatedDurationMinutes !== undefined
        ) {
          const duration = resolveTaskDuration(payload, {
            estimatedDurationValue: task.estimatedDurationValue,
            estimatedDurationUnit: task.estimatedDurationUnit,
            estimatedDurationMinutes: task.estimatedDurationMinutes,
          });
          task.estimatedDurationValue = duration.estimatedDurationValue;
          task.estimatedDurationUnit = duration.estimatedDurationUnit;
          task.estimatedDurationMinutes = duration.estimatedDurationMinutes;
        }
        if (payload.estimatedCost !== undefined) task.estimatedCost = payload.estimatedCost;

        await taskRepo.save(task);
        break;
      }

      case 'DELETE_TASK': {
        const taskId = resolveId(op.targetId);
        const task = await taskRepo.findOne({
          where: { id: taskId, deletedAt: IsNull() },
          relations: { option: { pattern: true } },
        });
        if (
          !task ||
          !task.option ||
          task.option.deletedAt ||
          !task.option.pattern ||
          task.option.pattern.deletedAt ||
          task.option.pattern.templateId !== templateId ||
          task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`المهمة المستهدفة للحذف غير موجودة أو لا تنتمي لهذا الإصدار: ${taskId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
        }
        await taskRepo.softDelete(taskId);
        break;
      }

      // ----------------------------------------------------
      // REORDER
      // ----------------------------------------------------
      case 'REORDER_WORKFLOW': {
        const payload = op.payload || {};
        const rawItemIds: string[] = payload.itemIds || payload.orderedItemIds || [];
        if (rawItemIds.length === 0) break;

        const resolvedWfItemIds: string[] = [];
        const seenWfIds = new Set<string>();

        for (const raw of rawItemIds) {
          const resolvedId = resolveId(raw);
          let item = await workflowRepo.findOne({
            where: { id: resolvedId, templateId, versionId, deletedAt: IsNull() },
          });
          if (!item) {
            item = await workflowRepo.findOne({
              where: [
                { stageId: resolvedId, templateId, versionId, deletedAt: IsNull() },
                { patternId: resolvedId, templateId, versionId, deletedAt: IsNull() },
              ],
            });
          }
          if (!item) {
            throw new BusinessRuleError(
              `عنصر سير العمل غير موجود أو لا ينتمي لهذا الإصدار: ${raw}`,
              'PRODUCTION_TEMPLATE_WORKFLOW_ITEM_NOT_FOUND'
            );
          }
          if (seenWfIds.has(item.id)) {
            throw new BusinessRuleError(
              'تكرار في معرفات عناصر سير العمل',
              'PRODUCTION_TEMPLATE_WORKFLOW_DUPLICATE_ITEM'
            );
          }
          seenWfIds.add(item.id);
          resolvedWfItemIds.push(item.id);
        }

        // Verify that the list covers all active workflow items of the version
        const totalActiveWfCount = await workflowRepo.count({
          where: { templateId, versionId, deletedAt: IsNull() },
        });
        if (resolvedWfItemIds.length !== totalActiveWfCount) {
          throw new BusinessRuleError(
            'قائمة إعادة ترتيب سير العمل يجب أن تشمل جميع العناصر النشطة',
            'PRODUCTION_TEMPLATE_WORKFLOW_REORDER_INCOMPLETE'
          );
        }

        for (let i = 0; i < resolvedWfItemIds.length; i++) {
          await workflowRepo.update(
            { id: resolvedWfItemIds[i], templateId, versionId },
            { sortOrder: i + 1 }
          );
        }
        break;
      }

      case 'REORDER_PATTERN_OPTIONS': {
        const payload = op.payload || {};
        const rawOptionIds: string[] = payload.optionIds || payload.orderedOptionIds || [];
        if (rawOptionIds.length > 0) {
          const orderedOptionIds = rawOptionIds.map((raw: string) => resolveId(raw));
          const seenOptIds = new Set<string>();
          for (const optId of orderedOptionIds) {
            if (seenOptIds.has(optId)) {
              throw new BusinessRuleError(
                'تكرار في معرفات خيارات النمط المراد ترتيبها',
                'PRODUCTION_TEMPLATE_PATTERN_OPTION_REORDER_DUPLICATE'
              );
            }
            seenOptIds.add(optId);
          }

          const options = await optionRepo.find({
            where: { id: In(orderedOptionIds), deletedAt: IsNull() },
            relations: { pattern: true },
          });
          if (options.length !== orderedOptionIds.length) {
            throw new BusinessRuleError('أحد خيارات النمط المراد ترتيبها غير موجود', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }
          const targetPatternId = options[0].patternId;
          if (!options[0].pattern || options[0].pattern.templateId !== templateId || options[0].pattern.versionId !== versionId) {
            throw new BusinessRuleError('خيارات النمط لا تنتمي لهذا الإصدار', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }
          if (options.some((o) => o.patternId !== targetPatternId)) {
            throw new BusinessRuleError('لا يمكن إعادة ترتيب خيارات من أنماط مختلفة معاً', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_REORDER_MISMATCH');
          }

          const totalPatternOpts = await optionRepo.count({
            where: { patternId: targetPatternId, deletedAt: IsNull() },
          });
          if (orderedOptionIds.length !== totalPatternOpts) {
            throw new BusinessRuleError(
              'قائمة إعادة ترتيب خيارات النمط يجب أن تشمل جميع الخيارات النشطة',
              'PRODUCTION_TEMPLATE_PATTERN_OPTION_REORDER_INCOMPLETE'
            );
          }

          for (let i = 0; i < orderedOptionIds.length; i++) {
            await optionRepo.update({ id: orderedOptionIds[i] }, { sortOrder: i + 1 });
          }
        }
        break;
      }

      case 'REORDER_OPTION_TASKS': {
        const payload = op.payload || {};
        const rawTaskIds: string[] = payload.taskIds || payload.orderedTaskIds || [];
        if (rawTaskIds.length > 0) {
          const orderedTaskIds = rawTaskIds.map((raw: string) => resolveId(raw));
          const seenTaskIds = new Set<string>();
          for (const taskId of orderedTaskIds) {
            if (seenTaskIds.has(taskId)) {
              throw new BusinessRuleError(
                'تكرار في معرفات المهام المراد ترتيبها',
                'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_REORDER_DUPLICATE'
              );
            }
            seenTaskIds.add(taskId);
          }

          const tasks = await taskRepo.find({
            where: { id: In(orderedTaskIds), deletedAt: IsNull() },
            relations: { option: { pattern: true } },
          });
          if (tasks.length !== orderedTaskIds.length) {
            throw new BusinessRuleError('إحدى المهام المراد ترتيبها غير موجودة', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
          }
          const targetOptionId = tasks[0].optionId;
          if (
            !tasks[0].option ||
            !tasks[0].option.pattern ||
            tasks[0].option.pattern.templateId !== templateId ||
            tasks[0].option.pattern.versionId !== versionId
          ) {
            throw new BusinessRuleError('المهام لا تنتمي لهذا الإصدار', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
          }
          if (tasks.some((t) => t.optionId !== targetOptionId)) {
            throw new BusinessRuleError('لا يمكن إعادة ترتيب مهام من خيارات مختلفة معاً', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_REORDER_MISMATCH');
          }

          const totalOptionTasks = await taskRepo.count({
            where: { optionId: targetOptionId, deletedAt: IsNull() },
          });
          if (orderedTaskIds.length !== totalOptionTasks) {
            throw new BusinessRuleError(
              'قائمة إعادة ترتيب المهام يجب أن تشمل جميع المهام النشطة',
              'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_REORDER_INCOMPLETE'
            );
          }

          for (let i = 0; i < orderedTaskIds.length; i++) {
            await taskRepo.update({ id: orderedTaskIds[i] }, { sortOrder: i + 1 });
          }
        }
        break;
      }

      // ----------------------------------------------------
      // MATERIALS
      // ----------------------------------------------------
      case 'ADD_STAGE_MATERIAL': {
        const stageId = resolveId(op.parentId);
        const stage = await stageRepo.findOne({
          where: { id: stageId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!stage) {
          throw new BusinessRuleError(`المرحلة الأب غير موجودة أو لا تنتمي لهذا الإصدار: ${stageId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
        }
        const payload = op.payload || {};
        const plannedQuantityStr = payload.plannedQuantity != null && String(payload.plannedQuantity).trim() !== ''
          ? String(payload.plannedQuantity).trim()
          : payload.quantity != null && String(payload.quantity).trim() !== ''
            ? String(payload.quantity).trim()
            : '1';

        const mat = manager.create(ProductionTemplateStageMaterialEntity, {
          id: crypto.randomUUID(),
          stageId,
          productId: payload.productId,
          productUnitId: payload.productUnitId,
          plannedQuantity: plannedQuantityStr,
        });
        await manager.getRepository(ProductionTemplateStageMaterialEntity).save(mat);
        break;
      }

      case 'DELETE_STAGE_MATERIAL': {
        const matId = resolveId(op.targetId);
        const matRepo = manager.getRepository(ProductionTemplateStageMaterialEntity);
        const mat = await matRepo.findOne({
          where: { id: matId },
          relations: { stage: true },
        });
        if (!mat || !mat.stage || mat.stage.templateId !== templateId || mat.stage.versionId !== versionId || mat.stage.deletedAt) {
          throw new BusinessRuleError(`المادة المخططة للمرحلة غير موجودة أو لا تنتمي لهذا الإصدار: ${matId}`, 'PRODUCTION_TEMPLATE_STAGE_MATERIAL_NOT_FOUND');
        }
        await matRepo.delete(matId);
        break;
      }

      case 'ADD_TASK_MATERIAL': {
        const taskId = resolveId(op.parentId);
        const task = await taskRepo.findOne({
          where: { id: taskId, deletedAt: IsNull() },
          relations: { option: { pattern: true } },
        });
        if (
          !task ||
          !task.option ||
          task.option.deletedAt ||
          !task.option.pattern ||
          task.option.pattern.deletedAt ||
          task.option.pattern.templateId !== templateId ||
          task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`المهمة الأب غير موجودة أو لا تنتمي لهذا الإصدار: ${taskId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
        }
        const payload = op.payload || {};
        const plannedQuantityStr = payload.plannedQuantity != null && String(payload.plannedQuantity).trim() !== ''
          ? String(payload.plannedQuantity).trim()
          : payload.quantity != null && String(payload.quantity).trim() !== ''
            ? String(payload.quantity).trim()
            : '1';

        const mat = manager.create(ProductionTemplatePatternOptionTaskMaterialEntity, {
          id: crypto.randomUUID(),
          taskId,
          productId: payload.productId,
          productUnitId: payload.productUnitId,
          plannedQuantity: plannedQuantityStr,
        });
        await manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity).save(mat);
        break;
      }

      case 'DELETE_TASK_MATERIAL': {
        const matId = resolveId(op.targetId);
        const taskMatRepo = manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
        const mat = await taskMatRepo.findOne({
          where: { id: matId },
          relations: { task: { option: { pattern: true } } },
        });
        if (
          !mat ||
          !mat.task ||
          mat.task.deletedAt ||
          !mat.task.option ||
          mat.task.option.deletedAt ||
          !mat.task.option.pattern ||
          mat.task.option.pattern.deletedAt ||
          mat.task.option.pattern.templateId !== templateId ||
          mat.task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`المادة المخططة للمهمة غير موجودة أو لا تنتمي لهذا الإصدار: ${matId}`, 'PRODUCTION_TEMPLATE_TASK_MATERIAL_NOT_FOUND');
        }
        await taskMatRepo.delete(matId);
        break;
      }

      // ----------------------------------------------------
      // ATTACHMENTS (Shared Files)
      // ----------------------------------------------------
      case 'ADD_STAGE_ATTACHMENT': {
        const stageId = resolveId(op.parentId);
        const stage = await stageRepo.findOne({
          where: { id: stageId, templateId, versionId, deletedAt: IsNull() },
        });
        if (!stage) {
          throw new BusinessRuleError(`المرحلة الأب غير موجودة أو لا تنتمي لهذا الإصدار: ${stageId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
        }
        const payload = op.payload || {};
        const fileDetails = await this.resolveAttachmentFile(templateId, payload, userId, manager);

        const att = manager.create(ProductionTemplateStageAttachmentEntity, {
          id: crypto.randomUUID(),
          stageId,
          fileId: fileDetails.fileId,
          storageKey: fileDetails.storageKey,
          originalFileName: fileDetails.originalFileName,
          mimeType: fileDetails.mimeType,
          sizeBytes: fileDetails.sizeBytes,
          description: payload.description || null,
          sortOrder: payload.sortOrder || 1,
          createdByUserId: userId || null,
        });
        await manager.getRepository(ProductionTemplateStageAttachmentEntity).save(att);
        break;
      }

      case 'DELETE_STAGE_ATTACHMENT': {
        const attId = resolveId(op.targetId);
        const stageAttRepo = manager.getRepository(ProductionTemplateStageAttachmentEntity);
        const att = await stageAttRepo.findOne({
          where: { id: attId, deletedAt: IsNull() },
          relations: { stage: true },
        });
        if (!att || !att.stage || att.stage.templateId !== templateId || att.stage.versionId !== versionId || att.stage.deletedAt) {
          throw new BusinessRuleError(`مرفق المرحلة غير موجود أو لا ينتمي لهذا الإصدار: ${attId}`, 'PRODUCTION_TEMPLATE_STAGE_ATTACHMENT_NOT_FOUND');
        }
        await stageAttRepo.softDelete(attId);
        break;
      }

      case 'ADD_TASK_ATTACHMENT': {
        const taskId = resolveId(op.parentId);
        const task = await taskRepo.findOne({
          where: { id: taskId, deletedAt: IsNull() },
          relations: { option: { pattern: true } },
        });
        if (
          !task ||
          !task.option ||
          task.option.deletedAt ||
          !task.option.pattern ||
          task.option.pattern.deletedAt ||
          task.option.pattern.templateId !== templateId ||
          task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`المهمة الأب غير موجودة أو لا تنتمي لهذا الإصدار: ${taskId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
        }
        const payload = op.payload || {};
        const fileDetails = await this.resolveAttachmentFile(templateId, payload, userId, manager);

        const att = manager.create(ProductionTemplatePatternOptionTaskAttachmentEntity, {
          id: crypto.randomUUID(),
          taskId,
          fileId: fileDetails.fileId,
          storageKey: fileDetails.storageKey,
          originalFileName: fileDetails.originalFileName,
          mimeType: fileDetails.mimeType,
          sizeBytes: fileDetails.sizeBytes,
          description: payload.description || null,
          sortOrder: payload.sortOrder || 1,
          createdByUserId: userId || null,
        });
        await manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity).save(att);
        break;
      }

      case 'DELETE_TASK_ATTACHMENT': {
        const attId = resolveId(op.targetId);
        const taskAttRepo = manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);
        const att = await taskAttRepo.findOne({
          where: { id: attId, deletedAt: IsNull() },
          relations: { task: { option: { pattern: true } } },
        });
        if (
          !att ||
          !att.task ||
          att.task.deletedAt ||
          !att.task.option ||
          att.task.option.deletedAt ||
          !att.task.option.pattern ||
          att.task.option.pattern.deletedAt ||
          att.task.option.pattern.templateId !== templateId ||
          att.task.option.pattern.versionId !== versionId
        ) {
          throw new BusinessRuleError(`مرفق المهمة غير موجود أو لا ينتمي لهذا الإصدار: ${attId}`, 'PRODUCTION_TEMPLATE_TASK_ATTACHMENT_NOT_FOUND');
        }
        await taskAttRepo.softDelete(attId);
        break;
      }

      // ----------------------------------------------------
      // SPECIFICATIONS (Direct Template Attributes)
      // ----------------------------------------------------
      case 'ADD_SPEC': {
        const payload = op.payload || {};
        const newSpec = specRepo.create({
          id: crypto.randomUUID(),
          templateId,
          name: (payload.name || '').trim(),
          value: (payload.value || '').trim(),
          unit: payload.unit || null,
          sortOrder: payload.sortOrder || 1,
        });
        await specRepo.save(newSpec);
        break;
      }

      case 'UPDATE_SPEC': {
        const specId = resolveId(op.targetId);
        const spec = await specRepo.findOne({
          where: { id: specId, templateId },
        });
        if (!spec) {
          throw new BusinessRuleError(`المواصفة المستهدفة للتعديل غير موجودة: ${specId}`, 'PRODUCTION_TEMPLATE_SPECIFICATION_NOT_FOUND');
        }
        const payload = op.payload || {};
        if (payload.name !== undefined) spec.name = payload.name.trim();
        if (payload.value !== undefined) spec.value = payload.value.trim();
        if (payload.unit !== undefined) spec.unit = payload.unit || null;
        await specRepo.save(spec);
        break;
      }

      case 'DELETE_SPEC': {
        const specId = resolveId(op.targetId);
        const spec = await specRepo.findOne({
          where: { id: specId, templateId },
        });
        if (!spec) {
          throw new BusinessRuleError(`المواصفة المستهدفة للحذف غير موجودة: ${specId}`, 'PRODUCTION_TEMPLATE_SPECIFICATION_NOT_FOUND');
        }
        await specRepo.delete({ id: specId, templateId });
        break;
      }
    }
  }

  /**
   * Ensures dense compaction 1..N of workflow items within the version.
   */
  private async ensureWorkflowDenseCompacted(
    templateId: string,
    versionId: string,
    manager: EntityManager
  ): Promise<void> {
    const workflowRepo = manager.getRepository(ProductionTemplateWorkflowItemEntity);
    const activeItems = await workflowRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    for (let i = 0; i < activeItems.length; i++) {
      if (activeItems[i].sortOrder !== i + 1) {
        await workflowRepo.update({ id: activeItems[i].id }, { sortOrder: i + 1 });
      }
    }
  }

  private async resolveAttachmentFile(
    templateId: string,
    payload: any,
    userId: string | undefined,
    manager: EntityManager
  ): Promise<{
    fileId: string;
    storageKey: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    // 1. Explicitly reject any client-supplied storageKey or raw file paths
    if (payload.storageKey || payload.filePath || payload.path) {
      throw new BusinessRuleError(
        'يُحظر تمرير مسار الملف أو storageKey مباشرة من العميل. استخدم uploadToken أو fileId فقط.',
        'PRODUCTION_TEMPLATE_ATTACHMENT_STORAGE_KEY_FORBIDDEN'
      );
    }

    let fileId: string | undefined;
    let storageKey: string | undefined;
    let originalFileName: string | undefined;
    let mimeType: string | undefined;
    let sizeBytes = 0;

    // 2. Case A: Uploading a new file via UploadToken
    if (payload.uploadToken) {
      if (typeof payload.uploadToken !== 'string') {
        throw new BusinessRuleError(
          'رمز رفع الملف المؤقت غير صالح',
          'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_INVALID'
        );
      }
      const tokenRepo = manager.getRepository(ProductionTemplateUploadTokenEntity);
      const token = await tokenRepo.findOne({
        where: { id: payload.uploadToken },
        lock: { mode: 'pessimistic_write' },
      });

      if (!token || token.templateId !== templateId) {
        throw new BusinessRuleError(
          'رمز رفع الملف المؤقت غير موجود أو لا ينتمي لهذا القالب',
          'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_INVALID'
        );
      }
      if (token.isUsed) {
        throw new BusinessRuleError(
          'رمز رفع الملف المؤقت تم استخدامه مسبقاً ولا يمكن إعادة استخدامه',
          'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_ALREADY_USED'
        );
      }
      if (new Date() > token.expiresAt) {
        throw new BusinessRuleError(
          'رمز رفع الملف المؤقت منتهي الصلاحية',
          'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_EXPIRED'
        );
      }
      if (!userId || (token.userId && token.userId !== userId)) {
        throw new BusinessRuleError(
          'رمز رفع الملف المؤقت لا يخص المستخدم الحالي',
          'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_UNAUTHORIZED'
        );
      }

      // Check that the physical file exists on disk
      const resolvedAbsPath = path.isAbsolute(token.storageKey)
        ? token.storageKey
        : path.resolve(process.cwd(), token.storageKey);
      if (!fs.existsSync(resolvedAbsPath)) {
        throw new BusinessRuleError(
          'الملف الفيزيائي المرتبط بالرمز المؤقت غير موجود على الخادم',
          'PRODUCTION_TEMPLATE_UPLOAD_PHYSICAL_FILE_MISSING'
        );
      }

      // Mark token as used atomically within this transaction
      token.isUsed = true;
      await tokenRepo.save(token);

      storageKey = token.storageKey;
      originalFileName = token.originalFileName;
      mimeType = token.mimeType;
      sizeBytes = Number(token.sizeBytes);

      const storedFile = await this.sharedFileService.getOrCreateStoredFile(
        {
          templateId,
          storageKey,
          originalFileName,
          mimeType,
          sizeBytes,
          createdByUserId: userId || null,
        },
        manager
      );
      fileId = storedFile.id;
    }
    // 3. Case B: Reusing an existing stored file via fileId
    else if (payload.fileId) {
      if (typeof payload.fileId !== 'string') {
        throw new BusinessRuleError(
          'معرف الملف المعاد استخدامه غير صالح',
          'PRODUCTION_TEMPLATE_STORED_FILE_INVALID'
        );
      }
      const storedFileRepo = manager.getRepository(ProductionTemplateStoredFileEntity);
      const storedFile = await storedFileRepo.findOne({
        where: { id: payload.fileId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });

      if (!storedFile || storedFile.templateId !== templateId) {
        throw new BusinessRuleError(
          'الملف المطلوب غير موجود أو لا ينتمي لهذا القالب',
          'PRODUCTION_TEMPLATE_STORED_FILE_UNAUTHORIZED'
        );
      }
      if (storedFile.deletedAt) {
        throw new BusinessRuleError(
          'الملف المطلوب تم حذفه مسبقاً ولا يمكن ربطه مجدداً',
          'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
        );
      }

      // Check if file has entered cleanup queue (PENDING, PROCESSING, FAILED, COMPLETED)
      const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);
      const activeCleanup = await cleanupRepo.findOne({
        where: {
          fileId: storedFile.id,
          status: In([
            FileCleanupStatus.PENDING,
            FileCleanupStatus.PROCESSING,
            FileCleanupStatus.FAILED,
            FileCleanupStatus.COMPLETED,
          ]),
        },
      });
      if (activeCleanup) {
        throw new BusinessRuleError(
          'الملف المطلوب دخل مرحلة التنظيف أو تم حذفه ولا يمكن إعادة ربطه',
          'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
        );
      }

      fileId = storedFile.id;
      storageKey = storedFile.storageKey;
      originalFileName = storedFile.originalFileName;
      mimeType = storedFile.mimeType;
      sizeBytes = Number(storedFile.sizeBytes);
    } else {
      throw new BusinessRuleError(
        'يجب تقديم uploadToken لملف جديد أو fileId لملف موجود مصرح به',
        'PRODUCTION_TEMPLATE_ATTACHMENT_INPUT_INVALID'
      );
    }

    return {
      fileId,
      storageKey,
      originalFileName,
      mimeType,
      sizeBytes,
    };
  }
}

export const productionTemplateEditingService = new ProductionTemplateEditingService();
