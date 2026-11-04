import { EntityManager, IsNull } from 'typeorm';
import crypto from 'node:crypto';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';

export interface CloneVersionResult {
  targetVersionId: string;
  idMap: Map<string, string>;
}

export class ProductionTemplateVersionCloner {
  /**
   * Clones the entire template graph from sourceVersionId into targetVersionId under template write lock.
   * Attachments reuse stored file IDs (file_id) to avoid duplicating binary files.
   */
  async cloneVersion(
    templateId: string,
    sourceVersionId: string,
    targetVersionId: string,
    manager: EntityManager
  ): Promise<CloneVersionResult> {
    const idMap = new Map<string, string>();

    // 1. Fetch source stages with materials & attachments
    const stageRepo = manager.getRepository(ProductionTemplateStageEntity);
    const sourceStages = await stageRepo.find({
      where: { templateId, versionId: sourceVersionId, deletedAt: IsNull() },
      relations: {
        plannedMaterials: true,
        attachments: true,
      },
    });

    const newStagesToSave: ProductionTemplateStageEntity[] = [];
    const newStageMaterialsToSave: ProductionTemplateStageMaterialEntity[] = [];
    const newStageAttachmentsToSave: ProductionTemplateStageAttachmentEntity[] = [];

    for (const srcStage of sourceStages) {
      const newStageId = crypto.randomUUID();
      idMap.set(srcStage.id, newStageId);

      const newStage = stageRepo.create({
        id: newStageId,
        templateId,
        versionId: targetVersionId,
        departmentId: srcStage.departmentId,
        name: srcStage.name,
        description: srcStage.description,
        sortOrder: srcStage.sortOrder,
        estimatedDurationValue: srcStage.estimatedDurationValue,
        estimatedDurationUnit: srcStage.estimatedDurationUnit,
        estimatedDurationMinutes: srcStage.estimatedDurationMinutes,
        estimatedCost: srcStage.estimatedCost,
      });
      newStagesToSave.push(newStage);

      // Clone Stage Materials
      for (const mat of srcStage.plannedMaterials || []) {
        const newMat = manager.create(ProductionTemplateStageMaterialEntity, {
          id: crypto.randomUUID(),
          stageId: newStageId,
          productId: mat.productId,
          productUnitId: mat.productUnitId,
          plannedQuantity: mat.plannedQuantity,
        });
        newStageMaterialsToSave.push(newMat);
      }

      // Clone Stage Attachments (share stored file)
      for (const att of srcStage.attachments || []) {
        if (!att.deletedAt) {
          const newAtt = manager.create(ProductionTemplateStageAttachmentEntity, {
            id: crypto.randomUUID(),
            stageId: newStageId,
            fileId: att.fileId || null,
            storageKey: att.storageKey,
            originalFileName: att.originalFileName,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            description: att.description,
            sortOrder: att.sortOrder,
            createdByUserId: att.createdByUserId,
          });
          newStageAttachmentsToSave.push(newAtt);
        }
      }
    }

    if (newStagesToSave.length > 0) {
      await stageRepo.save(newStagesToSave);
    }
    if (newStageMaterialsToSave.length > 0) {
      await manager.getRepository(ProductionTemplateStageMaterialEntity).save(newStageMaterialsToSave);
    }
    if (newStageAttachmentsToSave.length > 0) {
      await manager.getRepository(ProductionTemplateStageAttachmentEntity).save(newStageAttachmentsToSave);
    }

    // 2. Fetch source patterns with options, tasks, task materials & attachments
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const sourcePatterns = await patternRepo.find({
      where: { templateId, versionId: sourceVersionId, deletedAt: IsNull() },
      relations: {
        options: {
          tasks: {
            plannedMaterials: true,
            attachments: true,
          },
        },
      },
    });

    const newPatternsToSave: ProductionTemplatePatternEntity[] = [];
    const newOptionsToSave: ProductionTemplatePatternOptionEntity[] = [];
    const newTasksToSave: ProductionTemplatePatternOptionTaskEntity[] = [];
    const newTaskMaterialsToSave: ProductionTemplatePatternOptionTaskMaterialEntity[] = [];
    const newTaskAttachmentsToSave: ProductionTemplatePatternOptionTaskAttachmentEntity[] = [];

    for (const srcPat of sourcePatterns) {
      const newPatternId = crypto.randomUUID();
      idMap.set(srcPat.id, newPatternId);

      const newPattern = patternRepo.create({
        id: newPatternId,
        templateId,
        versionId: targetVersionId,
        name: srcPat.name,
      });
      newPatternsToSave.push(newPattern);

      for (const srcOpt of srcPat.options || []) {
        if (!srcOpt.deletedAt) {
          const newOptionId = crypto.randomUUID();
          idMap.set(srcOpt.id, newOptionId);

          const newOption = manager.create(ProductionTemplatePatternOptionEntity, {
            id: newOptionId,
            patternId: newPatternId,
            name: srcOpt.name,
            sortOrder: srcOpt.sortOrder,
          });
          newOptionsToSave.push(newOption);

          for (const srcTask of srcOpt.tasks || []) {
            if (!srcTask.deletedAt) {
              const newTaskId = crypto.randomUUID();
              idMap.set(srcTask.id, newTaskId);

              const newTask = manager.create(ProductionTemplatePatternOptionTaskEntity, {
                id: newTaskId,
                optionId: newOptionId,
                departmentId: srcTask.departmentId,
                name: srcTask.name,
                description: srcTask.description,
                sortOrder: srcTask.sortOrder,
                estimatedDurationValue: srcTask.estimatedDurationValue,
                estimatedDurationUnit: srcTask.estimatedDurationUnit,
                estimatedDurationMinutes: srcTask.estimatedDurationMinutes,
                estimatedCost: srcTask.estimatedCost,
              });
              newTasksToSave.push(newTask);

              // Clone Task Materials
              for (const mat of srcTask.plannedMaterials || []) {
                const newMat = manager.create(ProductionTemplatePatternOptionTaskMaterialEntity, {
                  id: crypto.randomUUID(),
                  taskId: newTaskId,
                  productId: mat.productId,
                  productUnitId: mat.productUnitId,
                  plannedQuantity: mat.plannedQuantity,
                });
                newTaskMaterialsToSave.push(newMat);
              }

              // Clone Task Attachments (share stored file)
              for (const att of srcTask.attachments || []) {
                if (!att.deletedAt) {
                  const newAtt = manager.create(ProductionTemplatePatternOptionTaskAttachmentEntity, {
                    id: crypto.randomUUID(),
                    taskId: newTaskId,
                    fileId: att.fileId || null,
                    storageKey: att.storageKey,
                    originalFileName: att.originalFileName,
                    mimeType: att.mimeType,
                    sizeBytes: att.sizeBytes,
                    description: att.description,
                    sortOrder: att.sortOrder,
                    createdByUserId: att.createdByUserId,
                  });
                  newTaskAttachmentsToSave.push(newAtt);
                }
              }
            }
          }
        }
      }
    }

    if (newPatternsToSave.length > 0) {
      await patternRepo.save(newPatternsToSave);
    }
    if (newOptionsToSave.length > 0) {
      await manager.getRepository(ProductionTemplatePatternOptionEntity).save(newOptionsToSave);
    }
    if (newTasksToSave.length > 0) {
      await manager.getRepository(ProductionTemplatePatternOptionTaskEntity).save(newTasksToSave);
    }
    if (newTaskMaterialsToSave.length > 0) {
      await manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity).save(newTaskMaterialsToSave);
    }
    if (newTaskAttachmentsToSave.length > 0) {
      await manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity).save(newTaskAttachmentsToSave);
    }

    // 3. Fetch and clone workflow items
    const workflowRepo = manager.getRepository(ProductionTemplateWorkflowItemEntity);
    const sourceWorkflow = await workflowRepo.find({
      where: { templateId, versionId: sourceVersionId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    const newWorkflowItems: ProductionTemplateWorkflowItemEntity[] = [];
    for (const item of sourceWorkflow) {
      let mappedStageId: string | null = null;
      let mappedPatternId: string | null = null;

      if (item.itemType === 'STAGE' && item.stageId) {
        mappedStageId = idMap.get(item.stageId) || null;
      } else if (item.itemType === 'PATTERN' && item.patternId) {
        mappedPatternId = idMap.get(item.patternId) || null;
      }

      const newItem = workflowRepo.create({
        id: crypto.randomUUID(),
        templateId,
        versionId: targetVersionId,
        itemType: item.itemType,
        stageId: mappedStageId,
        patternId: mappedPatternId,
        sortOrder: item.sortOrder,
      });
      newWorkflowItems.push(newItem);
    }

    if (newWorkflowItems.length > 0) {
      await workflowRepo.save(newWorkflowItems);
    }

    return { targetVersionId, idMap };
  }
}

export const productionTemplateVersionCloner = new ProductionTemplateVersionCloner();
