import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplatePatternOptionTaskEntity } from './production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from '../template/production-template-guard.service.js';
import {
  ProductionDepartmentService,
  productionDepartmentService,
} from '../department/production-department.service.js';
import { CreateTemplatePatternOptionTaskDto } from './dto/create-pattern-option-task.dto.js';
import { UpdateTemplatePatternOptionTaskDto } from './dto/update-pattern-option-task.dto.js';
import { ReorderPatternOptionTasksDto } from './dto/reorder-pattern-option-tasks.dto.js';
import {
  ProductionTemplatePatternOptionTaskDto,
  toProductionTemplatePatternOptionTaskDto,
} from './production-template-pattern-option-task.types.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { resolveTaskDuration } from '../task-duration/task-duration.helper.js';

/**
 * Batched reference counts loader for tasks: planned materials and active attachments.
 * Groups by task_id in two efficient queries (no N+1).
 */
export async function loadTaskReferenceCounts(
  taskIds: string[],
  dataSource: DataSource = AppDataSource,
  manager?: EntityManager
): Promise<Map<string, { plannedMaterialsCount: number; attachmentsCount: number }>> {
  const result = new Map<string, { plannedMaterialsCount: number; attachmentsCount: number }>();
  if (!taskIds || taskIds.length === 0) {
    return result;
  }

  for (const id of taskIds) {
    result.set(id, { plannedMaterialsCount: 0, attachmentsCount: 0 });
  }

  const matRepo = manager
    ? manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity)
    : dataSource.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);

  const matCounts = await matRepo
    .createQueryBuilder('mat')
    .select('mat.taskId', 'taskId')
    .addSelect('COUNT(*)', 'cnt')
    .where('mat.taskId IN (:...taskIds)', { taskIds })
    .groupBy('mat.taskId')
    .getRawMany<{ taskId: string; cnt: string | number }>();

  for (const row of matCounts) {
    const existing = result.get(row.taskId);
    if (existing) {
      existing.plannedMaterialsCount = Number(row.cnt);
    }
  }

  const attRepo = manager
    ? manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity)
    : dataSource.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);

  const attCounts = await attRepo
    .createQueryBuilder('att')
    .select('att.taskId', 'taskId')
    .addSelect('COUNT(*)', 'cnt')
    .where('att.taskId IN (:...taskIds) AND att.deletedAt IS NULL', { taskIds })
    .groupBy('att.taskId')
    .getRawMany<{ taskId: string; cnt: string | number }>();

  for (const row of attCounts) {
    const existing = result.get(row.taskId);
    if (existing) {
      existing.attachmentsCount = Number(row.cnt);
    }
  }

  return result;
}

