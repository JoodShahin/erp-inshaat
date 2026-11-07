import { DataSource, Repository, IsNull, QueryFailedError } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateEntity } from './production-template.entity.js';
import { ProductionTemplateVersionEntity } from '../template-version/production-template-version.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { CreateProductionTemplateDto } from './dto/create-template.dto.js';
import { UpdateProductionTemplateDto } from './dto/update-template.dto.js';
import { ListProductionTemplatesQueryDto } from './dto/list-templates-query.dto.js';
import {
  PaginatedProductionTemplatesResult,
  ProductionTemplateDetailDto,
  ProductionTemplateDto,
  PaginatedTemplateReferenceOptionsResult,
  ProductionTemplateOrderConfigurationDto,
  toProductionTemplateDto,
  toProductionTemplateListItemDto,
  TaskDurationUnit,
} from './production-template.types.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { ConflictError } from '../../../common/errors/conflict.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import {
  ProductionTemplateGuardService,
  productionTemplateGuardService,
} from './production-template-guard.service.js';
import {
  ProductionTemplateWorkflowService,
  productionTemplateWorkflowService,
} from '../template-workflow-item/production-template-workflow.service.js';
import {
  ProductionTemplatePatternService,
  productionTemplatePatternService,
} from '../template-pattern/production-template-pattern.service.js';
import {
  ProductionTemplateSequenceService,
  productionTemplateSequenceService,
} from './production-template-sequence.service.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import { ProductionTemplateVersionSummaryDto } from './production-template.types.js';

