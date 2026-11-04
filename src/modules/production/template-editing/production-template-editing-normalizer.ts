import { EntityManager, IsNull } from 'typeorm';
import { TemplateEditingOperationDto } from './dto/commit-template-editing-session.dto.js';
import { ClassificationResult } from './production-template-change-classifier.js';
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

interface InMemStage {
  id: string;
  name: string;
  description: string | null;
  departmentId: string;
  estimatedDurationMinutes: number | null;
  estimatedDurationValue: number | null;
  estimatedDurationUnit: string | null;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemPattern {
  id: string;
  name: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemOption {
  id: string;
  patternId: string;
  name: string;
  sortOrder: number;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemTask {
  id: string;
  optionId: string;
  departmentId: string;
  name: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  estimatedDurationValue: number | null;
  estimatedDurationUnit: string | null;
  sortOrder: number;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemMaterial {
  id: string;
  parentId: string; // stageId or taskId
  parentType: 'STAGE' | 'TASK';
  productId: string;
  productUnitId: string;
  plannedQuantity: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemAttachment {
  id: string;
  parentId: string; // stageId or taskId
  parentType: 'STAGE' | 'TASK';
  storageKey?: string;
  uploadToken?: string;
  description: string | null;
  sortOrder: number;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemWorkflowItem {
  id: string;
  itemType: 'STAGE' | 'PATTERN';
  targetId: string; // stageId or patternId
  sortOrder: number;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemSpec {
  id: string;
  name: string;
  value: string;
  unit: string | null;
  sortOrder: number;
  isNew?: boolean;
  isDeleted?: boolean;
}

export class ProductionTemplateEditingNormalizer {
  /**
   * Normalizes the operations against the baseline state of the version,
   * validates logical dependencies, checks for conflicts/cycles/temp ID reuses,
   * and computes the true semantic diff between baseline and final in-memory state.
   */
  async normalizeAndClassify(
    templateId: string,
    versionId: string,
    operations: TemplateEditingOperationDto[],
    manager: EntityManager
  ): Promise<ClassificationResult> {
    if (!operations || operations.length === 0) {
      return {
        classification: 'NONE',
        reasons: ['لا توجد عمليات تعديل'],
        structuralCount: 0,
        minorCount: 0,
      };
    }

    // 1. Fetch Baseline State from DB
    const stageRepo = manager.getRepository(ProductionTemplateStageEntity);
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const optionRepo = manager.getRepository(ProductionTemplatePatternOptionEntity);
    const taskRepo = manager.getRepository(ProductionTemplatePatternOptionTaskEntity);
    const stageMatRepo = manager.getRepository(ProductionTemplateStageMaterialEntity);
    const taskMatRepo = manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
    const stageAttRepo = manager.getRepository(ProductionTemplateStageAttachmentEntity);
    const taskAttRepo = manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);
    const wfRepo = manager.getRepository(ProductionTemplateWorkflowItemEntity);
    const specRepo = manager.getRepository(ProductionTemplateSpecificationEntity);

    const baseStages = await stageRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
    });
    const basePatterns = await patternRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
    });
    const baseWf = await wfRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });
    const baseSpecs = await specRepo.find({
      where: { templateId },
      order: { sortOrder: 'ASC' },
    });

    // Load options and tasks belonging to this version's patterns
    const patternIds = basePatterns.map((p) => p.id);
    let baseOptions: ProductionTemplatePatternOptionEntity[] = [];
    let baseTasks: ProductionTemplatePatternOptionTaskEntity[] = [];
    if (patternIds.length > 0) {
      baseOptions = await optionRepo
        .createQueryBuilder('o')
        .where('o.patternId IN (:...patternIds) AND o.deletedAt IS NULL', { patternIds })
        .orderBy('o.sortOrder', 'ASC')
        .getMany();

      const optionIds = baseOptions.map((o) => o.id);
      if (optionIds.length > 0) {
        baseTasks = await taskRepo
          .createQueryBuilder('t')
          .where('t.optionId IN (:...optionIds) AND t.deletedAt IS NULL', { optionIds })
          .orderBy('t.sortOrder', 'ASC')
          .getMany();
      }
    }

    // Load materials and attachments
    const stageIds = baseStages.map((s) => s.id);
    let baseStageMaterials: ProductionTemplateStageMaterialEntity[] = [];
    let baseStageAttachments: ProductionTemplateStageAttachmentEntity[] = [];
    if (stageIds.length > 0) {
      baseStageMaterials = await stageMatRepo
        .createQueryBuilder('m')
        .where('m.stageId IN (:...stageIds)', { stageIds })
        .getMany();

      baseStageAttachments = await stageAttRepo
        .createQueryBuilder('a')
        .where('a.stageId IN (:...stageIds) AND a.deletedAt IS NULL', { stageIds })
        .getMany();
    }

    const taskIds = baseTasks.map((t) => t.id);
    let baseTaskMaterials: ProductionTemplatePatternOptionTaskMaterialEntity[] = [];
    let baseTaskAttachments: ProductionTemplatePatternOptionTaskAttachmentEntity[] = [];
    if (taskIds.length > 0) {
      baseTaskMaterials = await taskMatRepo
        .createQueryBuilder('m')
        .where('m.taskId IN (:...taskIds)', { taskIds })
        .getMany();

      baseTaskAttachments = await taskAttRepo
        .createQueryBuilder('a')
        .where('a.taskId IN (:...taskIds) AND a.deletedAt IS NULL', { taskIds })
        .getMany();
    }

    // 2. Build In-Memory baseline maps
    const stagesMap = new Map<string, InMemStage>();
    baseStages.forEach((s) => {
      stagesMap.set(s.id, {
        id: s.id,
        name: s.name,
        description: s.description,
        departmentId: s.departmentId,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
        estimatedDurationValue: s.estimatedDurationValue,
        estimatedDurationUnit: s.estimatedDurationUnit,
      });
    });

    const patternsMap = new Map<string, InMemPattern>();
    basePatterns.forEach((p) => {
      patternsMap.set(p.id, { id: p.id, name: p.name });
    });

    const optionsMap = new Map<string, InMemOption>();
    baseOptions.forEach((o) => {
      optionsMap.set(o.id, { id: o.id, patternId: o.patternId, name: o.name, sortOrder: o.sortOrder });
    });

    const tasksMap = new Map<string, InMemTask>();
    baseTasks.forEach((t) => {
      tasksMap.set(t.id, {
        id: t.id,
        optionId: t.optionId,
        departmentId: t.departmentId,
        name: t.name,
        description: t.description,
        estimatedDurationMinutes: t.estimatedDurationMinutes,
        estimatedDurationValue: t.estimatedDurationValue,
        estimatedDurationUnit: t.estimatedDurationUnit,
        sortOrder: t.sortOrder,
      });
    });

    const materialsMap = new Map<string, InMemMaterial>();
    baseStageMaterials.forEach((m) => {
      materialsMap.set(m.id, {
        id: m.id,
        parentId: m.stageId,
        parentType: 'STAGE',
        productId: m.productId,
        productUnitId: m.productUnitId,
        plannedQuantity: String(m.plannedQuantity),
      });
    });
    baseTaskMaterials.forEach((m) => {
      materialsMap.set(m.id, {
        id: m.id,
        parentId: m.taskId,
        parentType: 'TASK',
        productId: m.productId,
        productUnitId: m.productUnitId,
        plannedQuantity: String(m.plannedQuantity),
      });
    });

    const attachmentsMap = new Map<string, InMemAttachment>();
    baseStageAttachments.forEach((a) => {
      attachmentsMap.set(a.id, {
        id: a.id,
        parentId: a.stageId,
        parentType: 'STAGE',
        storageKey: a.storageKey,
        description: a.description,
        sortOrder: a.sortOrder,
      });
    });
    baseTaskAttachments.forEach((a) => {
      attachmentsMap.set(a.id, {
        id: a.id,
        parentId: a.taskId,
        parentType: 'TASK',
        storageKey: a.storageKey,
        description: a.description,
        sortOrder: a.sortOrder,
      });
    });

    const wfMap = new Map<string, InMemWorkflowItem>();
    baseWf.forEach((w) => {
      wfMap.set(w.id, {
        id: w.id,
        itemType: w.itemType,
        targetId: w.stageId || w.patternId || '',
        sortOrder: w.sortOrder,
      });
    });

    const specsMap = new Map<string, InMemSpec>();
    baseSpecs.forEach((s) => {
      specsMap.set(s.id, {
        id: s.id,
        name: s.name,
        value: s.value,
        unit: s.unit,
        sortOrder: s.sortOrder,
      });
    });

    // 3. Track temporary client IDs and map them to logical keys
    const tempToEntity = new Map<string, { type: string; id: string }>();

    const resolveRef = (ref?: string): string => {
      if (!ref) return '';
      if (tempToEntity.has(ref)) return tempToEntity.get(ref)!.id;
      return ref;
    };

    // 4. Sequentially simulate all operations on in-memory state
    for (const op of operations) {
      if (op.tempClientId) {
        if (tempToEntity.has(op.tempClientId)) {
          const existing = tempToEntity.get(op.tempClientId)!;
          if (existing.type !== op.type) {
            throw new BusinessRuleError(
              `تكرار استخدام المعرف المؤقت ${op.tempClientId} لأنواع مختلفة من العناصر`,
              'PRODUCTION_TEMPLATE_TEMP_ID_REUSE_CONFLICT'
            );
          }
        }
      }

      switch (op.type) {
        case 'ADD_STAGE': {
          const tempId = op.tempClientId || `tmp-stg-${stagesMap.size + 1}`;
          const duration = resolveTaskDuration(op.payload || {});
          const newStage: InMemStage = {
            id: tempId,
            name: (op.payload?.name || '').trim(),
            description: op.payload?.description ? op.payload.description.trim() : null,
            departmentId: op.payload?.departmentId || '',
            estimatedDurationMinutes: duration.estimatedDurationMinutes,
            estimatedDurationValue: duration.estimatedDurationValue,
            estimatedDurationUnit: duration.estimatedDurationUnit,
            isNew: true,
          };
          stagesMap.set(tempId, newStage);
          if (op.tempClientId) tempToEntity.set(op.tempClientId, { type: op.type, id: tempId });

          const wfItemId = `tmp-wf-${wfMap.size + 1}`;
          wfMap.set(wfItemId, {
            id: wfItemId,
            itemType: 'STAGE',
            targetId: tempId,
            sortOrder: wfMap.size + 1,
            isNew: true,
          });
          break;
        }

        case 'UPDATE_STAGE': {
          const targetId = resolveRef(op.targetId);
          const stage = stagesMap.get(targetId);
          if (!stage || stage.isDeleted) {
            throw new BusinessRuleError(`المرحلة المستهدفة للتعديل غير موجودة: ${targetId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
          }
          if (op.payload?.name !== undefined) stage.name = op.payload.name.trim();
          if (op.payload?.description !== undefined) stage.description = op.payload.description ? op.payload.description.trim() : null;
          if (op.payload?.departmentId !== undefined) stage.departmentId = op.payload.departmentId;
          if (
            op.payload?.estimatedDurationValue !== undefined ||
            op.payload?.estimatedDurationUnit !== undefined ||
            op.payload?.estimatedDurationMinutes !== undefined
          ) {
            const duration = resolveTaskDuration(op.payload, {
              estimatedDurationValue: stage.estimatedDurationValue,
              estimatedDurationUnit: stage.estimatedDurationUnit,
              estimatedDurationMinutes: stage.estimatedDurationMinutes,
            });
            stage.estimatedDurationValue = duration.estimatedDurationValue;
            stage.estimatedDurationUnit = duration.estimatedDurationUnit;
            stage.estimatedDurationMinutes = duration.estimatedDurationMinutes;
          }
          break;
        }

        case 'DELETE_STAGE': {
          const targetId = resolveRef(op.targetId);
          const stage = stagesMap.get(targetId);
          if (!stage || stage.isDeleted) {
            throw new BusinessRuleError(`المرحلة المستهدفة للحذف غير موجودة: ${targetId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
          }
          if (stage.isNew) {
            // Cancel-out: added in this session and deleted in this session
            stagesMap.delete(targetId);
          } else {
            stage.isDeleted = true;
          }

          // Mark corresponding workflow item
          for (const [wfId, wf] of wfMap.entries()) {
            if (wf.targetId === targetId) {
              if (wf.isNew) wfMap.delete(wfId);
              else wf.isDeleted = true;
            }
          }
          break;
        }

        case 'ADD_PATTERN': {
          const tempId = op.tempClientId || `tmp-pat-${patternsMap.size + 1}`;
          const newPat: InMemPattern = {
            id: tempId,
            name: (op.payload?.name || '').trim(),
            isNew: true,
          };
          patternsMap.set(tempId, newPat);
          if (op.tempClientId) tempToEntity.set(op.tempClientId, { type: op.type, id: tempId });

          const wfItemId = `tmp-wf-${wfMap.size + 1}`;
          wfMap.set(wfItemId, {
            id: wfItemId,
            itemType: 'PATTERN',
            targetId: tempId,
            sortOrder: wfMap.size + 1,
            isNew: true,
          });
          break;
        }

        case 'UPDATE_PATTERN': {
          const targetId = resolveRef(op.targetId);
          const pat = patternsMap.get(targetId);
          if (!pat || pat.isDeleted) {
            throw new BusinessRuleError(`النمط المستهدف للتعديل غير موجود: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
          }
          if (op.payload?.name !== undefined) pat.name = op.payload.name.trim();
          break;
        }

        case 'DELETE_PATTERN': {
          const targetId = resolveRef(op.targetId);
          const pat = patternsMap.get(targetId);
          if (!pat || pat.isDeleted) {
            throw new BusinessRuleError(`النمط المستهدف للحذف غير موجود: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
          }
          if (pat.isNew) {
            patternsMap.delete(targetId);
          } else {
            pat.isDeleted = true;
          }

          for (const [wfId, wf] of wfMap.entries()) {
            if (wf.targetId === targetId) {
              if (wf.isNew) wfMap.delete(wfId);
              else wf.isDeleted = true;
            }
          }
          break;
        }

        case 'ADD_OPTION': {
          const parentId = resolveRef(op.parentId);
          const pat = patternsMap.get(parentId);
          if (!pat || pat.isDeleted) {
            throw new BusinessRuleError(`النمط الأب غير موجود أو تم حذفه: ${parentId}`, 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
          }

          const tempId = op.tempClientId || `tmp-opt-${optionsMap.size + 1}`;
          const newOpt: InMemOption = {
            id: tempId,
            patternId: parentId,
            name: (op.payload?.name || '').trim(),
            sortOrder: op.payload?.sortOrder || (optionsMap.size + 1),
            isNew: true,
          };
          optionsMap.set(tempId, newOpt);
          if (op.tempClientId) tempToEntity.set(op.tempClientId, { type: op.type, id: tempId });
          break;
        }

        case 'UPDATE_OPTION': {
          const targetId = resolveRef(op.targetId);
          const opt = optionsMap.get(targetId);
          if (!opt || opt.isDeleted) {
            throw new BusinessRuleError(`الخيار المستهدف للتعديل غير موجود: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }
          if (op.payload?.name !== undefined) opt.name = op.payload.name.trim();
          break;
        }

        case 'DELETE_OPTION': {
          const targetId = resolveRef(op.targetId);
          const opt = optionsMap.get(targetId);
          if (!opt || opt.isDeleted) {
            throw new BusinessRuleError(`الخيار المستهدف للحذف غير موجود: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }
          if (opt.isNew) optionsMap.delete(targetId);
          else opt.isDeleted = true;
          break;
        }

        case 'ADD_TASK': {
          const parentId = resolveRef(op.parentId);
          const opt = optionsMap.get(parentId);
          if (!opt || opt.isDeleted) {
            throw new BusinessRuleError(`خيار النمط الأب غير موجود أو تم حذفه: ${parentId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }

          const tempId = op.tempClientId || `tmp-task-${tasksMap.size + 1}`;
          const duration = resolveTaskDuration(op.payload || {});
          const newTask: InMemTask = {
            id: tempId,
            optionId: parentId,
            departmentId: op.payload?.departmentId || '',
            name: (op.payload?.name || '').trim(),
            description: op.payload?.description ? op.payload.description.trim() : null,
            estimatedDurationMinutes: duration.estimatedDurationMinutes,
            estimatedDurationValue: duration.estimatedDurationValue,
            estimatedDurationUnit: duration.estimatedDurationUnit,
            sortOrder: op.payload?.sortOrder || (tasksMap.size + 1),
            isNew: true,
          };
          tasksMap.set(tempId, newTask);
          if (op.tempClientId) tempToEntity.set(op.tempClientId, { type: op.type, id: tempId });
          break;
        }

        case 'UPDATE_TASK': {
          const targetId = resolveRef(op.targetId);
          const task = tasksMap.get(targetId);
          if (!task || task.isDeleted) {
            throw new BusinessRuleError(`المهمة المستهدفة للتعديل غير موجودة: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
          }
          if (op.payload?.name !== undefined) task.name = op.payload.name.trim();
          if (op.payload?.description !== undefined) task.description = op.payload.description ? op.payload.description.trim() : null;
          if (op.payload?.departmentId !== undefined) task.departmentId = op.payload.departmentId;
          if (
            op.payload?.estimatedDurationValue !== undefined ||
            op.payload?.estimatedDurationUnit !== undefined ||
            op.payload?.estimatedDurationMinutes !== undefined
          ) {
            const duration = resolveTaskDuration(op.payload, {
              estimatedDurationValue: task.estimatedDurationValue,
              estimatedDurationUnit: task.estimatedDurationUnit,
              estimatedDurationMinutes: task.estimatedDurationMinutes,
            });
            task.estimatedDurationValue = duration.estimatedDurationValue;
            task.estimatedDurationUnit = duration.estimatedDurationUnit;
            task.estimatedDurationMinutes = duration.estimatedDurationMinutes;
          }
          break;
        }

        case 'DELETE_TASK': {
          const targetId = resolveRef(op.targetId);
          const task = tasksMap.get(targetId);
          if (!task || task.isDeleted) {
            throw new BusinessRuleError(`المهمة المستهدفة للحذف غير موجودة: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
          }
          if (task.isNew) tasksMap.delete(targetId);
          else task.isDeleted = true;
          break;
        }

        case 'REORDER_WORKFLOW': {
          const itemIds: string[] = (op.payload?.itemIds || []).map((raw: string) => resolveRef(raw));
          for (let i = 0; i < itemIds.length; i++) {
            const item = wfMap.get(itemIds[i]);
            if (item) item.sortOrder = i + 1;
          }
          break;
        }

        case 'REORDER_PATTERN_OPTIONS': {
          const optIds: string[] = (op.payload?.optionIds || []).map((raw: string) => resolveRef(raw));
          for (let i = 0; i < optIds.length; i++) {
            const opt = optionsMap.get(optIds[i]);
            if (opt) opt.sortOrder = i + 1;
          }
          break;
        }

        case 'REORDER_OPTION_TASKS': {
          const taskIds: string[] = (op.payload?.taskIds || []).map((raw: string) => resolveRef(raw));
          for (let i = 0; i < taskIds.length; i++) {
            const task = tasksMap.get(taskIds[i]);
            if (task) task.sortOrder = i + 1;
          }
          break;
        }

        case 'ADD_STAGE_MATERIAL':
        case 'ADD_TASK_MATERIAL': {
          const parentId = resolveRef(op.parentId);
          const tempId = `tmp-mat-${materialsMap.size + 1}`;
          materialsMap.set(tempId, {
            id: tempId,
            parentId,
            parentType: op.type === 'ADD_STAGE_MATERIAL' ? 'STAGE' : 'TASK',
            productId: op.payload?.productId,
            productUnitId: op.payload?.productUnitId,
            plannedQuantity: String(op.payload?.plannedQuantity || op.payload?.quantity || '1'),
            isNew: true,
          });
          break;
        }

        case 'DELETE_STAGE_MATERIAL':
        case 'DELETE_TASK_MATERIAL': {
          const targetId = resolveRef(op.targetId);
          const mat = materialsMap.get(targetId);
          if (mat) {
            if (mat.isNew) materialsMap.delete(targetId);
            else mat.isDeleted = true;
          }
          break;
        }

        case 'ADD_STAGE_ATTACHMENT':
        case 'ADD_TASK_ATTACHMENT': {
          const parentId = resolveRef(op.parentId);
          const tempId = `tmp-att-${attachmentsMap.size + 1}`;
          attachmentsMap.set(tempId, {
            id: tempId,
            parentId,
            parentType: op.type === 'ADD_STAGE_ATTACHMENT' ? 'STAGE' : 'TASK',
            storageKey: op.payload?.storageKey,
            uploadToken: op.payload?.uploadToken,
            description: op.payload?.description || null,
            sortOrder: op.payload?.sortOrder || 1,
            isNew: true,
          });
          break;
        }

        case 'DELETE_STAGE_ATTACHMENT':
        case 'DELETE_TASK_ATTACHMENT': {
          const targetId = resolveRef(op.targetId);
          const att = attachmentsMap.get(targetId);
          if (att) {
            if (att.isNew) attachmentsMap.delete(targetId);
            else att.isDeleted = true;
          }
          break;
        }

        case 'ADD_SPEC': {
          const tempId = `tmp-spec-${specsMap.size + 1}`;
          specsMap.set(tempId, {
            id: tempId,
            name: (op.payload?.name || '').trim(),
            value: (op.payload?.value || '').trim(),
            unit: op.payload?.unit || null,
            sortOrder: op.payload?.sortOrder || (specsMap.size + 1),
            isNew: true,
          });
          break;
        }

        case 'UPDATE_SPEC': {
          const targetId = resolveRef(op.targetId);
          const spec = specsMap.get(targetId);
          if (spec && !spec.isDeleted) {
            if (op.payload?.name !== undefined) spec.name = op.payload.name.trim();
            if (op.payload?.value !== undefined) spec.value = op.payload.value.trim();
            if (op.payload?.unit !== undefined) spec.unit = op.payload.unit || null;
          }
          break;
        }

        case 'DELETE_SPEC': {
          const targetId = resolveRef(op.targetId);
          const spec = specsMap.get(targetId);
          if (spec) {
            if (spec.isNew) specsMap.delete(targetId);
            else spec.isDeleted = true;
          }
          break;
        }
      }
    }

    // 5. Compare Baseline vs Final in-memory state to detect actual NET DIFF
    const reasons: string[] = [];
    let structuralCount = 0;
    let minorCount = 0;

    // Check Stages net diff
    for (const [id, s] of stagesMap.entries()) {
      if (s.isNew) {
        structuralCount++;
        reasons.push(`إضافة مرحلة جديدة (${s.name})`);
      } else if (s.isDeleted) {
        structuralCount++;
        reasons.push(`حذف مرحلة (${s.name})`);
      } else {
        const base = baseStages.find((b) => b.id === id);
        if (base) {
          if (s.departmentId !== base.departmentId) {
            structuralCount++;
            reasons.push(`تغيير قسم المرحلة (${s.name})`);
          }
          if (
            s.estimatedDurationMinutes !== base.estimatedDurationMinutes ||
            s.estimatedDurationValue !== base.estimatedDurationValue ||
            s.estimatedDurationUnit !== base.estimatedDurationUnit
          ) {
            structuralCount++;
            reasons.push(`تغيير مدة المرحلة (${s.name})`);
          }
          if (s.name !== base.name || s.description !== base.description) {
            minorCount++;
            reasons.push(`تعديل بيانات وصفية للمرحلة (${s.name})`);
          }
        }
      }
    }

    // Check Patterns net diff
    for (const [id, p] of patternsMap.entries()) {
      if (p.isNew) {
        structuralCount++;
        reasons.push(`إضافة نمط جديد (${p.name})`);
      } else if (p.isDeleted) {
        structuralCount++;
        reasons.push(`حذف نمط (${p.name})`);
      } else {
        const base = basePatterns.find((b) => b.id === id);
        if (base && p.name !== base.name) {
          minorCount++;
          reasons.push(`تعديل اسم النمط (${p.name})`);
        }
      }
    }

    // Check Options net diff
    for (const [id, o] of optionsMap.entries()) {
      if (o.isNew) {
        structuralCount++;
        reasons.push(`إضافة خيار نمط جديد (${o.name})`);
      } else if (o.isDeleted) {
        structuralCount++;
        reasons.push(`حذف خيار نمط (${o.name})`);
      } else {
        const base = baseOptions.find((b) => b.id === id);
        if (base && o.name !== base.name) {
          minorCount++;
          reasons.push(`تعديل اسم خيار النمط (${o.name})`);
        }
      }
    }

    // Check Tasks net diff
    for (const [id, t] of tasksMap.entries()) {
      if (t.isNew) {
        structuralCount++;
        reasons.push(`إضافة مهمة جديدة (${t.name})`);
      } else if (t.isDeleted) {
        structuralCount++;
        reasons.push(`حذف مهمة (${t.name})`);
      } else {
        const base = baseTasks.find((b) => b.id === id);
        if (base) {
          if (t.departmentId !== base.departmentId) {
            structuralCount++;
            reasons.push(`تغيير قسم المهمة (${t.name})`);
          }
          if (
            t.estimatedDurationMinutes !== base.estimatedDurationMinutes ||
            t.estimatedDurationValue !== base.estimatedDurationValue ||
            t.estimatedDurationUnit !== base.estimatedDurationUnit
          ) {
            structuralCount++;
            reasons.push(`تغيير مدة المهمة (${t.name})`);
          }
          if (t.name !== base.name || t.description !== base.description) {
            minorCount++;
            reasons.push(`تعديل بيانات وصفية للمهمة (${t.name})`);
          }
        }
      }
    }

    // Check Materials net diff
    for (const [id, m] of materialsMap.entries()) {
      if (m.isNew) {
        structuralCount++;
        reasons.push('إضافة مادة مخططة');
      } else if (m.isDeleted) {
        structuralCount++;
        reasons.push('حذف مادة مخططة');
      } else {
        const base = [...baseStageMaterials, ...baseTaskMaterials].find((b) => b.id === id);
        if (base && String(m.plannedQuantity) !== String(base.plannedQuantity)) {
          structuralCount++;
          reasons.push('تعديل كمية المادة المخططة');
        }
      }
    }

    // Check Attachments net diff
    for (const [, a] of attachmentsMap.entries()) {
      if (a.isNew || a.isDeleted) {
        minorCount++;
        reasons.push('تعديل المرفقات');
      }
    }

    // Check Specs net diff
    for (const [id, s] of specsMap.entries()) {
      if (s.isNew || s.isDeleted) {
        minorCount++;
        reasons.push('تعديل المواصفات الهندسية');
      } else {
        const base = baseSpecs.find((b) => b.id === id);
        if (base && (s.name !== base.name || s.value !== base.value || s.unit !== base.unit)) {
          minorCount++;
          reasons.push('تعديل المواصفات الهندسية');
        }
      }
    }

    // Check Workflow Reorder net diff
    for (const [id, w] of wfMap.entries()) {
      if (!w.isNew && !w.isDeleted) {
        const base = baseWf.find((b) => b.id === id);
        if (base && w.sortOrder !== base.sortOrder) {
          minorCount++;
          reasons.push('إعادة ترتيب عناصر سير العمل');
          break;
        }
      }
    }

    // Check Tasks Reorder net diff
    for (const [id, t] of tasksMap.entries()) {
      if (!t.isNew && !t.isDeleted) {
        const base = baseTasks.find((b) => b.id === id);
        if (base && t.sortOrder !== base.sortOrder) {
          minorCount++;
          reasons.push('إعادة ترتيب المهام');
          break;
        }
      }
    }

    if (structuralCount > 0) {
      return {
        classification: 'STRUCTURAL',
        reasons,
        structuralCount,
        minorCount,
      };
    }

    if (minorCount > 0) {
      return {
        classification: 'MINOR',
        reasons,
        structuralCount,
        minorCount,
      };
    }

    return {
      classification: 'NONE',
      reasons: ['لا توجد تغييرات مؤثرة'],
      structuralCount: 0,
      minorCount: 0,
    };
  }
}

export const productionTemplateEditingNormalizer = new ProductionTemplateEditingNormalizer();
