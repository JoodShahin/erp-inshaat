import { EntityManager, IsNull, In } from 'typeorm';
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

    // 1. Fetch source stages
    const stageRepo = manager.getRepository(ProductionTemplateStageEntity);
    const sourceStages = await stageRepo.find({
      where: { templateId, versionId: sourceVersionId, deletedAt: IsNull() },
    });

    const stageIds = sourceStages.map((s) => s.id);
    const stageMatRepo = manager.getRepository(ProductionTemplateStageMaterialEntity);
    const stageAttRepo = manager.getRepository(ProductionTemplateStageAttachmentEntity);

    const sourceStageMaterials =
      stageIds.length > 0 ? await stageMatRepo.find({ where: { stageId: In(stageIds) } }) : [];
    const sourceStageAttachments =
      stageIds.length > 0
        ? await stageAttRepo.find({ where: { stageId: In(stageIds), deletedAt: IsNull() } })
        : [];

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
        estimatedDurationValue: srcStage.estimatedDurationValue,
        estimatedDurationUnit: srcStage.estimatedDurationUnit,
        estimatedDurationMinutes: srcStage.estimatedDurationMinutes,
        estimatedCost: srcStage.estimatedCost,
      });
      newStagesToSave.push(newStage);

      // Clone Stage Materials
      const matsForThisStage = sourceStageMaterials.filter((m) => m.stageId === srcStage.id);
      for (const mat of matsForThisStage) {
        const newMatId = crypto.randomUUID();
        idMap.set(mat.id, newMatId);
        const newMat = stageMatRepo.create({
          id: newMatId,
          stageId: newStageId,
          productId: mat.productId,
          productUnitId: mat.productUnitId,
          plannedQuantity: mat.plannedQuantity,
        });
        newStageMaterialsToSave.push(newMat);
      }

      // Clone Stage Attachments (share stored file)
      const attsForThisStage = sourceStageAttachments.filter((a) => a.stageId === srcStage.id);
      for (const att of attsForThisStage) {
        const newAttId = crypto.randomUUID();
        idMap.set(att.id, newAttId);
        const newAtt = stageAttRepo.create({
          id: newAttId,
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

    if (newStagesToSave.length > 0) {
      await stageRepo.save(newStagesToSave);
    }
    if (newStageMaterialsToSave.length > 0) {
      await stageMatRepo.save(newStageMaterialsToSave);
    }
    if (newStageAttachmentsToSave.length > 0) {
      await stageAttRepo.save(newStageAttachmentsToSave);
    }

    // 2. Fetch source patterns
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const optionRepo = manager.getRepository(ProductionTemplatePatternOptionEntity);
    const taskRepo = manager.getRepository(ProductionTemplatePatternOptionTaskEntity);
    const taskMatRepo = manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
    const taskAttRepo = manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);

    const sourcePatterns = await patternRepo.find({
      where: { templateId, versionId: sourceVersionId, deletedAt: IsNull() },
    });

    const patternIds = sourcePatterns.map((p) => p.id);
    const sourceOptions =
      patternIds.length > 0
        ? await optionRepo.find({
            where: { patternId: In(patternIds), deletedAt: IsNull() },
            order: { sortOrder: 'ASC' },
          })
        : [];

    const optionIds = sourceOptions.map((o) => o.id);
    const sourceTasks =
      optionIds.length > 0
        ? await taskRepo.find({
            where: { optionId: In(optionIds), deletedAt: IsNull() },
            order: { sortOrder: 'ASC' },
          })
        : [];

    const taskIds = sourceTasks.map((t) => t.id);
    const sourceTaskMaterials =
      taskIds.length > 0 ? await taskMatRepo.find({ where: { taskId: In(taskIds) } }) : [];
    const sourceTaskAttachments =
      taskIds.length > 0
        ? await taskAttRepo.find({ where: { taskId: In(taskIds), deletedAt: IsNull() } })
        : [];

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

      const optionsForPattern = sourceOptions.filter((o) => o.patternId === srcPat.id);
      for (const srcOpt of optionsForPattern) {
        const newOptionId = crypto.randomUUID();
        idMap.set(srcOpt.id, newOptionId);

        const newOption = optionRepo.create({
          id: newOptionId,
          patternId: newPatternId,
          name: srcOpt.name,
          sortOrder: srcOpt.sortOrder,
        });
        newOptionsToSave.push(newOption);

        const tasksForOption = sourceTasks.filter((t) => t.optionId === srcOpt.id);
        for (const srcTask of tasksForOption) {
          const newTaskId = crypto.randomUUID();
          idMap.set(srcTask.id, newTaskId);

          const newTask = taskRepo.create({
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
          const matsForTask = sourceTaskMaterials.filter((m) => m.taskId === srcTask.id);
          for (const mat of matsForTask) {
            const newMatId = crypto.randomUUID();
            idMap.set(mat.id, newMatId);
            const newMat = taskMatRepo.create({
              id: newMatId,
              taskId: newTaskId,
              productId: mat.productId,
              productUnitId: mat.productUnitId,
              plannedQuantity: mat.plannedQuantity,
            });
            newTaskMaterialsToSave.push(newMat);
          }

          // Clone Task Attachments (share stored file)
          const attsForTask = sourceTaskAttachments.filter((a) => a.taskId === srcTask.id);
          for (const att of attsForTask) {
            const newAttId = crypto.randomUUID();
            idMap.set(att.id, newAttId);
            const newAtt = taskAttRepo.create({
              id: newAttId,
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

    if (newPatternsToSave.length > 0) {
      await patternRepo.save(newPatternsToSave);
    }
    if (newOptionsToSave.length > 0) {
      await optionRepo.save(newOptionsToSave);
    }
    if (newTasksToSave.length > 0) {
      await taskRepo.save(newTasksToSave);
    }
    if (newTaskMaterialsToSave.length > 0) {
      await taskMatRepo.save(newTaskMaterialsToSave);
    }
    if (newTaskAttachmentsToSave.length > 0) {
      await taskAttRepo.save(newTaskAttachmentsToSave);
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

      const newWfItemId = crypto.randomUUID();
      idMap.set(item.id, newWfItemId);
      const newItem = workflowRepo.create({
        id: newWfItemId,
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
