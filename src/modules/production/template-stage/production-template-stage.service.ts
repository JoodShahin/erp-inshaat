import { DataSource, Repository, EntityManager, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateStageEntity } from './production-template-stage.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from '../template/production-template-guard.service.js';
import {
  ProductionDepartmentService,
  productionDepartmentService,
} from '../department/production-department.service.js';
import {
  ProductionTemplateWorkflowService,
  productionTemplateWorkflowService,
} from '../template-workflow-item/production-template-workflow.service.js';
import { CreateTemplateStageDto } from './dto/create-stage.dto.js';
import { UpdateTemplateStageDto } from './dto/update-stage.dto.js';
import { ReorderTemplateStagesDto } from './dto/reorder-stages.dto.js';
import {
  ProductionTemplateStageDto,
  toProductionTemplateStageDto,
} from './production-template-stage.types.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { resolveTaskDuration } from '../task-duration/task-duration.helper.js';

export class ProductionTemplateStageService {
  private stageRepo: Repository<ProductionTemplateStageEntity>;
  private departmentService: ProductionDepartmentService;
  private guardService: ProductionTemplateGuardService;
  private workflowService: ProductionTemplateWorkflowService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    deptService: ProductionDepartmentService = productionDepartmentService,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    workflowService: ProductionTemplateWorkflowService = productionTemplateWorkflowService
  ) {
    this.stageRepo = this.dataSource.getRepository(ProductionTemplateStageEntity);
    this.departmentService = deptService;
    this.guardService = guardService;
    this.workflowService = workflowService;
  }

  async listStages(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateStageDto[]> {
    await this.guardService.requireExistingTemplate(templateId, manager);

    const repo: Repository<ProductionTemplateStageEntity> = manager
      ? manager.getRepository(ProductionTemplateStageEntity)
      : this.stageRepo;
    const stages: ProductionTemplateStageEntity[] = await repo.find({
      where: { templateId, deletedAt: IsNull() },
      relations: {
        department: true,
        plannedMaterials: {
          product: true,
          productUnit: true,
        },
        workflowItem: true,
      },
    });

    const activeStages = stages
      .filter((s: ProductionTemplateStageEntity) => s.workflowItem && !s.workflowItem.deletedAt)
      .map((s: ProductionTemplateStageEntity) => {
        s.sortOrder = s.workflowItem?.sortOrder ?? 1;
        return s;
      })
      .sort((a: ProductionTemplateStageEntity, b: ProductionTemplateStageEntity) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return activeStages.map(toProductionTemplateStageDto);
  }

  async getStageById(templateId: string, stageId: string): Promise<ProductionTemplateStageDto> {
    await this.guardService.requireExistingTemplate(templateId);

    const stage = await this.stageRepo.findOne({
      where: { id: stageId, templateId, deletedAt: IsNull() },
      relations: {
        department: true,
        plannedMaterials: {
          product: true,
          productUnit: true,
        },
        workflowItem: true,
      },
    });

    if (!stage || !stage.workflowItem || stage.workflowItem.deletedAt !== null) {
      throw new NotFoundError('المرحلة غير موجودة', 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
    }

    stage.sortOrder = stage.workflowItem.sortOrder;
    return toProductionTemplateStageDto(stage);
  }

  async addStage(templateId: string, dto: CreateTemplateStageDto): Promise<ProductionTemplateStageDto> {
    // 1. Cross-module boundary: validate department via department service
    await this.departmentService.validateDepartmentForStage(dto.departmentId);

    // 2. Transaction with explicit pessimistic_write lock on parent Template row
    return await this.dataSource.transaction(async (manager) => {
      await this.guardService.lockMutableTemplate(templateId, manager);

      const duration = resolveTaskDuration(dto);
      const stage = manager.create(ProductionTemplateStageEntity, {
        templateId,
        departmentId: dto.departmentId,
        name: dto.name.trim(),
        description: dto.description ? dto.description.trim() : null,
        estimatedDurationValue: duration.estimatedDurationValue,
        estimatedDurationUnit: duration.estimatedDurationUnit,
        estimatedDurationMinutes: duration.estimatedDurationMinutes,
        estimatedCost: dto.estimatedCost ? dto.estimatedCost : null,
      });

      const savedStage = await manager.save(stage);

      // 3. Atomically insert into workflow item under template lock
      const workflowItem = await this.workflowService.insertWorkflowItem(
        manager,
        templateId,
        'STAGE',
        savedStage.id,
        dto.sortOrder
      );

      savedStage.sortOrder = workflowItem.sortOrder;

      const reloaded = await manager.findOneOrFail(ProductionTemplateStageEntity, {
        where: { id: savedStage.id },
        relations: { department: true },
      });
      reloaded.sortOrder = workflowItem.sortOrder;

      return toProductionTemplateStageDto(reloaded);
    });
  }

  async updateStage(
    templateId: string,
    stageId: string,
    dto: UpdateTemplateStageDto
  ): Promise<ProductionTemplateStageDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row FOR UPDATE & verify not archived
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Find stage belonging to template
      const stage = await manager.findOne(ProductionTemplateStageEntity, {
        where: { id: stageId, templateId, deletedAt: IsNull() },
        relations: { workflowItem: true },
      });
      if (
        !stage ||
        (stage.workflowItem !== undefined &&
          (stage.workflowItem === null || stage.workflowItem.deletedAt !== null))
      ) {
        throw new NotFoundError('المرحلة غير موجودة', 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
      }

      if (dto.departmentId !== undefined && dto.departmentId !== stage.departmentId) {
        await this.departmentService.validateDepartmentForStage(dto.departmentId);
        stage.departmentId = dto.departmentId;
      }

      if (dto.name !== undefined) stage.name = dto.name.trim();
      if (dto.description !== undefined) stage.description = dto.description ? dto.description.trim() : null;
      if (
        dto.estimatedDurationValue !== undefined ||
        dto.estimatedDurationUnit !== undefined ||
        dto.estimatedDurationMinutes !== undefined
      ) {
        const duration = resolveTaskDuration(dto, {
          estimatedDurationValue: stage.estimatedDurationValue,
          estimatedDurationUnit: stage.estimatedDurationUnit,
          estimatedDurationMinutes: stage.estimatedDurationMinutes,
        });
        stage.estimatedDurationValue = duration.estimatedDurationValue;
        stage.estimatedDurationUnit = duration.estimatedDurationUnit;
        stage.estimatedDurationMinutes = duration.estimatedDurationMinutes;
      }
      if (dto.estimatedCost !== undefined) stage.estimatedCost = dto.estimatedCost;

      await manager.save(stage);

      const reloaded = await manager.findOneOrFail(ProductionTemplateStageEntity, {
        where: { id: stageId },
        relations: { department: true, workflowItem: true },
      });
      reloaded.sortOrder = reloaded.workflowItem?.sortOrder ?? 1;

      return toProductionTemplateStageDto(reloaded);
    });
  }

  async softDeleteStage(templateId: string, stageId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row & verify not archived
      await this.guardService.lockMutableTemplate(templateId, manager);

      const stage = await manager.findOne(ProductionTemplateStageEntity, {
        where: { id: stageId, templateId, deletedAt: IsNull() },
      });
      if (!stage) {
        throw new NotFoundError('المرحلة غير موجودة', 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
      }

      // 2. Soft delete stage
      await manager.softDelete(ProductionTemplateStageEntity, stageId);

      // 3. Atomically soft delete corresponding workflow item & compact workflow items 1..N
      await this.workflowService.archiveWorkflowItem(manager, templateId, 'STAGE', stageId);
    });
  }

  async reorderStages(
    templateId: string,
    dto: ReorderTemplateStagesDto
  ): Promise<ProductionTemplateStageDto[]> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row & verify not archived
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Reject legacy reorder if template contains any active patterns
      const hasPatterns = await this.workflowService.hasActivePatterns(templateId, manager);
      if (hasPatterns) {
        throw new BusinessRuleError(
          'يحتوي القالب على أنماط، يجب استخدام إعادة ترتيب سير العمل الشامل',
          'PRODUCTION_TEMPLATE_MIXED_WORKFLOW_REORDER_REQUIRED'
        );
      }

      // 3. Lock active stage workflow items for this template
      const workflowItems = await manager.find(ProductionTemplateWorkflowItemEntity, {
        where: { templateId, itemType: 'STAGE', deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      const uniqueIds = new Set(dto.stageIds);
      if (
        uniqueIds.size !== dto.stageIds.length ||
        dto.stageIds.length !== workflowItems.length
      ) {
        throw new BusinessRuleError(
          'قائمة المعرفات غير متطابقة مع مراحل القالب',
          'PRODUCTION_TEMPLATE_STAGE_INVALID_REORDER'
        );
      }

      const stageToWorkflowMap = new Map<string, string>();
      for (const wi of workflowItems) {
        if (wi.stageId) {
          stageToWorkflowMap.set(wi.stageId, wi.id);
        }
      }

      const orderedWorkflowItemIds: string[] = [];
      for (const sid of dto.stageIds) {
        const wiId = stageToWorkflowMap.get(sid);
        if (!wiId) {
          throw new BusinessRuleError(
            'أحد المعرفات لا يتبع لهذا القالب',
            'PRODUCTION_TEMPLATE_STAGE_INVALID_REORDER'
          );
        }
        orderedWorkflowItemIds.push(wiId);
      }

      // 4. Dense re-order 1..N on workflow items
      for (let i = 0; i < orderedWorkflowItemIds.length; i++) {
        await manager.update(
          ProductionTemplateWorkflowItemEntity,
          { id: orderedWorkflowItemIds[i] },
          { sortOrder: i + 1 }
        );
      }

      return await this.listStages(templateId, manager);
    });
  }
}

export const productionTemplateStageService = new ProductionTemplateStageService();
