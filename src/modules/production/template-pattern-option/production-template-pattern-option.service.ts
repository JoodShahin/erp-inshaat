import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplatePatternOptionEntity } from './production-template-pattern-option.entity.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from '../template/production-template-guard.service.js';
import { CreateTemplatePatternOptionDto } from './dto/create-pattern-option.dto.js';
import { UpdateTemplatePatternOptionDto } from './dto/update-pattern-option.dto.js';
import { ReorderPatternOptionsDto } from './dto/reorder-pattern-options.dto.js';
import {
  ProductionTemplatePatternOptionDto,
  toProductionTemplatePatternOptionDto,
} from './production-template-pattern-option.types.js';
import { toProductionTemplatePatternOptionTaskDto } from '../template-pattern-option-task/production-template-pattern-option-task.types.js';
import { loadTaskReferenceCounts } from '../template-pattern-option-task/production-template-pattern-option-task.service.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionTemplatePatternOptionService {
  private optionRepo: Repository<ProductionTemplatePatternOptionEntity>;
  private guardService: ProductionTemplateGuardService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService
  ) {
    this.optionRepo = this.dataSource.getRepository(ProductionTemplatePatternOptionEntity);
    this.guardService = guardService;
  }

  async listOptions(
    templateId: string,
    patternId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplatePatternOptionDto[]> {
    await this.guardService.requirePatternBelongsToTemplate(templateId, patternId, manager);

    const repo = manager
      ? manager.getRepository(ProductionTemplatePatternOptionEntity)
      : this.optionRepo;

    const options = await repo.find({
      where: { patternId, deletedAt: IsNull() },
      relations: {
        tasks: {
          department: true,
        },
      },
      order: { sortOrder: 'ASC' },
    });

    const allTaskIds: string[] = [];
    for (const opt of options) {
      for (const t of opt.tasks || []) {
        if (!t.deletedAt) {
          allTaskIds.push(t.id);
        }
      }
    }

    const countMap = await loadTaskReferenceCounts(allTaskIds, this.dataSource, manager);

    return options.map((opt) => {
      const activeTasks = (opt.tasks || [])
        .filter((t) => !t.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => {
          const counts = countMap.get(t.id);
          return toProductionTemplatePatternOptionTaskDto(
            t,
            counts?.plannedMaterialsCount,
            counts?.attachmentsCount
          );
        });
      return toProductionTemplatePatternOptionDto(opt, activeTasks);
    });
  }

  async addOption(
    templateId: string,
    patternId: string,
    dto: CreateTemplatePatternOptionDto
  ): Promise<ProductionTemplatePatternOptionDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock parent template row
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify pattern belongs to template and is latest version
      const { pattern } = await this.guardService.requirePatternBelongsToTemplate(templateId, patternId, manager);
      if (pattern.versionId) {
        await this.guardService.assertLatestVersion(templateId, pattern.versionId, manager);
      }

      // 3. Dense ordering under lock
      const activeOptions = await manager.find(ProductionTemplatePatternOptionEntity, {
        where: { patternId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      const maxOrder = activeOptions.length > 0 ? activeOptions[activeOptions.length - 1].sortOrder : 0;
      const nextOrder = maxOrder + 1;
      const sortOrder =
        dto.sortOrder && dto.sortOrder >= 1 && dto.sortOrder <= nextOrder ? dto.sortOrder : nextOrder;

      if (sortOrder < nextOrder) {
        await manager
          .createQueryBuilder()
          .update(ProductionTemplatePatternOptionEntity)
          .set({ sortOrder: () => 'sort_order + 1' })
          .where('pattern_id = :patternId AND sort_order >= :sortOrder AND deleted_at IS NULL', {
            patternId,
            sortOrder,
          })
          .execute();
      }

      const option = manager.create(ProductionTemplatePatternOptionEntity, {
        patternId,
        name: dto.name.trim(),
        sortOrder,
      });

      const saved = await manager.save(option);
      return toProductionTemplatePatternOptionDto(saved, []);
    });
  }

  async updateOption(
    templateId: string,
    patternId: string,
    optionId: string,
    dto: UpdateTemplatePatternOptionDto
  ): Promise<ProductionTemplatePatternOptionDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify option ownership and mutable version
      const { option } = await this.guardService.requireMutableOptionBelongsToPattern(
        templateId,
        patternId,
        optionId,
        manager
      );

      option.name = dto.name.trim();
      const saved = await manager.save(option);

      const reloaded = await manager.findOneOrFail(ProductionTemplatePatternOptionEntity, {
        where: { id: saved.id },
        relations: {
          tasks: {
            department: true,
          },
        },
      });

      const taskIds = (reloaded.tasks || []).filter((t) => !t.deletedAt).map((t) => t.id);
      const countMap = await loadTaskReferenceCounts(taskIds, this.dataSource, manager);

      const activeTasks = (reloaded.tasks || [])
        .filter((t) => !t.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => {
          const counts = countMap.get(t.id);
          return toProductionTemplatePatternOptionTaskDto(
            t,
            counts?.plannedMaterialsCount,
            counts?.attachmentsCount
          );
        });

      return toProductionTemplatePatternOptionDto(reloaded, activeTasks);
    });
  }

  async archiveOption(templateId: string, patternId: string, optionId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify option ownership and mutable version
      await this.guardService.requireMutableOptionBelongsToPattern(templateId, patternId, optionId, manager);

      // 3. Soft delete option
      await manager.softDelete(ProductionTemplatePatternOptionEntity, optionId);

      // 4. Compact remaining active options densely 1..N
      const remainingOptions = await manager.find(ProductionTemplatePatternOptionEntity, {
        where: { patternId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      for (let i = 0; i < remainingOptions.length; i++) {
        await manager.update(
          ProductionTemplatePatternOptionEntity,
          { id: remainingOptions[i].id },
          { sortOrder: i + 1 }
        );
      }
    });
  }

  async reorderOptions(
    templateId: string,
    patternId: string,
    dto: ReorderPatternOptionsDto
  ): Promise<ProductionTemplatePatternOptionDto[]> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify pattern belongs to template and is latest version
      const { pattern } = await this.guardService.requirePatternBelongsToTemplate(templateId, patternId, manager);
      if (pattern.versionId) {
        await this.guardService.assertLatestVersion(templateId, pattern.versionId, manager);
      }

      // 3. Lock active options
      const existingOptions = await manager.find(ProductionTemplatePatternOptionEntity, {
        where: { patternId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      const uniqueIds = new Set(dto.optionIds);
      if (
        uniqueIds.size !== dto.optionIds.length ||
        dto.optionIds.length !== existingOptions.length
      ) {
        throw new BusinessRuleError(
          'قائمة المعرفات غير متطابقة مع خيارات النمط',
          'PRODUCTION_TEMPLATE_PATTERN_OPTION_INVALID_REORDER'
        );
      }

      const existingMap = new Map(existingOptions.map((o) => [o.id, o]));
      for (const id of dto.optionIds) {
        if (!existingMap.has(id)) {
          throw new BusinessRuleError(
            'أحد المعرفات لا يتبع لهذا النمط',
            'PRODUCTION_TEMPLATE_PATTERN_OPTION_INVALID_REORDER'
          );
        }
      }

      // 4. Update dense 1..N
      for (let i = 0; i < dto.optionIds.length; i++) {
        const id = dto.optionIds[i];
        await manager.update(
          ProductionTemplatePatternOptionEntity,
          { id },
          { sortOrder: i + 1 }
        );
      }

      return await this.listOptions(templateId, patternId, manager);
    });
  }
}

export const productionTemplatePatternOptionService = new ProductionTemplatePatternOptionService();