export class ProductionTemplatePatternOptionTaskService {
  private taskRepo: Repository<ProductionTemplatePatternOptionTaskEntity>;
  private departmentService: ProductionDepartmentService;
  private guardService: ProductionTemplateGuardService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    deptService: ProductionDepartmentService = productionDepartmentService,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService
  ) {
    this.taskRepo = this.dataSource.getRepository(ProductionTemplatePatternOptionTaskEntity);
    this.departmentService = deptService;
    this.guardService = guardService;
  }

  async listTasks(
    templateId: string,
    patternId: string,
    optionId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplatePatternOptionTaskDto[]> {
    await this.guardService.requireOptionBelongsToPattern(templateId, patternId, optionId, manager);

    const repo = manager
      ? manager.getRepository(ProductionTemplatePatternOptionTaskEntity)
      : this.taskRepo;

    const tasks = await repo.find({
      where: { optionId, deletedAt: IsNull() },
      relations: {
        department: true,
      },
      order: { sortOrder: 'ASC' },
    });

    const taskIds = tasks.map((t) => t.id);
    const countMap = await loadTaskReferenceCounts(taskIds, this.dataSource, manager);

    return tasks.map((t) => {
      const counts = countMap.get(t.id);
      return toProductionTemplatePatternOptionTaskDto(
        t,
        counts?.plannedMaterialsCount,
        counts?.attachmentsCount
      );
    });
  }

  async getTaskById(
    templateId: string,
    patternId: string,
    optionId: string,
    taskId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplatePatternOptionTaskDto> {
    await this.guardService.requireTaskBelongsToOption(
      templateId,
      patternId,
      optionId,
      taskId,
      manager
    );

    const repo = manager
      ? manager.getRepository(ProductionTemplatePatternOptionTaskEntity)
      : this.taskRepo;

    const task = await repo.findOneOrFail({
      where: { id: taskId, optionId, deletedAt: IsNull() },
      relations: {
        department: true,
      },
    });

    const countMap = await loadTaskReferenceCounts([task.id], this.dataSource, manager);
    const counts = countMap.get(task.id);

    return toProductionTemplatePatternOptionTaskDto(
      task,
      counts?.plannedMaterialsCount,
      counts?.attachmentsCount
    );
  }

  async addTask(
    templateId: string,
    patternId: string,
    optionId: string,
    dto: CreateTemplatePatternOptionTaskDto
  ): Promise<ProductionTemplatePatternOptionTaskDto> {
    // 1. Cross-module boundary validation for department
    await this.departmentService.validateDepartmentForStage(dto.departmentId);

    return await this.dataSource.transaction(async (manager) => {
      // 2. Lock parent template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 3. Verify option ownership
      await this.guardService.requireOptionBelongsToPattern(templateId, patternId, optionId, manager);

      // 4. Dense ordering under lock
      const activeTasks = await manager.find(ProductionTemplatePatternOptionTaskEntity, {
        where: { optionId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      const maxOrder = activeTasks.length > 0 ? activeTasks[activeTasks.length - 1].sortOrder : 0;
      const nextOrder = maxOrder + 1;
      const sortOrder =
        dto.sortOrder && dto.sortOrder >= 1 && dto.sortOrder <= nextOrder ? dto.sortOrder : nextOrder;

      if (sortOrder < nextOrder) {
        await manager
          .createQueryBuilder()
          .update(ProductionTemplatePatternOptionTaskEntity)
          .set({ sortOrder: () => 'sort_order + 1' })
          .where('option_id = :optionId AND sort_order >= :sortOrder AND deleted_at IS NULL', {
            optionId,
            sortOrder,
          })
          .execute();
      }

      const duration = resolveTaskDuration(dto);
      const task = manager.create(ProductionTemplatePatternOptionTaskEntity, {
        optionId,
        departmentId: dto.departmentId,
        name: dto.name.trim(),
        description: dto.description ? dto.description.trim() : null,
        sortOrder,
        estimatedDurationValue: duration.estimatedDurationValue,
        estimatedDurationUnit: duration.estimatedDurationUnit,

        estimatedDurationMinutes: duration.estimatedDurationMinutes,
        estimatedCost: dto.estimatedCost ? dto.estimatedCost : null,
      });

      const saved = await manager.save(task);

      const reloaded = await manager.findOneOrFail(ProductionTemplatePatternOptionTaskEntity, {
        where: { id: saved.id },
        relations: { department: true },
      });

      return toProductionTemplatePatternOptionTaskDto(reloaded);
    });
  }

  async updateTask(
    templateId: string,
    patternId: string,
    optionId: string,
    taskId: string,
    dto: UpdateTemplatePatternOptionTaskDto
  ): Promise<ProductionTemplatePatternOptionTaskDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify task ownership
      const { task } = await this.guardService.requireTaskBelongsToOption(
        templateId,
        patternId,
        optionId,
        taskId,
        manager
      );

      if (dto.departmentId !== undefined && dto.departmentId !== task.departmentId) {
        await this.departmentService.validateDepartmentForStage(dto.departmentId);
        task.departmentId = dto.departmentId;
      }

      if (dto.name !== undefined) task.name = dto.name.trim();
      if (dto.description !== undefined) task.description = dto.description ? dto.description.trim() : null;
      if (
        dto.estimatedDurationValue !== undefined ||
        dto.estimatedDurationUnit !== undefined ||
        dto.estimatedDurationMinutes !== undefined
      ) {
        const duration = resolveTaskDuration(dto, {
          estimatedDurationValue: task.estimatedDurationValue,
          estimatedDurationUnit: task.estimatedDurationUnit,
          estimatedDurationMinutes: task.estimatedDurationMinutes,
        });
        task.estimatedDurationValue = duration.estimatedDurationValue;
        task.estimatedDurationUnit = duration.estimatedDurationUnit;
        task.estimatedDurationMinutes = duration.estimatedDurationMinutes;
      }
      if (dto.estimatedCost !== undefined) task.estimatedCost = dto.estimatedCost;

      await manager.save(task);

      const reloaded = await manager.findOneOrFail(ProductionTemplatePatternOptionTaskEntity, {
        where: { id: taskId },
        relations: {
          department: true,
        },
      });

      const countMap = await loadTaskReferenceCounts([taskId], this.dataSource, manager);
      const counts = countMap.get(taskId);

      return toProductionTemplatePatternOptionTaskDto(
        reloaded,
        counts?.plannedMaterialsCount,
        counts?.attachmentsCount
      );
    });
  }

  async archiveTask(
    templateId: string,
    patternId: string,
    optionId: string,
    taskId: string
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify task ownership
      await this.guardService.requireTaskBelongsToOption(
        templateId,
        patternId,
        optionId,
        taskId,
        manager
      );

      // 3. Soft delete task
      await manager.softDelete(ProductionTemplatePatternOptionTaskEntity, taskId);

      // 4. Compact remaining active tasks densely 1..N
      const remainingTasks = await manager.find(ProductionTemplatePatternOptionTaskEntity, {
        where: { optionId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      for (let i = 0; i < remainingTasks.length; i++) {
        await manager.update(
          ProductionTemplatePatternOptionTaskEntity,
          { id: remainingTasks[i].id },
          { sortOrder: i + 1 }
        );
      }
    });
  }

  async reorderTasks(
    templateId: string,
    patternId: string,
    optionId: string,
    dto: ReorderPatternOptionTasksDto
  ): Promise<ProductionTemplatePatternOptionTaskDto[]> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify option ownership
      await this.guardService.requireOptionBelongsToPattern(templateId, patternId, optionId, manager);

      // 3. Lock active tasks
      const existingTasks = await manager.find(ProductionTemplatePatternOptionTaskEntity, {
        where: { optionId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      const uniqueIds = new Set(dto.taskIds);
      if (
        uniqueIds.size !== dto.taskIds.length ||
        dto.taskIds.length !== existingTasks.length
      ) {
        throw new BusinessRuleError(
          'قائمة المعرفات غير متطابقة مع مهام الخيار',
          'PRODUCTION_TEMPLATE_PATTERN_TASK_INVALID_REORDER'
        );
      }

      const existingMap = new Map(existingTasks.map((t) => [t.id, t]));
      for (const id of dto.taskIds) {
        if (!existingMap.has(id)) {
          throw new BusinessRuleError(
            'أحد المعرفات لا يتبع لهذا الخيار',
            'PRODUCTION_TEMPLATE_PATTERN_TASK_INVALID_REORDER'
          );
        }
      }

      // 4. Update dense 1..N
      for (let i = 0; i < dto.taskIds.length; i++) {
        const id = dto.taskIds[i];
        await manager.update(
          ProductionTemplatePatternOptionTaskEntity,
          { id },
          { sortOrder: i + 1 }
        );
      }

      return await this.listTasks(templateId, patternId, optionId, manager);
    });
  }
}

export const productionTemplatePatternOptionTaskService = new ProductionTemplatePatternOptionTaskService();
