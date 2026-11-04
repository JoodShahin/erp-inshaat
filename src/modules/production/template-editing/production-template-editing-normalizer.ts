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

export interface NormalizedClassificationResult extends ClassificationResult {
  normalizedOperations: TemplateEditingOperationDto[];
  hasEffectiveChanges: boolean;
}

export function areCostsEqual(a?: string | number | null, b?: string | number | null): boolean {
  if ((a === undefined || a === null || a === '') && (b === undefined || b === null || b === '')) {
    return true;
  }
  if (a == null || b == null || a === '' || b === '') {
    return false;
  }
  const strA = String(a).trim();
  const strB = String(b).trim();
  if (strA === strB) return true;
  const numA = Number(strA);
  const numB = Number(strB);
  if (isNaN(numA) || isNaN(numB)) return strA === strB;
  return Math.abs(numA - numB) < 0.000001;
}

interface InMemStage {
  id: string;
  name: string;
  description: string | null;
  departmentId: string;
  estimatedDurationMinutes: number | null;
  estimatedDurationValue: number | null;
  estimatedDurationUnit: string | null;
  estimatedCost: string | null;
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
  estimatedCost: string | null;
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
  notes: string | null;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface InMemAttachment {
  id: string;
  parentId: string; // stageId or taskId
  parentType: 'STAGE' | 'TASK';
  fileId?: string;
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
  ): Promise<NormalizedClassificationResult> {
    if (!operations || operations.length === 0) {
      return {
        classification: 'NONE',
        reasons: ['لا توجد عمليات تعديل'],
        structuralCount: 0,
        minorCount: 0,
        normalizedOperations: [],
        hasEffectiveChanges: false,
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
        estimatedCost: s.estimatedCost ? String(s.estimatedCost) : null,
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
        estimatedCost: t.estimatedCost ? String(t.estimatedCost) : null,
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
        notes: (m as any).notes || null,
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
        notes: (m as any).notes || null,
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
            estimatedCost: op.payload?.estimatedCost != null ? String(op.payload.estimatedCost) : null,
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
          if (op.payload?.estimatedCost !== undefined) {
            stage.estimatedCost = op.payload.estimatedCost != null ? String(op.payload.estimatedCost) : null;
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
              if (wf.isNew || stage.isNew) wfMap.delete(wfId);
              else wf.isDeleted = true;
            }
          }

          // Cascade to stage materials
          for (const [matId, mat] of materialsMap.entries()) {
            if (mat.parentType === 'STAGE' && mat.parentId === targetId) {
              if (mat.isNew || stage.isNew) materialsMap.delete(matId);
              else mat.isDeleted = true;
            }
          }

          // Cascade to stage attachments
          for (const [attId, att] of attachmentsMap.entries()) {
            if (att.parentType === 'STAGE' && att.parentId === targetId) {
              if (att.isNew || stage.isNew) attachmentsMap.delete(attId);
              else att.isDeleted = true;
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

          // Cascade to workflow item
          for (const [wfId, wf] of wfMap.entries()) {
            if (wf.targetId === targetId) {
              if (wf.isNew || pat.isNew) wfMap.delete(wfId);
              else wf.isDeleted = true;
            }
          }

          // Cascade to options and their tasks/materials/attachments
          for (const [optId, opt] of optionsMap.entries()) {
            if (opt.patternId === targetId) {
              if (opt.isNew || pat.isNew) optionsMap.delete(optId);
              else opt.isDeleted = true;

              for (const [taskId, task] of tasksMap.entries()) {
                if (task.optionId === optId) {
                  if (task.isNew || pat.isNew) tasksMap.delete(taskId);
                  else task.isDeleted = true;

                  for (const [matId, mat] of materialsMap.entries()) {
                    if (mat.parentType === 'TASK' && mat.parentId === taskId) {
                      if (mat.isNew || pat.isNew) materialsMap.delete(matId);
                      else mat.isDeleted = true;
                    }
                  }

                  for (const [attId, att] of attachmentsMap.entries()) {
                    if (att.parentType === 'TASK' && att.parentId === taskId) {
                      if (att.isNew || pat.isNew) attachmentsMap.delete(attId);
                      else att.isDeleted = true;
                    }
                  }
                }
              }
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
          if (!opt) {
            throw new BusinessRuleError(`الخيار المستهدف للتعديل غير موجود: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
          }
          const parentPat = patternsMap.get(opt.patternId);
          if (parentPat && parentPat.isDeleted) {
            throw new BusinessRuleError(`لا يمكن تعديل خيار تابع لنمط تم حذفه: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_PARENT_DELETED');
          }
          if (opt.isDeleted) {
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
          if (opt.isNew) {
            optionsMap.delete(targetId);
          } else {
            opt.isDeleted = true;
          }

          // Cascade to tasks under this option
          for (const [taskId, task] of tasksMap.entries()) {
            if (task.optionId === targetId) {
              if (task.isNew || opt.isNew) tasksMap.delete(taskId);
              else task.isDeleted = true;

              for (const [matId, mat] of materialsMap.entries()) {
                if (mat.parentType === 'TASK' && mat.parentId === taskId) {
                  if (mat.isNew || opt.isNew) materialsMap.delete(matId);
                  else mat.isDeleted = true;
                }
              }

              for (const [attId, att] of attachmentsMap.entries()) {
                if (att.parentType === 'TASK' && att.parentId === taskId) {
                  if (att.isNew || opt.isNew) attachmentsMap.delete(attId);
                  else att.isDeleted = true;
                }
              }
            }
          }
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
            estimatedCost: op.payload?.estimatedCost != null ? String(op.payload.estimatedCost) : null,
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
          if (!task) {
            throw new BusinessRuleError(`المهمة المستهدفة للتعديل غير موجودة: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
          }
          const parentOpt = optionsMap.get(task.optionId);
          if (parentOpt && parentOpt.isDeleted) {
            throw new BusinessRuleError(`لا يمكن تعديل مهمة تابعة لخيار تم حذفه: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_PARENT_DELETED');
          }
          if (parentOpt) {
            const parentPat = patternsMap.get(parentOpt.patternId);
            if (parentPat && parentPat.isDeleted) {
              throw new BusinessRuleError(`لا يمكن تعديل مهمة تابعة لنمط تم حذفه: ${targetId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_PARENT_DELETED');
            }
          }
          if (task.isDeleted) {
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
          if (op.payload?.estimatedCost !== undefined) {
            task.estimatedCost = op.payload.estimatedCost != null ? String(op.payload.estimatedCost) : null;
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

          // Cascade to task materials and attachments
          for (const [matId, mat] of materialsMap.entries()) {
            if (mat.parentType === 'TASK' && mat.parentId === targetId) {
              if (mat.isNew || task.isNew) materialsMap.delete(matId);
              else mat.isDeleted = true;
            }
          }

          for (const [attId, att] of attachmentsMap.entries()) {
            if (att.parentType === 'TASK' && att.parentId === targetId) {
              if (att.isNew || task.isNew) attachmentsMap.delete(attId);
              else att.isDeleted = true;
            }
          }
          break;
        }

        case 'REORDER_WORKFLOW': {
          const rawItemIds: string[] = op.payload?.itemIds || op.payload?.orderedItemIds || [];
          if (rawItemIds.length > 0) {
            const findWfItem = (idOrTarget: string): InMemWorkflowItem | undefined => {
              const resolved = resolveRef(idOrTarget);
              if (wfMap.has(resolved)) {
                const item = wfMap.get(resolved)!;
                if (!item.isDeleted) return item;
              }
              for (const wf of wfMap.values()) {
                if (!wf.isDeleted && (wf.id === resolved || wf.targetId === resolved || wf.id === idOrTarget || wf.targetId === idOrTarget)) {
                  return wf;
                }
              }
              return undefined;
            };

            const seenIds = new Set<string>();
            const targetWfs: InMemWorkflowItem[] = [];

            for (const raw of rawItemIds) {
              const wf = findWfItem(raw);
              if (!wf) {
                throw new BusinessRuleError(
                  `عنصر سير العمل غير موجود أو لا ينتمي لهذا الإصدار: ${raw}`,
                  'PRODUCTION_TEMPLATE_WORKFLOW_ITEM_NOT_FOUND'
                );
              }
              if (seenIds.has(wf.id)) {
                throw new BusinessRuleError(
                  'تكرار في معرفات عناصر سير العمل',
                  'PRODUCTION_TEMPLATE_WORKFLOW_DUPLICATE_ITEM'
                );
              }
              seenIds.add(wf.id);
              targetWfs.push(wf);
            }

            const activeWfItems = Array.from(wfMap.values()).filter((w) => !w.isDeleted);
            if (seenIds.size !== activeWfItems.length) {
              throw new BusinessRuleError(
                'قائمة إعادة ترتيب سير العمل يجب أن تشمل جميع العناصر النشطة',
                'PRODUCTION_TEMPLATE_WORKFLOW_REORDER_INCOMPLETE'
              );
            }

            for (let i = 0; i < targetWfs.length; i++) {
              targetWfs[i].sortOrder = i + 1;
            }
          }
          break;
        }

        case 'REORDER_PATTERN_OPTIONS': {
          const patternId = resolveRef(op.targetId || op.parentId);
          const rawOptIds: string[] = op.payload?.optionIds || op.payload?.orderedOptionIds || [];
          if (rawOptIds.length > 0) {
            const seenOptIds = new Set<string>();
            const patternOpts = Array.from(optionsMap.values()).filter(
              (o) => !o.isDeleted && o.patternId === patternId
            );
            for (const raw of rawOptIds) {
              const optId = resolveRef(raw);
              const opt = optionsMap.get(optId);
              if (!opt || opt.isDeleted || opt.patternId !== patternId) {
                throw new BusinessRuleError(
                  `أحد خيارات النمط المراد ترتيبها غير موجود أو لا ينتمي لهذا النمط: ${raw}`,
                  'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND'
                );
              }
              if (seenOptIds.has(optId)) {
                throw new BusinessRuleError(
                  'تكرار في معرفات خيارات النمط المراد ترتيبها',
                  'PRODUCTION_TEMPLATE_PATTERN_OPTION_REORDER_DUPLICATE'
                );
              }
              seenOptIds.add(optId);
            }
            if (seenOptIds.size !== patternOpts.length) {
              throw new BusinessRuleError(
                'قائمة إعادة ترتيب خيارات النمط يجب أن تشمل جميع الخيارات النشطة',
                'PRODUCTION_TEMPLATE_PATTERN_OPTION_REORDER_INCOMPLETE'
              );
            }
            for (let i = 0; i < rawOptIds.length; i++) {
              const opt = optionsMap.get(resolveRef(rawOptIds[i]))!;
              opt.sortOrder = i + 1;
            }
          }
          break;
        }

        case 'REORDER_OPTION_TASKS': {
          const optionId = resolveRef(op.targetId || op.parentId);
          const rawTaskIds: string[] = op.payload?.taskIds || op.payload?.orderedTaskIds || [];
          if (rawTaskIds.length > 0) {
            const seenTaskIds = new Set<string>();
            const optionTasks = Array.from(tasksMap.values()).filter(
              (t) => !t.isDeleted && t.optionId === optionId
            );
            for (const raw of rawTaskIds) {
              const taskId = resolveRef(raw);
              const task = tasksMap.get(taskId);
              if (!task || task.isDeleted || task.optionId !== optionId) {
                throw new BusinessRuleError(
                  `إحدى المهام المراد ترتيبها غير موجودة أو لا تنتمي لهذا الخيار: ${raw}`,
                  'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND'
                );
              }
              if (seenTaskIds.has(taskId)) {
                throw new BusinessRuleError(
                  'تكرار في معرفات المهام المراد ترتيبها',
                  'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_REORDER_DUPLICATE'
                );
              }
              seenTaskIds.add(taskId);
            }
            if (seenTaskIds.size !== optionTasks.length) {
              throw new BusinessRuleError(
                'قائمة إعادة ترتيب المهام يجب أن تشمل جميع المهام النشطة',
                'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_REORDER_INCOMPLETE'
              );
            }
            for (let i = 0; i < rawTaskIds.length; i++) {
              const task = tasksMap.get(resolveRef(rawTaskIds[i]))!;
              task.sortOrder = i + 1;
            }
          }
          break;
        }

        case 'ADD_STAGE_MATERIAL':
        case 'ADD_TASK_MATERIAL': {
          const parentId = resolveRef(op.parentId);
          if (op.type === 'ADD_STAGE_MATERIAL') {
            const parentStage = stagesMap.get(parentId);
            if (!parentStage || parentStage.isDeleted) {
              throw new BusinessRuleError(`المرحلة الأب غير موجودة أو تم حذفها: ${parentId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
            }
          } else {
            const parentTask = tasksMap.get(parentId);
            if (!parentTask || parentTask.isDeleted) {
              throw new BusinessRuleError(`المهمة الأب غير موجودة أو تم حذفها: ${parentId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
            }
          }

          const plannedQuantityStr = op.payload?.plannedQuantity != null && String(op.payload.plannedQuantity).trim() !== ''
            ? String(op.payload.plannedQuantity)
            : op.payload?.quantity != null && String(op.payload.quantity).trim() !== ''
              ? String(op.payload.quantity)
              : '1';

          const tempId = `tmp-mat-${materialsMap.size + 1}`;
          materialsMap.set(tempId, {
            id: tempId,
            parentId,
            parentType: op.type === 'ADD_STAGE_MATERIAL' ? 'STAGE' : 'TASK',
            productId: op.payload?.productId,
            productUnitId: op.payload?.productUnitId,
            plannedQuantity: plannedQuantityStr,
            notes: op.payload?.notes || null,
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
          if (op.payload?.storageKey || op.payload?.filePath || op.payload?.path) {
            throw new BusinessRuleError(
              'يُحظر تمرير مسار الملف أو storageKey مباشرة من العميل. استخدم uploadToken أو fileId فقط.',
              'PRODUCTION_TEMPLATE_ATTACHMENT_STORAGE_KEY_FORBIDDEN'
            );
          }
          const parentId = resolveRef(op.parentId);
          if (op.type === 'ADD_STAGE_ATTACHMENT') {
            const parentStage = stagesMap.get(parentId);
            if (!parentStage || parentStage.isDeleted) {
              throw new BusinessRuleError(`المرحلة الأب غير موجودة أو تم حذفها: ${parentId}`, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
            }
          } else {
            const parentTask = tasksMap.get(parentId);
            if (!parentTask || parentTask.isDeleted) {
              throw new BusinessRuleError(`المهمة الأب غير موجودة أو تم حذفها: ${parentId}`, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
            }
          }
          const tempId = `tmp-att-${attachmentsMap.size + 1}`;
          attachmentsMap.set(tempId, {
            id: tempId,
            parentId,
            parentType: op.type === 'ADD_STAGE_ATTACHMENT' ? 'STAGE' : 'TASK',
            fileId: op.payload?.fileId,
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
          if (!areCostsEqual(s.estimatedCost, base.estimatedCost)) {
            minorCount++;
            reasons.push(`تعديل التكلفة التقديرية للمرحلة (${s.name})`);
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
          if (!areCostsEqual(t.estimatedCost, base.estimatedCost)) {
            minorCount++;
            reasons.push(`تعديل التكلفة التقديرية للمهمة (${t.name})`);
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

    const normalizedOperations: TemplateEditingOperationDto[] = [];

    // Stages
    for (const [id, s] of stagesMap.entries()) {
      if (s.isNew && !s.isDeleted) {
        normalizedOperations.push({
          type: 'ADD_STAGE',
          tempClientId: s.id,
          payload: {
            name: s.name,
            description: s.description,
            departmentId: s.departmentId,
            estimatedDurationMinutes: s.estimatedDurationMinutes,
            estimatedDurationValue: s.estimatedDurationValue,
            estimatedDurationUnit: s.estimatedDurationUnit,
            estimatedCost: s.estimatedCost ?? null,
          },
        });
      } else if (!s.isNew && !s.isDeleted) {
        const base = baseStages.find((b) => b.id === id);
        if (
          base &&
          (s.name !== base.name ||
            s.description !== base.description ||
            s.departmentId !== base.departmentId ||
            s.estimatedDurationMinutes !== base.estimatedDurationMinutes ||
            s.estimatedDurationValue !== base.estimatedDurationValue ||
            s.estimatedDurationUnit !== base.estimatedDurationUnit ||
            !areCostsEqual(s.estimatedCost, base.estimatedCost))
        ) {
          normalizedOperations.push({
            type: 'UPDATE_STAGE',
            targetId: s.id,
            payload: {
              name: s.name,
              description: s.description,
              departmentId: s.departmentId,
              estimatedDurationMinutes: s.estimatedDurationMinutes,
              estimatedDurationValue: s.estimatedDurationValue,
              estimatedDurationUnit: s.estimatedDurationUnit,
              estimatedCost: s.estimatedCost ?? null,
            },
          });
        }
      } else if (!s.isNew && s.isDeleted) {
        normalizedOperations.push({
          type: 'DELETE_STAGE',
          targetId: s.id,
        });
      }
    }

    // Patterns
    for (const [id, p] of patternsMap.entries()) {
      if (p.isNew && !p.isDeleted) {
        normalizedOperations.push({
          type: 'ADD_PATTERN',
          tempClientId: p.id,
          payload: { name: p.name },
        });
      } else if (!p.isNew && !p.isDeleted) {
        const base = basePatterns.find((b) => b.id === id);
        if (base && p.name !== base.name) {
          normalizedOperations.push({
            type: 'UPDATE_PATTERN',
            targetId: p.id,
            payload: { name: p.name },
          });
        }
      } else if (!p.isNew && p.isDeleted) {
        normalizedOperations.push({
          type: 'DELETE_PATTERN',
          targetId: p.id,
        });
      }
    }

    // Options
    for (const [id, o] of optionsMap.entries()) {
      const parentPat = patternsMap.get(o.patternId);
      if (parentPat && parentPat.isDeleted) continue;

      if (o.isNew && !o.isDeleted) {
        normalizedOperations.push({
          type: 'ADD_OPTION',
          parentId: o.patternId,
          tempClientId: o.id,
          payload: { name: o.name, sortOrder: o.sortOrder },
        });
      } else if (!o.isNew && !o.isDeleted) {
        const base = baseOptions.find((b) => b.id === id);
        if (base && (o.name !== base.name || o.sortOrder !== base.sortOrder)) {
          normalizedOperations.push({
            type: 'UPDATE_OPTION',
            targetId: o.id,
            payload: { name: o.name, sortOrder: o.sortOrder },
          });
        }
      } else if (!o.isNew && o.isDeleted) {
        normalizedOperations.push({
          type: 'DELETE_OPTION',
          targetId: o.id,
        });
      }
    }

    // Tasks
    for (const [id, t] of tasksMap.entries()) {
      const parentOpt = optionsMap.get(t.optionId);
      if (parentOpt && parentOpt.isDeleted) continue;
      if (parentOpt) {
        const parentPat = patternsMap.get(parentOpt.patternId);
        if (parentPat && parentPat.isDeleted) continue;
      }

      if (t.isNew && !t.isDeleted) {
        normalizedOperations.push({
          type: 'ADD_TASK',
          parentId: t.optionId,
          tempClientId: t.id,
          payload: {
            name: t.name,
            description: t.description,
            departmentId: t.departmentId,
            sortOrder: t.sortOrder,
            estimatedDurationMinutes: t.estimatedDurationMinutes,
            estimatedDurationValue: t.estimatedDurationValue,
            estimatedDurationUnit: t.estimatedDurationUnit,
            estimatedCost: t.estimatedCost ?? null,
          },
        });
      } else if (!t.isNew && !t.isDeleted) {
        const base = baseTasks.find((b) => b.id === id);
        if (
          base &&
          (t.name !== base.name ||
            t.description !== base.description ||
            t.departmentId !== base.departmentId ||
            t.sortOrder !== base.sortOrder ||
            t.estimatedDurationMinutes !== base.estimatedDurationMinutes ||
            t.estimatedDurationValue !== base.estimatedDurationValue ||
            t.estimatedDurationUnit !== base.estimatedDurationUnit ||
            !areCostsEqual(t.estimatedCost, base.estimatedCost))
        ) {
          normalizedOperations.push({
            type: 'UPDATE_TASK',
            targetId: t.id,
            payload: {
              name: t.name,
              description: t.description,
              departmentId: t.departmentId,
              sortOrder: t.sortOrder,
              estimatedDurationMinutes: t.estimatedDurationMinutes,
              estimatedDurationValue: t.estimatedDurationValue,
              estimatedDurationUnit: t.estimatedDurationUnit,
              estimatedCost: t.estimatedCost ?? null,
            },
          });
        }
      } else if (!t.isNew && t.isDeleted) {
        normalizedOperations.push({
          type: 'DELETE_TASK',
          targetId: t.id,
        });
      }
    }

    // Materials
    for (const [id, m] of materialsMap.entries()) {
      if (m.parentType === 'STAGE') {
        const parentStage = stagesMap.get(m.parentId);
        if (parentStage && parentStage.isDeleted) continue;
      } else {
        const parentTask = tasksMap.get(m.parentId);
        if (parentTask && parentTask.isDeleted) continue;
        if (parentTask) {
          const parentOpt = optionsMap.get(parentTask.optionId);
          if (parentOpt && parentOpt.isDeleted) continue;
          if (parentOpt) {
            const parentPat = patternsMap.get(parentOpt.patternId);
            if (parentPat && parentPat.isDeleted) continue;
          }
        }
      }

      if (m.isNew && !m.isDeleted) {
        normalizedOperations.push({
          type: m.parentType === 'STAGE' ? 'ADD_STAGE_MATERIAL' : 'ADD_TASK_MATERIAL',
          parentId: m.parentId,
          payload: {
            productId: m.productId,
            productUnitId: m.productUnitId,
            plannedQuantity: m.plannedQuantity,
            notes: m.notes ?? null,
          },
        });
      } else if (!m.isNew && m.isDeleted) {
        normalizedOperations.push({
          type: m.parentType === 'STAGE' ? 'DELETE_STAGE_MATERIAL' : 'DELETE_TASK_MATERIAL',
          targetId: m.id,
        });
      }
    }

    // Attachments
    for (const [id, a] of attachmentsMap.entries()) {
      if (a.parentType === 'STAGE') {
        const parentStage = stagesMap.get(a.parentId);
        if (parentStage && parentStage.isDeleted) continue;
      } else {
        const parentTask = tasksMap.get(a.parentId);
        if (parentTask && parentTask.isDeleted) continue;
        if (parentTask) {
          const parentOpt = optionsMap.get(parentTask.optionId);
          if (parentOpt && parentOpt.isDeleted) continue;
          if (parentOpt) {
            const parentPat = patternsMap.get(parentOpt.patternId);
            if (parentPat && parentPat.isDeleted) continue;
          }
        }
      }

      if (a.isNew && !a.isDeleted) {
        normalizedOperations.push({
          type: a.parentType === 'STAGE' ? 'ADD_STAGE_ATTACHMENT' : 'ADD_TASK_ATTACHMENT',
          parentId: a.parentId,
          payload: {
            uploadToken: a.uploadToken,
            fileId: a.fileId,
            description: a.description,
            sortOrder: a.sortOrder,
          },
        });
      } else if (!a.isNew && a.isDeleted) {
        normalizedOperations.push({
          type: a.parentType === 'STAGE' ? 'DELETE_STAGE_ATTACHMENT' : 'DELETE_TASK_ATTACHMENT',
          targetId: a.id,
        });
      }
    }

    // Specs
    for (const [id, s] of specsMap.entries()) {
      if (s.isNew && !s.isDeleted) {
        normalizedOperations.push({
          type: 'ADD_SPEC',
          payload: {
            name: s.name,
            value: s.value,
            unit: s.unit,
            sortOrder: s.sortOrder,
          },
        });
      } else if (!s.isNew && !s.isDeleted) {
        const base = baseSpecs.find((b) => b.id === id);
        if (base && (s.name !== base.name || s.value !== base.value || s.unit !== base.unit)) {
          normalizedOperations.push({
            type: 'UPDATE_SPEC',
            targetId: s.id,
            payload: {
              name: s.name,
              value: s.value,
              unit: s.unit,
            },
          });
        }
      } else if (!s.isNew && s.isDeleted) {
        normalizedOperations.push({
          type: 'DELETE_SPEC',
          targetId: s.id,
        });
      }
    }

    // Pattern Options Reorder
    for (const [patternId, pat] of patternsMap.entries()) {
      if (pat.isDeleted) continue;
      const activeOpts = Array.from(optionsMap.values())
        .filter((o) => !o.isDeleted && o.patternId === patternId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      let orderChanged = false;
      const baseOptsForPat = baseOptions
        .filter((b) => b.patternId === patternId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      if (activeOpts.length === baseOptsForPat.length) {
        for (let i = 0; i < activeOpts.length; i++) {
          if (activeOpts[i].id !== baseOptsForPat[i].id) {
            orderChanged = true;
            break;
          }
        }
      }
      if (orderChanged && activeOpts.length > 1) {
        normalizedOperations.push({
          type: 'REORDER_PATTERN_OPTIONS',
          targetId: patternId,
          payload: {
            optionIds: activeOpts.map((o) => o.id),
          },
        });
      }
    }

    // Option Tasks Reorder
    for (const [optionId, opt] of optionsMap.entries()) {
      if (opt.isDeleted) continue;
      const parentPat = patternsMap.get(opt.patternId);
      if (parentPat && parentPat.isDeleted) continue;

      const activeTasks = Array.from(tasksMap.values())
        .filter((t) => !t.isDeleted && t.optionId === optionId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      let orderChanged = false;
      const baseTasksForOpt = baseTasks
        .filter((b) => b.optionId === optionId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      if (activeTasks.length === baseTasksForOpt.length) {
        for (let i = 0; i < activeTasks.length; i++) {
          if (activeTasks[i].id !== baseTasksForOpt[i].id) {
            orderChanged = true;
            break;
          }
        }
      }
      if (orderChanged && activeTasks.length > 1) {
        normalizedOperations.push({
          type: 'REORDER_OPTION_TASKS',
          targetId: optionId,
          payload: {
            taskIds: activeTasks.map((t) => t.id),
          },
        });
      }
    }

    // Workflow Reorder
    const activeWfItems = Array.from(wfMap.values())
      .filter((w) => !w.isDeleted)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    let wfOrderChanged = false;
    for (const [id, w] of wfMap.entries()) {
      if (!w.isNew && !w.isDeleted) {
        const base = baseWf.find((b) => b.id === id);
        if (base && w.sortOrder !== base.sortOrder) {
          wfOrderChanged = true;
          break;
        }
      }
    }
    if (wfOrderChanged && activeWfItems.length > 1) {
      const finalWorkflowItemIds = activeWfItems.map((w) => (w.isNew ? w.targetId : w.id));
      normalizedOperations.push({
        type: 'REORDER_WORKFLOW',
        payload: { itemIds: finalWorkflowItemIds },
      });
    }

    const hasEffectiveChanges = normalizedOperations.length > 0;
    let finalClassification: 'STRUCTURAL' | 'MINOR' | 'NONE' = 'NONE';
    if (!hasEffectiveChanges) {
      finalClassification = 'NONE';
    } else if (structuralCount > 0) {
      finalClassification = 'STRUCTURAL';
    } else if (minorCount > 0) {
      finalClassification = 'MINOR';
    }

    return {
      classification: finalClassification,
      reasons: hasEffectiveChanges ? reasons : ['لا توجد تغييرات مؤثرة'],
      structuralCount: hasEffectiveChanges ? structuralCount : 0,
      minorCount: hasEffectiveChanges ? minorCount : 0,
      normalizedOperations,
      hasEffectiveChanges,
    };
  }
}

export const productionTemplateEditingNormalizer = new ProductionTemplateEditingNormalizer();
