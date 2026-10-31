import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionYardTemplateEntity } from './production-yard-template.entity.js';
import { ProductionYardEntity } from '../yard/production-yard.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ResolvedProductionAccessPolicy } from '../authorization/production-access-policy.types.js';
import { canAccessYard } from '../authorization/production-access-query.helper.js';
import {
  AvailableTemplateOptionDto,
  ProductionYardTemplateDto,
  toProductionYardTemplateDto,
} from './production-yard-template.types.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { ForbiddenError } from '../../../common/errors/forbidden.error.js';
import { ConflictError } from '../../../common/errors/conflict.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionYardTemplateService {
  private readonly dataSource: DataSource;
  private readonly yardTemplateRepository: Repository<ProductionYardTemplateEntity>;
  private readonly yardRepository: Repository<ProductionYardEntity>;
  private readonly templateRepository: Repository<ProductionTemplateEntity>;

  constructor(
    dataSource: DataSource = AppDataSource,
    yardTemplateRepo: Repository<ProductionYardTemplateEntity> = dataSource.getRepository(ProductionYardTemplateEntity),
    yardRepo: Repository<ProductionYardEntity> = dataSource.getRepository(ProductionYardEntity),
    templateRepo: Repository<ProductionTemplateEntity> = dataSource.getRepository(ProductionTemplateEntity)
  ) {
    this.dataSource = dataSource;
    this.yardTemplateRepository = yardTemplateRepo;
    this.yardRepository = yardRepo;
    this.templateRepository = templateRepo;
  }

  /**
   * List templates assigned to a specific yard.
   * Enforces PRODUCTION_YARD_TEMPLATE_VIEW access scope on the yard.
   */
  async listYardTemplates(
    yardId: string,
    policy: ResolvedProductionAccessPolicy
  ): Promise<ProductionYardTemplateDto[]> {
    const yard = await this.yardRepository.findOne({
      where: { id: yardId, deletedAt: IsNull() },
    });

    if (!yard) {
      throw new NotFoundError('ساحة الإنتاج غير موجودة', 'PRODUCTION_YARD_NOT_FOUND');
    }

    if (!canAccessYard(policy, yard)) {
      throw new ForbiddenError('ليس لديك صلاحية للوصول إلى هذه الساحة', 'ACCESS_SCOPE_DENIED');
    }

    const items = await this.yardTemplateRepository
      .createQueryBuilder('yt')
      .leftJoinAndSelect('yt.template', 'template')
      .where('yt.yardId = :yardId', { yardId })
      .andWhere('template.deletedAt IS NULL')
      .orderBy('yt.createdAt', 'DESC')
      .getMany();

    return items.map((item) => toProductionYardTemplateDto(item));
  }

  /**
   * Get active templates available for assignment to a specific yard,
   * with `isAssigned` indicating whether the template is already linked.
   * Enforces PRODUCTION_YARD_TEMPLATE_VIEW access scope on the yard.
   */
  async getAvailableTemplatesForYard(
    yardId: string,
    policy: ResolvedProductionAccessPolicy,
    search?: string
  ): Promise<AvailableTemplateOptionDto[]> {
    const yard = await this.yardRepository.findOne({
      where: { id: yardId, deletedAt: IsNull() },
    });

    if (!yard) {
      throw new NotFoundError('ساحة الإنتاج غير موجودة', 'PRODUCTION_YARD_NOT_FOUND');
    }

    if (!canAccessYard(policy, yard)) {
      throw new ForbiddenError('ليس لديك صلاحية للوصول إلى هذه الساحة', 'ACCESS_SCOPE_DENIED');
    }

    const assigned = await this.yardTemplateRepository.find({
      where: { yardId },
      select: { templateId: true },
    });
    const assignedIds = new Set(assigned.map((a) => a.templateId));

    const qb = this.templateRepository
      .createQueryBuilder('tmpl')
      .where('tmpl.deletedAt IS NULL')
      .andWhere('tmpl.isActive = :isActive', { isActive: true });

    if (search && search.trim() !== '') {
      const term = `%${search.trim()}%`;
      qb.andWhere('(tmpl.name LIKE :term OR tmpl.code LIKE :term)', { term });
    }

    qb.orderBy('tmpl.name', 'ASC');

    const templates = await qb.getMany();

    return templates.map((tmpl) => ({
      id: tmpl.id,
      name: tmpl.name,
      code: tmpl.code,
      description: tmpl.description,
      isActive: tmpl.isActive,
      isAssigned: assignedIds.has(tmpl.id),
    }));
  }

  /**
   * Batch link templates to a yard within an atomic transaction.
   * Enforces PRODUCTION_YARD_TEMPLATE_ADD access scope on the yard.
   * Verifies yard is active, templates exist and are active, and no duplicate links exist.
   * Rolls back completely if any condition fails.
   */
  async addTemplatesToYard(
    yardId: string,
    templateIds: string[],
    policy: ResolvedProductionAccessPolicy,
    currentUserId?: string | null
  ): Promise<ProductionYardTemplateDto[]> {
    const uniqueTemplateIds = Array.from(new Set(templateIds.filter((id) => Boolean(id))));
    if (uniqueTemplateIds.length === 0) {
      throw new BusinessRuleError('يجب تحديد قالب واحد على الأقل', 'NO_TEMPLATES_PROVIDED');
    }

    return await this.dataSource.transaction(async (manager) => {
      const yardRepo = manager.getRepository(ProductionYardEntity);
      const tmplRepo = manager.getRepository(ProductionTemplateEntity);
      const ytRepo = manager.getRepository(ProductionYardTemplateEntity);

      const yard = await yardRepo.findOne({
        where: { id: yardId, deletedAt: IsNull() },
      });

      if (!yard) {
        throw new NotFoundError('ساحة الإنتاج غير موجودة', 'PRODUCTION_YARD_NOT_FOUND');
      }

      if (!yard.isActive) {
        throw new BusinessRuleError('لا يمكن ربط قوالب بساحة معطلة', 'PRODUCTION_YARD_INACTIVE');
      }

      if (!canAccessYard(policy, yard)) {
        throw new ForbiddenError('ليس لديك صلاحية لربط قوالب بهذه الساحة', 'ACCESS_SCOPE_DENIED');
      }

      const templates = await tmplRepo.find({
        where: { id: In(uniqueTemplateIds), deletedAt: IsNull() },
      });

      if (templates.length !== uniqueTemplateIds.length) {
        throw new NotFoundError(
          'واحد أو أكثر من القوالب المحددة غير موجود',
          'PRODUCTION_TEMPLATE_NOT_FOUND'
        );
      }

      for (const tmpl of templates) {
        if (!tmpl.isActive) {
          throw new BusinessRuleError(
            `القالب "${tmpl.name}" معطل ولا يمكن ربطه بالساحة`,
            'PRODUCTION_TEMPLATE_INACTIVE'
          );
        }
      }

      const existingLinks = await ytRepo.find({
        where: { yardId, templateId: In(uniqueTemplateIds) },
      });

      if (existingLinks.length > 0) {
        throw new ConflictError(
          'واحد أو أكثر من القوالب المحددة مرتبط بالفعل بهذه الساحة',
          'PRODUCTION_YARD_TEMPLATE_ALREADY_EXISTS'
        );
      }

      const newLinks = uniqueTemplateIds.map((tmplId) =>
        ytRepo.create({
          yardId,
          templateId: tmplId,
          createdByUserId: currentUserId || null,
        })
      );

      const savedLinks = await ytRepo.save(newLinks);

      const savedWithRelations = await ytRepo
        .createQueryBuilder('yt')
        .leftJoinAndSelect('yt.template', 'template')
        .where('yt.id IN (:...ids)', { ids: savedLinks.map((l) => l.id) })
        .orderBy('yt.createdAt', 'ASC')
        .getMany();

      return savedWithRelations.map((item) => toProductionYardTemplateDto(item));
    });
  }

  /**
   * Single template link wrapper.
   */
  async addTemplateToYard(
    yardId: string,
    templateId: string,
    policy: ResolvedProductionAccessPolicy,
    currentUserId?: string | null
  ): Promise<ProductionYardTemplateDto> {
    const results = await this.addTemplatesToYard(
      yardId,
      [templateId],
      policy,
      currentUserId
    );
    return results[0];
  }

  /**
   * Remove template link from a yard.
   * Enforces PRODUCTION_YARD_TEMPLATE_REMOVE access scope on the yard.
   * Hard-deletes junction record without affecting yard, template, or execution units.
   */
  async removeTemplateFromYard(
    yardId: string,
    templateId: string,
    policy: ResolvedProductionAccessPolicy
  ): Promise<void> {
    const yard = await this.yardRepository.findOne({
      where: { id: yardId, deletedAt: IsNull() },
    });

    if (!yard) {
      throw new NotFoundError('ساحة الإنتاج غير موجودة', 'PRODUCTION_YARD_NOT_FOUND');
    }

    if (!canAccessYard(policy, yard)) {
      throw new ForbiddenError(
        'ليس لديك صلاحية لفك ارتباط قوالب من هذه الساحة',
        'ACCESS_SCOPE_DENIED'
      );
    }

    const link = await this.yardTemplateRepository.findOne({
      where: { yardId, templateId },
    });

    if (!link) {
      throw new NotFoundError(
        'ارتباط القالب بالساحة غير موجود',
        'PRODUCTION_YARD_TEMPLATE_NOT_FOUND'
      );
    }

    await this.yardTemplateRepository.delete({ id: link.id });
  }
}

export const productionYardTemplateService = new ProductionYardTemplateService();
