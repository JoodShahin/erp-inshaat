import { DataSource, Repository, IsNull, QueryFailedError } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateEntity } from './production-template.entity.js';
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

export class ProductionTemplateService {
  private templateRepo: Repository<ProductionTemplateEntity>;
  private guardService: ProductionTemplateGuardService;
  private workflowService: ProductionTemplateWorkflowService;
  private patternService: ProductionTemplatePatternService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionTemplateGuardService = productionTemplateGuardService,
    workflowService: ProductionTemplateWorkflowService = productionTemplateWorkflowService,
    patternService: ProductionTemplatePatternService = productionTemplatePatternService
  ) {
    this.templateRepo = this.dataSource.getRepository(ProductionTemplateEntity);
    this.guardService = guardService;
    this.workflowService = workflowService;
    this.patternService = patternService;
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

  async getTemplateById(id: string): Promise<ProductionTemplateDetailDto> {
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

    // Top-level single source of truth for workflow
    const workflowItems = await this.workflowService.listWorkflowItems(id);

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
    const patterns = await this.patternService.listPatterns(id);
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
    const normalizedCode = dto.code.trim().toUpperCase();

    // Check code uniqueness including soft deleted records
    const existing = await this.templateRepo.findOne({
      where: { code: normalizedCode },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictError('رمز القالب مستخدم مسبقاً', 'PRODUCTION_TEMPLATE_CODE_ALREADY_EXISTS');
    }

    const template = this.templateRepo.create({
      name: dto.name.trim(),
      code: normalizedCode,
      referenceNumber: dto.referenceNumber ? dto.referenceNumber.trim() : null,
      description: dto.description ? dto.description.trim() : null,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });

    try {
      const saved = await this.templateRepo.save(template);
      return toProductionTemplateDto(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).driverError?.errno === 1062) {
        throw new ConflictError('رمز القالب مستخدم مسبقاً', 'PRODUCTION_TEMPLATE_CODE_ALREADY_EXISTS');
      }
      throw err;
    }
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

  async getOrderConfiguration(templateId: string): Promise<ProductionTemplateOrderConfigurationDto> {
    const template = await this.guardService.requireExistingTemplate(templateId);
    if (!template.isActive) {
      throw new BusinessRuleError('لا يمكن استخدام قالب تصنيع غير فعال', 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
    }

    const patternRepo = this.dataSource.getRepository(ProductionTemplatePatternEntity);
    const patterns = await patternRepo.find({
      where: { templateId, deletedAt: IsNull() },
      relations: { options: true },
      order: { createdAt: 'ASC' },
    });

    return {
      templateId: template.id,
      templateName: template.name,
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
