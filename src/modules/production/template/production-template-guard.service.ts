import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateEntity } from './production-template.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../template-pattern-option-task/production-template-pattern-option-task.entity.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionTemplateGuardService {
  private templateRepo: Repository<ProductionTemplateEntity>;
  private stageRepo: Repository<ProductionTemplateStageEntity>;
  private patternRepo: Repository<ProductionTemplatePatternEntity>;
  private optionRepo: Repository<ProductionTemplatePatternOptionEntity>;
  private taskRepo: Repository<ProductionTemplatePatternOptionTaskEntity>;
  private versionService: ProductionTemplateVersionService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    versionService: ProductionTemplateVersionService = productionTemplateVersionService
  ) {
    this.templateRepo = this.dataSource.getRepository(ProductionTemplateEntity);
    this.stageRepo = this.dataSource.getRepository(ProductionTemplateStageEntity);
    this.patternRepo = this.dataSource.getRepository(ProductionTemplatePatternEntity);
    this.optionRepo = this.dataSource.getRepository(ProductionTemplatePatternOptionEntity);
    this.taskRepo = this.dataSource.getRepository(ProductionTemplatePatternOptionTaskEntity);
    this.versionService = versionService;
  }

  /**
   * Guards read access: ensures template exists and is NOT archived.
   */
  async requireExistingTemplate(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateEntity> {
    const repo = manager ? manager.getRepository(ProductionTemplateEntity) : this.templateRepo;
    const template = await repo.findOne({
      where: { id: templateId, deletedAt: IsNull() },
    });

    if (!template) {
      throw new NotFoundError('القالب غير موجود', 'PRODUCTION_TEMPLATE_NOT_FOUND');
    }

    return template;
  }

  /**
   * Guards mutation access: ensures template exists and is active/not archived.
   */
  async requireMutableTemplate(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateEntity> {
    const repo = manager ? manager.getRepository(ProductionTemplateEntity) : this.templateRepo;
    const template = await repo.findOne({
      where: { id: templateId, deletedAt: IsNull() },
    });

    if (!template) {
      throw new NotFoundError('القالب غير موجود أو تم أرشفته', 'PRODUCTION_TEMPLATE_NOT_FOUND');
    }

    return template;
  }

  /**
   * Acquires a pessimistic write lock on the parent ProductionTemplate row within an active transaction.
   * Enforces that the template exists and is NOT archived (deletedAt IS NULL).
   * Serves as the unified Lock Root for the entire Production Template aggregate.
   */
  async lockMutableTemplate(
    templateId: string,
    manager: EntityManager
  ): Promise<ProductionTemplateEntity> {
    const template = await manager.findOne(ProductionTemplateEntity, {
      where: { id: templateId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (!template) {
      throw new NotFoundError('القالب غير موجود أو تم أرشفته', 'PRODUCTION_TEMPLATE_NOT_FOUND');
    }

    return template;
  }

  /**
   * Asserts that a specified versionId is the latest active version of the template.
   */
  async assertLatestVersion(
    templateId: string,
    versionId: string,
    manager?: EntityManager
  ): Promise<void> {
    await this.versionService.assertIsLatestVersion(templateId, versionId, manager);
  }

  /**
   * Guards read access to a stage: ensures parent template is active and stage belongs to it.
   */
  async requireStageBelongsToTemplate(
    templateId: string,
    stageId: string,
    manager?: EntityManager
  ): Promise<{ template: ProductionTemplateEntity; stage: ProductionTemplateStageEntity }> {
    const template = await this.requireExistingTemplate(templateId, manager);

    const stageRepo = manager ? manager.getRepository(ProductionTemplateStageEntity) : this.stageRepo;
    const stage = await stageRepo.findOne({
      where: { id: stageId, templateId, deletedAt: IsNull() },
    });

    if (!stage) {
      throw new NotFoundError('المرحلة غير موجودة', 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
    }

    return { template, stage };
  }

  /**
   * Guards mutation access to a stage: ensures parent template is mutable, stage belongs to it,
   * and the stage belongs to the LATEST active version of the template (historical versions are read-only).
   */
  async requireMutableStageBelongsToTemplate(
    templateId: string,
    stageId: string,
    manager?: EntityManager
  ): Promise<{ template: ProductionTemplateEntity; stage: ProductionTemplateStageEntity }> {
    const template = await this.requireMutableTemplate(templateId, manager);

    const stageRepo = manager ? manager.getRepository(ProductionTemplateStageEntity) : this.stageRepo;
    const stage = await stageRepo.findOne({
      where: { id: stageId, templateId, deletedAt: IsNull() },
    });

    if (!stage) {
      throw new NotFoundError('المرحلة غير موجودة', 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
    }

    if (stage.versionId) {
      await this.versionService.assertIsLatestVersion(templateId, stage.versionId, manager);
    }

    return { template, stage };
  }

  /**
   * Guards pattern ownership and existence within parent template.
   */
  async requirePatternBelongsToTemplate(
    templateId: string,
    patternId: string,
    manager?: EntityManager
  ): Promise<{ template: ProductionTemplateEntity; pattern: ProductionTemplatePatternEntity }> {
    const template = await this.requireExistingTemplate(templateId, manager);

    const repo = manager ? manager.getRepository(ProductionTemplatePatternEntity) : this.patternRepo;
    const pattern = await repo.findOne({
      where: { id: patternId, templateId, deletedAt: IsNull() },
    });

    if (!pattern) {
      throw new NotFoundError('النمط غير موجود', 'PRODUCTION_TEMPLATE_PATTERN_NOT_FOUND');
    }

    return { template, pattern };
  }

  /**
   * Guards option ownership and existence: option belongs to pattern, pattern belongs to template.
   * If mutating, enforces that pattern belongs to the LATEST active version.
   */
  async requireOptionBelongsToPattern(
    templateId: string,
    patternId: string,
    optionId: string,
    manager?: EntityManager
  ): Promise<{
    template: ProductionTemplateEntity;
    pattern: ProductionTemplatePatternEntity;
    option: ProductionTemplatePatternOptionEntity;
  }> {
    const { template, pattern } = await this.requirePatternBelongsToTemplate(templateId, patternId, manager);

    const repo = manager ? manager.getRepository(ProductionTemplatePatternOptionEntity) : this.optionRepo;
    const option = await repo.findOne({
      where: { id: optionId, patternId, deletedAt: IsNull() },
    });

    if (!option) {
      throw new NotFoundError('الخيار غير موجود', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_NOT_FOUND');
    }

    return { template, pattern, option };
  }

  /**
   * Guards option mutation: option belongs to pattern, and pattern belongs to LATEST version.
   */
  async requireMutableOptionBelongsToPattern(
    templateId: string,
    patternId: string,
    optionId: string,
    manager?: EntityManager
  ): Promise<{
    template: ProductionTemplateEntity;
    pattern: ProductionTemplatePatternEntity;
    option: ProductionTemplatePatternOptionEntity;
  }> {
    const res = await this.requireOptionBelongsToPattern(templateId, patternId, optionId, manager);
    if (res.pattern.versionId) {
      await this.versionService.assertIsLatestVersion(templateId, res.pattern.versionId, manager);
    }
    return res;
  }

  /**
   * Guards full task ownership chain: task -> option -> pattern -> template.
   */
  async requireTaskBelongsToOption(
    templateId: string,
    patternId: string,
    optionId: string,
    taskId: string,
    manager?: EntityManager
  ): Promise<{
    template: ProductionTemplateEntity;
    pattern: ProductionTemplatePatternEntity;
    option: ProductionTemplatePatternOptionEntity;
    task: ProductionTemplatePatternOptionTaskEntity;
  }> {
    const { template, pattern, option } = await this.requireOptionBelongsToPattern(
      templateId,
      patternId,
      optionId,
      manager
    );

    const repo = manager ? manager.getRepository(ProductionTemplatePatternOptionTaskEntity) : this.taskRepo;
    const task = await repo.findOne({
      where: { id: taskId, optionId, deletedAt: IsNull() },
      relations: { department: true },
    });

    if (!task) {
      throw new NotFoundError('المهمة غير موجودة', 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_NOT_FOUND');
    }

    return { template, pattern, option, task };
  }

  /**
   * Guards task mutation: task -> option -> pattern -> template, enforcing LATEST version.
   */
  async requireMutableTaskBelongsToOption(
    templateId: string,
    patternId: string,
    optionId: string,
    taskId: string,
    manager?: EntityManager
  ): Promise<{
    template: ProductionTemplateEntity;
    pattern: ProductionTemplatePatternEntity;
    option: ProductionTemplatePatternOptionEntity;
    task: ProductionTemplatePatternOptionTaskEntity;
  }> {
    const res = await this.requireTaskBelongsToOption(templateId, patternId, optionId, taskId, manager);
    if (res.pattern.versionId) {
      await this.versionService.assertIsLatestVersion(templateId, res.pattern.versionId, manager);
    }
    return res;
  }
}

export const productionTemplateGuardService = new ProductionTemplateGuardService();
