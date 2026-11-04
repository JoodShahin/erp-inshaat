import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import crypto from 'node:crypto';
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
    deptService: ProductionDepartmentService = productionDepartmentService
  ) {
    this.classifier = classifier;
    this.cloner = cloner;
    this.versionService = versionService;
    this.guardService = guardService;
    this.sharedFileService = sharedFileService;
    this.departmentService = deptService;
  }

  /**
   * Commits an atomic editing session containing multiple operations in a single transaction.
   * Auto-classifies changes as STRUCTURAL vs MINOR and forks a new version if needed.
   */
  async commitEditingSession(
    templateId: string,
    dto: CommitTemplateEditingSessionDto,
    userId?: string
  ): Promise<CommitEditingSessionResult> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template aggregate root
      const template = await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Validate baseVersionId is latest active version
      const baseVersion = await this.versionService.assertIsLatestVersion(
        templateId,
        dto.baseVersionId,
        manager
      );

      // 3. Classify operations
      const classification = this.classifier.classify(dto.operations);

      // 4. Determine if we must fork a new version
      let shouldCreateNewVersion = false;
      if (dto.commitDecision === 'NEW_VERSION') {
        shouldCreateNewVersion = true;
      } else if (dto.commitDecision === 'OVERWRITE_CURRENT') {
        shouldCreateNewVersion = false;
      } else {
        // 'AUTO' mode
        shouldCreateNewVersion = classification.classification === 'STRUCTURAL';
      }

      let targetVersionId = baseVersion.id;
      let targetVersionNumber = baseVersion.version;
      const idMap = new Map<string, string>(); // Cloned IDs map: oldId -> newId
      const tempClientMap: Record<string, string> = {}; // Client IDs map: tempClientId -> newDbId

      // 5. Fork new version if required
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

      // 6. Apply operations sequentially
      for (const op of dto.operations) {
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

      // 7. Ensure workflow dense compactor on target version
      await this.ensureWorkflowDenseCompacted(templateId, targetVersionId, manager);

      return {
        templateId,
        targetVersionId,
        targetVersionNumber,
        createdNewVersion: shouldCreateNewVersion,
        changeType: classification.classification,
        appliedOperationsCount: dto.operations.length,
        tempClientMap,
      };
    });
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
          throw new BusinessRuleError(`النمط المستهدف للتعديل غير موجود: ${patternId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.name !== undefined) pattern.name = payload.name.trim();
        await patternRepo.save(pattern);
        break;
      }

      case 'DELETE_PATTERN': {
        const patternId = resolveId(op.targetId);
        await patternRepo.softDelete({ id: patternId, templateId, versionId });
        await workflowRepo.softDelete({ patternId, templateId, versionId });
        break;
      }

      // ----------------------------------------------------
      // OPTIONS
      // ----------------------------------------------------
      case 'ADD_OPTION': {
        const patternId = resolveId(op.parentId);
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
        });
        if (!option) {
          throw new BusinessRuleError(`الخيار المستهدف للتعديل غير موجود: ${optionId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
        }

        const payload = op.payload || {};
        if (payload.name !== undefined) option.name = payload.name.trim();
        await optionRepo.save(option);
        break;
      }

      case 'DELETE_OPTION': {
        const optionId = resolveId(op.targetId);
        await optionRepo.softDelete(optionId);
        break;
      }

      // ----------------------------------------------------
      // TASKS
      // ----------------------------------------------------
      case 'ADD_TASK': {
        const optionId = resolveId(op.parentId);
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
        });
        if (!task) {
          throw new BusinessRuleError(`المهمة المستهدفة للتعديل غير موجودة: ${taskId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
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
        await taskRepo.softDelete(taskId);
        break;
      }

      // ----------------------------------------------------
      // REORDER
      // ----------------------------------------------------
      case 'REORDER_WORKFLOW': {
        const payload = op.payload || {};
        const orderedItemIds: string[] = (payload.itemIds || []).map((raw: string) => resolveId(raw));
        for (let i = 0; i < orderedItemIds.length; i++) {
          await workflowRepo.update(
            { id: orderedItemIds[i], templateId, versionId },
            { sortOrder: i + 1 }
          );
        }
        break;
      }

      case 'REORDER_PATTERN_OPTIONS': {
        const payload = op.payload || {};
        const orderedOptionIds: string[] = (payload.optionIds || []).map((raw: string) => resolveId(raw));
        for (let i = 0; i < orderedOptionIds.length; i++) {
          await optionRepo.update({ id: orderedOptionIds[i] }, { sortOrder: i + 1 });
        }
        break;
      }

      case 'REORDER_OPTION_TASKS': {
        const payload = op.payload || {};
        const orderedTaskIds: string[] = (payload.taskIds || []).map((raw: string) => resolveId(raw));
        for (let i = 0; i < orderedTaskIds.length; i++) {
          await taskRepo.update({ id: orderedTaskIds[i] }, { sortOrder: i + 1 });
        }
        break;
      }

      // ----------------------------------------------------
      // MATERIALS
      // ----------------------------------------------------
      case 'ADD_STAGE_MATERIAL': {
        const stageId = resolveId(op.parentId);
        const payload = op.payload || {};
        const mat = manager.create(ProductionTemplateStageMaterialEntity, {
          id: crypto.randomUUID(),
          stageId,
          productId: payload.productId,
          productUnitId: payload.productUnitId,
          plannedQuantity: String(payload.plannedQuantity || payload.quantity || '1'),
          notes: payload.notes || null,
        });
        await manager.getRepository(ProductionTemplateStageMaterialEntity).save(mat);
        break;
      }

      case 'DELETE_STAGE_MATERIAL': {
        const matId = resolveId(op.targetId);
        await manager.delete(ProductionTemplateStageMaterialEntity, matId);
        break;
      }

      case 'ADD_TASK_MATERIAL': {
        const taskId = resolveId(op.parentId);
        const payload = op.payload || {};
        const mat = manager.create(ProductionTemplatePatternOptionTaskMaterialEntity, {
          id: crypto.randomUUID(),
          taskId,
          productId: payload.productId,
          productUnitId: payload.productUnitId,
          plannedQuantity: String(payload.plannedQuantity || payload.quantity || '1'),
          notes: payload.notes || null,
        });
        await manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity).save(mat);
        break;
      }

      case 'DELETE_TASK_MATERIAL': {
        const matId = resolveId(op.targetId);
        await manager.delete(ProductionTemplatePatternOptionTaskMaterialEntity, matId);
        break;
      }

      // ----------------------------------------------------
      // ATTACHMENTS (Shared Files)
      // ----------------------------------------------------
      case 'ADD_STAGE_ATTACHMENT': {
        const stageId = resolveId(op.parentId);
        const payload = op.payload || {};
        const storedFile = await this.sharedFileService.getOrCreateStoredFile(
          {
            templateId,
            storageKey: payload.storageKey,
            originalFileName: payload.originalFileName,
            mimeType: payload.mimeType,
            sizeBytes: payload.sizeBytes,
            createdByUserId: userId || null,
          },
          manager
        );

        const att = manager.create(ProductionTemplateStageAttachmentEntity, {
          id: crypto.randomUUID(),
          stageId,
          fileId: storedFile.id,
          storageKey: payload.storageKey,
          originalFileName: payload.originalFileName,
          mimeType: payload.mimeType,
          sizeBytes: payload.sizeBytes,
          description: payload.description || null,
          sortOrder: payload.sortOrder || 1,
          createdByUserId: userId || null,
        });
        await manager.getRepository(ProductionTemplateStageAttachmentEntity).save(att);
        break;
      }

      case 'DELETE_STAGE_ATTACHMENT': {
        const attId = resolveId(op.targetId);
        await manager.getRepository(ProductionTemplateStageAttachmentEntity).softDelete(attId);
        break;
      }

      case 'ADD_TASK_ATTACHMENT': {
        const taskId = resolveId(op.parentId);
        const payload = op.payload || {};
        const storedFile = await this.sharedFileService.getOrCreateStoredFile(
          {
            templateId,
            storageKey: payload.storageKey,
            originalFileName: payload.originalFileName,
            mimeType: payload.mimeType,
            sizeBytes: payload.sizeBytes,
            createdByUserId: userId || null,
          },
          manager
        );

        const att = manager.create(ProductionTemplatePatternOptionTaskAttachmentEntity, {
          id: crypto.randomUUID(),
          taskId,
          fileId: storedFile.id,
          storageKey: payload.storageKey,
          originalFileName: payload.originalFileName,
          mimeType: payload.mimeType,
          sizeBytes: payload.sizeBytes,
          description: payload.description || null,
          sortOrder: payload.sortOrder || 1,
          createdByUserId: userId || null,
        });
        await manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity).save(att);
        break;
      }

      case 'DELETE_TASK_ATTACHMENT': {
        const attId = resolveId(op.targetId);
        await manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity).softDelete(attId);
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
        if (spec) {
          const payload = op.payload || {};
          if (payload.name !== undefined) spec.name = payload.name.trim();
          if (payload.value !== undefined) spec.value = payload.value.trim();
          if (payload.unit !== undefined) spec.unit = payload.unit || null;
          await specRepo.save(spec);
        }
        break;
      }

      case 'DELETE_SPEC': {
        const specId = resolveId(op.targetId);
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
}

export const productionTemplateEditingService = new ProductionTemplateEditingService();
