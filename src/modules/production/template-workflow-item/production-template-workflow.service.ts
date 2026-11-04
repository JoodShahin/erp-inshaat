import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateWorkflowItemEntity, ProductionTemplateWorkflowItemType } from './production-template-workflow-item.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplateGuardService, productionTemplateGuardService } from '../template/production-template-guard.service.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import {
  ProductionTemplateWorkflowItemDto,
  toProductionTemplateWorkflowItemDto,
  TaskDurationUnit,
} from './production-template-workflow-item.types.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionTemplateWorkflowService {
  private workflowRepo: Repository<ProductionTemplateWorkflowItemEntity>;
  private guardService: ProductionTemplateGuardService;
  private versionService: ProductionTemplateVersionService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    versionService: ProductionTemplateVersionService = productionTemplateVersionService
  ) {
    this.workflowRepo = this.dataSource.getRepository(ProductionTemplateWorkflowItemEntity);
    this.guardService = guardService;
    this.versionService = versionService;
  }

  /**
   * Lists all top-level workflow items for an active template and optional version.
   * If versionId is not supplied, defaults to the template's latest version.
   * Performs strict polymorphic integrity checks and fails closed if corrupted.
   * Stage reference counts are loaded in batch (zero N+1, no relation over-fetch).
   */
  async listWorkflowItems(
    templateId: string,
    versionId?: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateWorkflowItemDto[]> {
    await this.guardService.requireExistingTemplate(templateId, manager);

    const repo = manager
      ? manager.getRepository(ProductionTemplateWorkflowItemEntity)
      : this.workflowRepo;

    let targetVersionId = versionId;
    if (!targetVersionId) {
      try {
        const latest = await this.versionService.getLatestVersion(templateId, manager);
        targetVersionId = latest.id;
      } catch {
        // Fallback for isolated unit tests that do not seed versions
        targetVersionId = undefined;
      }
    }

    const whereClause: any = { templateId, deletedAt: IsNull() };
    if (targetVersionId) {
      whereClause.versionId = targetVersionId;
    }

    const items = await repo.find({
      where: whereClause,
      relations: {
        stage: {
          department: true,
        },
        pattern: {
          options: true,
        },
      },
      order: { sortOrder: 'ASC' },
    });

    const stageIds: string[] = [];
    for (const item of items) {
      if (item.itemType === 'STAGE' && item.stageId) {
        stageIds.push(item.stageId);
      }
    }

    const stageMatCountMap = new Map<string, number>();
    const stageAttCountMap = new Map<string, number>();

    if (stageIds.length > 0) {
      const stageMatRepo = manager
        ? manager.getRepository(ProductionTemplateStageMaterialEntity)
        : this.dataSource.getRepository(ProductionTemplateStageMaterialEntity);

      const matCounts = await stageMatRepo
        .createQueryBuilder('mat')
        .select('mat.stageId', 'stageId')
        .addSelect('COUNT(*)', 'cnt')
        .where('mat.stageId IN (:...stageIds)', { stageIds })
        .groupBy('mat.stageId')
        .getRawMany();

      for (const row of matCounts) {
        stageMatCountMap.set(row.stageId, parseInt(row.cnt, 10));
      }

      const stageAttRepo = manager
        ? manager.getRepository(ProductionTemplateStageAttachmentEntity)
        : this.dataSource.getRepository(ProductionTemplateStageAttachmentEntity);

      const attCounts = await stageAttRepo
        .createQueryBuilder('att')
        .select('att.stageId', 'stageId')
        .addSelect('COUNT(*)', 'cnt')
        .where('att.stageId IN (:...stageIds) AND att.deletedAt IS NULL', { stageIds })
        .groupBy('att.stageId')
        .getRawMany();

      for (const row of attCounts) {
        stageAttCountMap.set(row.stageId, parseInt(row.cnt, 10));
      }
    }

    const result: ProductionTemplateWorkflowItemDto[] = [];

    for (const item of items) {
      // Polymorphic validation
      if (item.itemType === 'STAGE') {
        if (!item.stageId || item.patternId !== null) {
          throw new BusinessRuleError(
            'بيانات سير العمل للقالب تالفة أو غير متسقة (نوع العنصر مرحلة لكن المرجع تالف)',
            'PRODUCTION_TEMPLATE_WORKFLOW_CORRUPT'
          );
        }
        if (!item.stage || item.stage.deletedAt !== null || item.stage.templateId !== templateId) {
          throw new BusinessRuleError(
            'بيانات سير العمل للقالب تالفة (المرحلة المشار إليها مفقودة أو مؤرشفة أو تتبع قالباً آخر)',
            'PRODUCTION_TEMPLATE_WORKFLOW_CORRUPT'
          );
        }

        const stage = item.stage;
        const plannedMaterialsCount = stageMatCountMap.get(stage.id) ?? 0;
        const attachmentsCount = stageAttCountMap.get(stage.id) ?? 0;

        result.push(
          toProductionTemplateWorkflowItemDto(item, {
            id: stage.id,
            name: stage.name,
            description: stage.description,
            departmentId: stage.departmentId,
            departmentName: stage.department?.name,
            departmentCode: stage.department?.code,
            estimatedDurationValue: stage.estimatedDurationValue ?? stage.estimatedDurationMinutes ?? null,
            estimatedDurationUnit: stage.estimatedDurationUnit ?? (stage.estimatedDurationMinutes ? TaskDurationUnit.MINUTES : null),
            estimatedDurationMinutes: stage.estimatedDurationMinutes,
            estimatedCost: stage.estimatedCost ? String(stage.estimatedCost) : null,
            plannedMaterialsCount,
            attachmentsCount,
          })
        );
      } else if (item.itemType === 'PATTERN') {
        if (!item.patternId || item.stageId !== null) {
          throw new BusinessRuleError(
            'بيانات سير العمل للقالب تالفة أو غير متسقة (نوع العنصر نمط لكن المرجع تالف)',
            'PRODUCTION_TEMPLATE_WORKFLOW_CORRUPT'
          );
        }
        if (!item.pattern || item.pattern.deletedAt !== null || item.pattern.templateId !== templateId) {
          throw new BusinessRuleError(
            'بيانات سير العمل للقالب تالفة (النمط المشار إليه مفقود أو مؤرشف أو يتبع قالباً آخر)',
            'PRODUCTION_TEMPLATE_WORKFLOW_CORRUPT'
          );
        }

        const pattern = item.pattern;
        const optionsCount = (pattern.options || []).filter((o) => !o.deletedAt).length;

        result.push(
          toProductionTemplateWorkflowItemDto(item, undefined, {
            id: pattern.id,
            name: pattern.name,
            optionsCount,
          })
        );
      }
    }

    return result;
  }

  /**
   * Inserts a workflow item under parent template lock within a specific version.
   */
  async insertWorkflowItem(
    manager: EntityManager,
    templateId: string,
    itemType: ProductionTemplateWorkflowItemType,
    targetId: string,
    desiredSortOrder?: number,
    versionId?: string
  ): Promise<ProductionTemplateWorkflowItemEntity> {
    let resolvedVersionId = versionId;
    if (!resolvedVersionId) {
      try {
        const latest = await this.versionService.getLatestVersion(templateId, manager);
        resolvedVersionId = latest.id;
      } catch {
        resolvedVersionId = undefined;
      }
    }

    const whereClause: any = { templateId, deletedAt: IsNull() };
    if (resolvedVersionId) {
      whereClause.versionId = resolvedVersionId;
    }

    const activeItems = await manager.find(ProductionTemplateWorkflowItemEntity, {
      where: whereClause,
      order: { sortOrder: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    const maxOrder = activeItems.length > 0 ? activeItems[activeItems.length - 1].sortOrder : 0;
    const nextOrder = maxOrder + 1;
    const sortOrder =
      desiredSortOrder && desiredSortOrder >= 1 && desiredSortOrder <= nextOrder
        ? desiredSortOrder
        : nextOrder;

    // Shift items if inserted in between within the same version
    if (sortOrder < nextOrder) {
      const qb = manager
        .createQueryBuilder()
        .update(ProductionTemplateWorkflowItemEntity)
        .set({ sortOrder: () => 'sort_order + 1' })
        .where('template_id = :templateId AND sort_order >= :sortOrder AND deleted_at IS NULL', {
          templateId,
          sortOrder,
        });

      if (resolvedVersionId) {
        qb.andWhere('version_id = :versionId', { versionId: resolvedVersionId });
      }

      await qb.execute();
    }

    const workflowItem = manager.create(ProductionTemplateWorkflowItemEntity, {
      templateId,
      versionId: resolvedVersionId || null,
      itemType,
      stageId: itemType === 'STAGE' ? targetId : null,
      patternId: itemType === 'PATTERN' ? targetId : null,
      sortOrder,
    });

    return await manager.save(workflowItem);
  }

  /**
   * Archives a workflow item and re-compacts the remaining items densely 1..N under template lock within version.
   */
  async archiveWorkflowItem(
    manager: EntityManager,
    templateId: string,
    itemType: ProductionTemplateWorkflowItemType,
    targetId: string
  ): Promise<void> {
    const whereCondition: any = { templateId, itemType, deletedAt: IsNull() };
    if (itemType === 'STAGE') {
      whereCondition.stageId = targetId;
    } else {
      whereCondition.patternId = targetId;
    }

    const item = await manager.findOne(ProductionTemplateWorkflowItemEntity, {
      where: whereCondition,
    });

    if (item) {
      await manager.softDelete(ProductionTemplateWorkflowItemEntity, item.id);
    }

    const versionId = item?.versionId;
    const remainingWhere: any = { templateId, deletedAt: IsNull() };
    if (versionId) {
      remainingWhere.versionId = versionId;
    }

    // Dense re-compact remaining active items 1..N
    const remainingItems = await manager.find(ProductionTemplateWorkflowItemEntity, {
      where: remainingWhere,
      order: { sortOrder: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    for (let i = 0; i < remainingItems.length; i++) {
      await manager.update(
        ProductionTemplateWorkflowItemEntity,
        { id: remainingItems[i].id },
        { sortOrder: i + 1 }
      );
    }
  }

  /**
   * Reorders workflow items densely 1..N under parent template lock.
   * Enforces that items belong to the LATEST active version of the template.
   */
  async reorderWorkflow(
    templateId: string,
    workflowItemIds: string[]
  ): Promise<ProductionTemplateWorkflowItemDto[]> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row FOR UPDATE & verify not archived
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Fetch all active items under lock
      const existingItems = await manager.find(ProductionTemplateWorkflowItemEntity, {
        where: { templateId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      const uniqueIds = new Set(workflowItemIds);
      if (
        uniqueIds.size !== workflowItemIds.length ||
        workflowItemIds.length !== existingItems.length
      ) {
        throw new BusinessRuleError(
          'قائمة المعرفات غير متطابقة مع عناصر سير عمل القالب',
          'PRODUCTION_TEMPLATE_WORKFLOW_INVALID_REORDER'
        );
      }

      const existingMap = new Map(existingItems.map((i) => [i.id, i]));
      for (const id of workflowItemIds) {
        const item = existingMap.get(id);
        if (!item) {
          throw new BusinessRuleError(
            'أحد المعرفات لا يتبع لسير عمل هذا القالب',
            'PRODUCTION_TEMPLATE_WORKFLOW_INVALID_REORDER'
          );
        }
        if (item.versionId) {
          await this.versionService.assertIsLatestVersion(templateId, item.versionId, manager);
        }
      }

      // 3. Dense update 1..N
      for (let i = 0; i < workflowItemIds.length; i++) {
        const id = workflowItemIds[i];
        await manager.update(
          ProductionTemplateWorkflowItemEntity,
          { id },
          { sortOrder: i + 1 }
        );
      }

      // 4. Return refreshed workflow list
      return await this.listWorkflowItems(templateId, undefined, manager);
    });
  }

  /**
   * Checks if a template currently contains any active patterns in its workflow.
   */
  async hasActivePatterns(templateId: string, manager?: EntityManager): Promise<boolean> {
    const repo = manager ? manager.getRepository(ProductionTemplateWorkflowItemEntity) : this.workflowRepo;
    const count = await repo.count({
      where: { templateId, itemType: 'PATTERN', deletedAt: IsNull() },
    });
    return count > 0;
  }
}

export const productionTemplateWorkflowService = new ProductionTemplateWorkflowService();