export class ProductionTemplateService {
  private templateRepo: Repository<ProductionTemplateEntity>;
  private guardService: ProductionTemplateGuardService;
  private workflowService: ProductionTemplateWorkflowService;
  private patternService: ProductionTemplatePatternService;
  private sequenceService: ProductionTemplateSequenceService;
  private versionService: ProductionTemplateVersionService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    workflowService: ProductionTemplateWorkflowService = productionTemplateWorkflowService,
    patternService: ProductionTemplatePatternService = productionTemplatePatternService,
    sequenceService: ProductionTemplateSequenceService = productionTemplateSequenceService,
    versionService: ProductionTemplateVersionService = productionTemplateVersionService
  ) {
    this.templateRepo = this.dataSource.getRepository(ProductionTemplateEntity);
    this.guardService = guardService;
    this.workflowService = workflowService;
    this.patternService = patternService;
    this.sequenceService = sequenceService;
    this.versionService = versionService;
  }

  async listTemplates(query: ListProductionTemplatesQueryDto): Promise<PaginatedProductionTemplatesResult> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const qb = this.templateRepo.createQueryBuilder('t')
      .where('t.deleted_at IS NULL');

    if (query.status === 'active') {
      qb.andWhere('t.is_active = :isActive', { isActive: true });
    } else if (query.status === 'inactive') {
      qb.andWhere('t.is_active = :isActive', { isActive: false });
    }

    if (query.search && query.search.trim() !== '') {
      const term = `%${query.search.trim()}%`;
      qb.andWhere('(t.name LIKE :term OR t.code LIKE :term OR t.reference_number LIKE :term)', { term });
    }

    const total = await qb.getCount();

    const rawItems = await qb
      .addSelect((subQb) => {
        return subQb
          .select('COUNT(stage.id)', 'stages_count')
          .from(ProductionTemplateStageEntity, 'stage')
          .where('stage.template_id = t.id')
          .andWhere('stage.deleted_at IS NULL');
      }, 'stages_count')
      .addSelect((subQb) => {
        return subQb
          .select('COUNT(spec.id)', 'specs_count')
          .from(ProductionTemplateSpecificationEntity, 'spec')
          .where('spec.template_id = t.id');
      }, 'specs_count')
      .addSelect((subQb) => {
        return subQb
          .select('COUNT(pat.id)', 'patterns_count')
          .from(ProductionTemplatePatternEntity, 'pat')
          .where('pat.template_id = t.id')
          .andWhere('pat.deleted_at IS NULL');
      }, 'patterns_count')
      .orderBy('t.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getRawAndEntities();

    const items = rawItems.entities.map((entity, index) => {
      const raw = rawItems.raw[index];
      const stagesCount = parseInt(raw.stages_count || '0', 10);
      const specsCount = parseInt(raw.specs_count || '0', 10);
      const patternsCount = parseInt(raw.patterns_count || '0', 10);
      return toProductionTemplateListItemDto(entity, stagesCount, specsCount, patternsCount);
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getTemplateById(id: string, versionId?: string): Promise<ProductionTemplateDetailDto> {
    const template = await this.templateRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: {
        specifications: true,
      },
    });

    if (!template) {
      throw new NotFoundError('القالب غير موجود', 'PRODUCTION_TEMPLATE_NOT_FOUND');
    }

    const specifications = (template.specifications || [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s.id,
        name: s.name,
        value: s.value,
        unit: s.unit,
        sortOrder: s.sortOrder,
      }));

    let currentVersion: ProductionTemplateVersionSummaryDto | undefined;
    let versions: ProductionTemplateVersionSummaryDto[] = [];
    let resolvedVersionId: string | undefined = versionId;

    try {
      const versionList = await this.versionService.listVersions(id);
      versions = versionList;
      let targetVersionEntity: ProductionTemplateVersionEntity;
      if (resolvedVersionId) {
        targetVersionEntity = await this.versionService.getVersionById(id, resolvedVersionId);
      } else {
        targetVersionEntity = await this.versionService.getLatestVersion(id);
      }
      resolvedVersionId = targetVersionEntity.id;
      let revision: string | undefined;
      try {
        revision = await this.versionService.computeVersionRevision(id, targetVersionEntity.id);
      } catch {
        revision = undefined;
      }
      currentVersion = {
        id: targetVersionEntity.id,
        version: targetVersionEntity.version,
        isLatest: targetVersionEntity.id === versionList[0]?.id,
        createdAt: targetVersionEntity.createdAt,
        revision,
      };
    } catch (err) {
      if (versionId) {
        throw err;
      }
      currentVersion = undefined;
    }

    // Top-level single source of truth for workflow
    const workflowItems = await this.workflowService.listWorkflowItems(id, resolvedVersionId);

    // Derived compatibility stages list
    const stages = workflowItems
      .filter((w) => w.itemType === 'STAGE' && w.stage)
      .map((w) => {
        const s = w.stage!;
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          departmentId: s.departmentId,
          departmentName: s.departmentName,
          departmentCode: s.departmentCode,
          sortOrder: w.sortOrder,
          estimatedDurationValue: s.estimatedDurationValue ?? s.estimatedDurationMinutes ?? null,
          estimatedDurationUnit: s.estimatedDurationUnit ?? (s.estimatedDurationMinutes ? TaskDurationUnit.MINUTES : null),
          estimatedDurationMinutes: s.estimatedDurationMinutes,
          estimatedCost: s.estimatedCost ? String(s.estimatedCost) : null,
          plannedMaterialsCount: s.plannedMaterialsCount,
          attachmentsCount: s.attachmentsCount,
        };
      });

    // Patterns details
    const patterns = await this.patternService.listPatterns(id, resolvedVersionId);
    const patternsCount = patterns.length;

    return {
      id: template.id,
      name: template.name,
      referenceNumber: template.referenceNumber,
      code: template.code,
      description: template.description,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      revision: currentVersion?.revision,
      currentVersion,
      versions,
      specifications,
      stages,
      workflowItems,
      patternsCount,
      patterns,
    };
  }

  async findTemplateEntityById(id: string): Promise<ProductionTemplateEntity> {
    const template = await this.templateRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!template) {
      throw new NotFoundError('القالب غير موجود', 'PRODUCTION_TEMPLATE_NOT_FOUND');
    }
    return template;
  }

  async createTemplate(dto: CreateProductionTemplateDto): Promise<ProductionTemplateDto> {
    return await this.dataSource.transaction(async (manager) => {
      const templateRepo = manager.getRepository(ProductionTemplateEntity);
      const versionRepo = manager.getRepository(ProductionTemplateVersionEntity);

      // 1. Generate unique technical code atomically using sequence table with lock
      const code = await this.sequenceService.generateNextCode(manager);

      // 2. Create template entity
      const template = templateRepo.create({
        name: dto.name.trim(),
        code,
        referenceNumber: dto.referenceNumber ? dto.referenceNumber.trim() : null,
        description: dto.description ? dto.description.trim() : null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      });

      let saved: ProductionTemplateEntity;
      try {
        saved = await templateRepo.save(template);
      } catch (err) {
        if (err instanceof QueryFailedError && (err as any).driverError?.errno === 1062) {
          throw new ConflictError('رمز القالب مستخدم مسبقاً', 'PRODUCTION_TEMPLATE_CODE_ALREADY_EXISTS');
        }
        throw err;
      }

      // 3. Create initial version 1.0 in the SAME transaction
      const initialVersion = versionRepo.create({
        templateId: saved.id,
        version: '1.0',
      });
      await versionRepo.save(initialVersion);

      return toProductionTemplateDto(saved);
    });
  }

  async updateTemplate(id: string, dto: UpdateProductionTemplateDto): Promise<ProductionTemplateDto> {
    return await this.dataSource.transaction(async (manager) => {
      const template = await this.guardService.lockMutableTemplate(id, manager);

      if (dto.name !== undefined) {
        template.name = dto.name.trim();
      }
      if (dto.referenceNumber !== undefined) {
        template.referenceNumber = dto.referenceNumber ? dto.referenceNumber.trim() : null;
      }
      if (dto.description !== undefined) {
        template.description = dto.description ? dto.description.trim() : null;
      }
      if (dto.isActive !== undefined) {
        template.isActive = dto.isActive;
      }

      const saved = await manager.save(template);
      return toProductionTemplateDto(saved);
    });
  }

  async softDeleteTemplate(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const template = await this.guardService.lockMutableTemplate(id, manager);

      template.isActive = false;
      await manager.save(template);
      await manager.softDelete(ProductionTemplateEntity, id);
    });
  }

  async getReferenceOptions(query: { page?: number; limit?: number; search?: string }): Promise<PaginatedTemplateReferenceOptionsResult> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const qb = this.templateRepo
      .createQueryBuilder('t')
      .where('t.deleted_at IS NULL')
      .andWhere('t.is_active = :isActive', { isActive: true });

    if (query.search) {
      const s = `%${query.search.trim()}%`;
      qb.andWhere('(t.name LIKE :s OR t.code LIKE :s OR t.reference_number LIKE :s)', { s });
    }

    qb.orderBy('t.created_at', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        referenceNumber: t.referenceNumber,
      })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getOrderConfiguration(templateId: string, versionId?: string): Promise<ProductionTemplateOrderConfigurationDto> {
    const template = await this.guardService.requireExistingTemplate(templateId);
    if (!template.isActive) {
      throw new BusinessRuleError('لا يمكن استخدام قالب تصنيع غير فعال', 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
    }

    let targetVersionId = versionId;
    let targetVersionStr: string | undefined;

    try {
      if (targetVersionId) {
        const ver = await this.versionService.getVersionById(templateId, targetVersionId);
        targetVersionStr = ver.version;
      } else {
        const latest = await this.versionService.getLatestVersion(templateId);
        targetVersionId = latest.id;
        targetVersionStr = latest.version;
      }
    } catch {
      // Fallback if template has no versions
    }

    const patternRepo = this.dataSource.getRepository(ProductionTemplatePatternEntity);
    const whereClause: any = { templateId, deletedAt: IsNull() };
    if (targetVersionId) {
      whereClause.versionId = targetVersionId;
    }

    const patterns = await patternRepo.find({
      where: whereClause,
      relations: { options: true },
      order: { createdAt: 'ASC' },
    });

    return {
      templateId: template.id,
      templateName: template.name,
      templateVersionId: targetVersionId,
      templateVersion: targetVersionStr,
      patterns: patterns.map((p) => {
        const activeOptions = (p.options || [])
          .filter((o) => !o.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o) => ({
            id: o.id,
            name: o.name,
            sortOrder: o.sortOrder,
          }));
        const defaultOptionId = activeOptions.length > 0 ? activeOptions[0].id : null;
        return {
          id: p.id,
          name: p.name,
          options: activeOptions,
          defaultOptionId,
        };
      }),
    };
  }
}

export const productionTemplateService = new ProductionTemplateService();
