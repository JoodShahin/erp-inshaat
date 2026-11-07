import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplatePatternEntity } from './production-template-pattern.entity.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from '../template/production-template-guard.service.js';
import {
  ProductionTemplateWorkflowService,
  productionTemplateWorkflowService,
} from '../template-workflow-item/production-template-workflow.service.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import { CreateTemplatePatternDto } from './dto/create-pattern.dto.js';
import { UpdateTemplatePatternDto } from './dto/update-pattern.dto.js';
import {
  ProductionTemplatePatternDto,
  toProductionTemplatePatternDto,
} from './production-template-pattern.types.js';
import { toProductionTemplatePatternOptionDto } from '../template-pattern-option/production-template-pattern-option.types.js';
import { toProductionTemplatePatternOptionTaskDto } from '../template-pattern-option-task/production-template-pattern-option-task.types.js';
import { loadTaskReferenceCounts } from '../template-pattern-option-task/production-template-pattern-option-task.service.js';

export class ProductionTemplatePatternService {
  private patternRepo: Repository<ProductionTemplatePatternEntity>;
  private guardService: ProductionTemplateGuardService;
  private workflowService: ProductionTemplateWorkflowService;
  private versionService: ProductionTemplateVersionService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    workflowService: ProductionTemplateWorkflowService = productionTemplateWorkflowService,
    versionService: ProductionTemplateVersionService = productionTemplateVersionService
  ) {
    this.patternRepo = this.dataSource.getRepository(ProductionTemplatePatternEntity);
    this.guardService = guardService;
    this.workflowService = workflowService;
    this.versionService = versionService;
  }

  async listPatterns(
    templateId: string,
    versionId?: string,
    manager?: EntityManager
  ): Promise<ProductionTemplatePatternDto[]> {
    await this.guardService.requireExistingTemplate(templateId, manager);

    const repo = manager
      ? manager.getRepository(ProductionTemplatePatternEntity)
      : this.patternRepo;

    let targetVersionId = versionId;
    if (!targetVersionId) {
      try {
        const latest = await this.versionService.getLatestVersion(templateId, manager);
        targetVersionId = latest.id;
      } catch {
        targetVersionId = undefined;
      }
    }

    const whereClause: any = { templateId, deletedAt: IsNull() };
    if (targetVersionId) {
      whereClause.versionId = targetVersionId;
    }

    const patterns = await repo.find({
      where: whereClause,
      relations: {
        options: {
          tasks: {
            department: true,
          },
        },
      },
      order: { createdAt: 'ASC' },
    });

    const allTaskIds: string[] = [];
    for (const p of patterns) {
      for (const opt of p.options || []) {
        if (!opt.deletedAt) {
          for (const t of opt.tasks || []) {
            if (!t.deletedAt) {
              allTaskIds.push(t.id);
            }
          }
        }
      }
    }

    const countMap = await loadTaskReferenceCounts(allTaskIds, this.dataSource, manager);

    return patterns.map((p) => {
      const activeOptions = (p.options || [])
        .filter((o) => !o.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((opt) => {
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
      return toProductionTemplatePatternDto(p, activeOptions);
    });
  }

  async getPatternById(
    templateId: string,
    patternId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplatePatternDto> {
    const { pattern } = await this.guardService.requirePatternBelongsToTemplate(
      templateId,
      patternId,
      manager
    );

    const repo = manager
      ? manager.getRepository(ProductionTemplatePatternEntity)
      : this.patternRepo;

    const reloaded = await repo.findOneOrFail({
      where: { id: pattern.id },
      relations: {
        options: {
          tasks: {
            department: true,
          },
        },
      },
    });

    const allTaskIds: string[] = [];
    for (const opt of reloaded.options || []) {
      if (!opt.deletedAt) {
        for (const t of opt.tasks || []) {
          if (!t.deletedAt) {
            allTaskIds.push(t.id);
          }
        }
      }
    }

    const countMap = await loadTaskReferenceCounts(allTaskIds, this.dataSource, manager);

    const activeOptions = (reloaded.options || [])
      .filter((o) => !o.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((opt) => {
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

    return toProductionTemplatePatternDto(reloaded, activeOptions);
  }

  async addPattern(templateId: string, dto: CreateTemplatePatternDto): Promise<ProductionTemplatePatternDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row FOR UPDATE & verify not archived
      await this.guardService.lockMutableTemplate(templateId, manager);

      let latestVersionId: string | null = null;
      try {
        const latest = await this.versionService.getLatestVersion(templateId, manager);
        latestVersionId = latest.id;
      } catch {
        latestVersionId = null;
      }

      // 2. Create Pattern entity
      const pattern = manager.create(ProductionTemplatePatternEntity, {
        templateId,
        versionId: latestVersionId,
        name: dto.name.trim(),
      });
      const savedPattern = await manager.save(pattern);

      // 3. Insert Workflow Item into top-level workflow
      await this.workflowService.insertWorkflowItem(
        manager,
        templateId,
        'PATTERN',
        savedPattern.id,
        dto.sortOrder,
        latestVersionId || undefined
      );

      return toProductionTemplatePatternDto(savedPattern, []);
    });
  }

  async updatePattern(
    templateId: string,
    patternId: string,
    dto: UpdateTemplatePatternDto
  ): Promise<ProductionTemplatePatternDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row FOR UPDATE
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify pattern belongs to template
      const pattern = await manager.findOne(ProductionTemplatePatternEntity, {
        where: { id: patternId, templateId, deletedAt: IsNull() },
        relations: {
          options: {
            tasks: {
              department: true,
            },
          },
        },
      });

      if (!pattern) {
        throw new NotFoundError('النمط غير موجود', 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
      }

      if (pattern.versionId) {
        await this.versionService.assertIsLatestVersion(templateId, pattern.versionId, manager);
      }

      pattern.name = dto.name.trim();
      const updated = await manager.save(pattern);

      const allTaskIds: string[] = [];
      for (const opt of updated.options || []) {
        if (!opt.deletedAt) {
          for (const t of opt.tasks || []) {
            if (!t.deletedAt) {
              allTaskIds.push(t.id);
            }
          }
        }
      }

      const countMap = await loadTaskReferenceCounts(allTaskIds, this.dataSource, manager);

      const activeOptions = (updated.options || [])
        .filter((o) => !o.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((opt) => {
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

      return toProductionTemplatePatternDto(updated, activeOptions);
    });
  }

  async archivePattern(templateId: string, patternId: string): Promise<void> {
    return await this.softDeletePattern(templateId, patternId);
  }

  async softDeletePattern(templateId: string, patternId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Lock template row FOR UPDATE
      await this.guardService.lockMutableTemplate(templateId, manager);

      // 2. Verify pattern belongs to template
      const pattern = await manager.findOne(ProductionTemplatePatternEntity, {
        where: { id: patternId, templateId, deletedAt: IsNull() },
      });

      if (!pattern) {
        throw new NotFoundError('النمط غير موجود', 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
      }

      if (pattern.versionId) {
        await this.versionService.assertIsLatestVersion(templateId, pattern.versionId, manager);
      }

      // 3. Archive top-level workflow item
      await this.workflowService.archiveWorkflowItem(
        manager,
        templateId,
        'PATTERN',
        pattern.id
      );

      // 4. Soft delete pattern row
      await manager.softDelete(ProductionTemplatePatternEntity, pattern.id);
    });
  }
}

export const productionTemplatePatternService = new ProductionTemplatePatternService();
