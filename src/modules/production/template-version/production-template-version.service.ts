import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import crypto from 'node:crypto';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateVersionEntity } from './production-template-version.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import {
  parseVersion,
  formatVersion,
  compareVersions,
  sortVersionsDescending,
  getNextMinorVersion,
} from './version-number.helper.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export interface ProductionTemplateVersionItemDto {
  id: string;
  version: string;
  isLatest: boolean;
  createdAt: Date;
}

export class ProductionTemplateVersionService {
  private versionRepo: Repository<ProductionTemplateVersionEntity>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.versionRepo = this.dataSource.getRepository(ProductionTemplateVersionEntity);
  }

  /**
   * Creates the initial version "1.0" for a newly created template inside a transaction.
   */
  async createInitialVersion(
    templateId: string,
    manager: EntityManager
  ): Promise<ProductionTemplateVersionEntity> {
    const repo = manager.getRepository(ProductionTemplateVersionEntity);
    const initialVersion = repo.create({
      templateId,
      version: '1.0',
    });
    return await repo.save(initialVersion);
  }

  /**
   * Retrieves all active versions of a template sorted by logical version descending.
   */
  async getSortedActiveVersions(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateVersionEntity[]> {
    const repo = manager
      ? manager.getRepository(ProductionTemplateVersionEntity)
      : this.versionRepo;

    const versions = await repo.find({
      where: { templateId, deletedAt: IsNull() },
    });

    if (!versions || versions.length === 0) {
      throw new NotFoundError(
        'لا توجد إصدارات مسجلة لهذا القالب',
        'PRODUCTION_TEMPLATE_VERSION_NOT_FOUND'
      );
    }

    // Sort numerically/logically descending
    return versions.sort((a, b) => compareVersions(b.version, a.version));
  }

  /**
   * Retrieves the latest active version of a template.
   */
  async getLatestVersion(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateVersionEntity> {
    const sorted = await this.getSortedActiveVersions(templateId, manager);
    return sorted[0];
  }

  /**
   * Lists all versions of a template with an isLatest flag.
   */
  async listVersions(
    templateId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateVersionItemDto[]> {
    const sorted = await this.getSortedActiveVersions(templateId, manager);
    return sorted.map((v, index) => ({
      id: v.id,
      version: v.version,
      isLatest: index === 0,
      createdAt: v.createdAt,
    }));
  }

  /**
   * Retrieves a specific version by ID and ensures it belongs to the template.
   */
  async getVersionById(
    templateId: string,
    versionId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateVersionEntity> {
    const repo = manager
      ? manager.getRepository(ProductionTemplateVersionEntity)
      : this.versionRepo;

    const version = await repo.findOne({
      where: { id: versionId, templateId, deletedAt: IsNull() },
    });

    if (!version) {
      throw new NotFoundError(
        'إصدار القالب المطلوب غير موجود أو تم أرشفته',
        'PRODUCTION_TEMPLATE_VERSION_NOT_FOUND'
      );
    }

    return version;
  }

  /**
   * Asserts that the specified version is strictly the latest active version of the template.
   * Throws BusinessRuleError if targeting an older or non-latest version.
   */
  async assertIsLatestVersion(
    templateId: string,
    versionId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateVersionEntity> {
    const latest = await this.getLatestVersion(templateId, manager);
    if (latest.id !== versionId) {
      throw new BusinessRuleError(
        `الإصدار المطلوب (${versionId}) ليس أحدث إصدار للقالب. الإصدارات القديمة للقراءة فقط ويُحظر تعديلها. أحدث إصدار هو: ${latest.version}`,
        'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST'
      );
    }
    return latest;
  }

  /**
   * Creates the next sequential version (e.g. 1.0 -> 1.1, 1.9 -> 1.10).
   * Checks all historical versions (including soft-deleted) to guarantee no version number is ever reused.
   */
  async createNextVersion(
    templateId: string,
    manager: EntityManager
  ): Promise<ProductionTemplateVersionEntity> {
    const repo = manager.getRepository(ProductionTemplateVersionEntity);

    // 1. Fetch current latest active version
    const latestActive = await this.getLatestVersion(templateId, manager);

    // 2. Fetch all historical versions (including soft-deleted) to prevent reuse
    const allHistorical = await repo.find({
      where: { templateId },
      withDeleted: true,
    });
    const historicalVersionStrings = allHistorical.map((v) => v.version);

    // 3. Compute next minor version string
    const nextVersionStr = getNextMinorVersion(
      latestActive.version,
      historicalVersionStrings
    );

    // 4. Create and persist new version record
    const nextVersion = repo.create({
      templateId,
      version: nextVersionStr,
    });

    return await repo.save(nextVersion);
  }

  /**
   * Computes a deterministic revision hash (SHA-256) for a specific template version.
   * Used for optimistic locking and concurrent edit detection.
   */
  async computeVersionRevision(
    templateId: string,
    versionId: string,
    manager?: EntityManager
  ): Promise<string> {
    const mgr = manager || this.dataSource.manager;
    const stageRepo = mgr.getRepository(ProductionTemplateStageEntity);
    const patternRepo = mgr.getRepository(ProductionTemplatePatternEntity);
    const wfRepo = mgr.getRepository(ProductionTemplateWorkflowItemEntity);

    const stages = await stageRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
      order: { id: 'ASC' },
    });

    const patterns = await patternRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
      order: { id: 'ASC' },
    });

    const wfItems = await wfRepo.find({
      where: { templateId, versionId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    const patternIds = patterns.map((p) => p.id);
    let options: any[] = [];
    let tasks: any[] = [];
    if (patternIds.length > 0) {
      options = await mgr
        .createQueryBuilder()
        .select([
          'o.id AS id',
          'o.pattern_id AS patternId',
          'o.name AS name',
          'o.sort_order AS sortOrder',
          'o.updated_at AS updatedAt',
        ])
        .from('production_template_pattern_option', 'o')
        .where('o.pattern_id IN (:...patternIds) AND o.deleted_at IS NULL', { patternIds })
        .orderBy('o.id', 'ASC')
        .getRawMany();

      const optionIds = options.map((o) => o.id);
      if (optionIds.length > 0) {
        tasks = await mgr
          .createQueryBuilder()
          .select([
            't.id AS id',
            't.option_id AS optionId',
            't.name AS name',
            't.sort_order AS sortOrder',
            't.estimated_duration_minutes AS estimatedDurationMinutes',
            't.updated_at AS updatedAt',
          ])
          .from('production_template_pattern_option_task', 't')
          .where('t.option_id IN (:...optionIds) AND t.deleted_at IS NULL', { optionIds })
          .orderBy('t.id', 'ASC')
          .getRawMany();
      }
    }

    const stageIds = stages.map((s) => s.id);
    let stageMats: any[] = [];
    let stageAtts: any[] = [];
    if (stageIds.length > 0) {
      stageMats = await mgr
        .createQueryBuilder()
        .select([
          'm.id AS id',
          'm.stage_id AS stageId',
          'm.product_id AS productId',
          'm.product_unit_id AS productUnitId',
          'm.planned_quantity AS plannedQuantity',
        ])
        .from('production_template_stage_material', 'm')
        .where('m.stage_id IN (:...stageIds)', { stageIds })
        .orderBy('m.id', 'ASC')
        .getRawMany();

      stageAtts = await mgr
        .createQueryBuilder()
        .select([
          'a.id AS id',
          'a.stage_id AS stageId',
          'a.file_id AS fileId',
          'a.storage_key AS storageKey',
          'a.description AS description',
          'a.sort_order AS sortOrder',
        ])
        .from('production_template_stage_attachment', 'a')
        .where('a.stage_id IN (:...stageIds) AND a.deleted_at IS NULL', { stageIds })
        .orderBy('a.id', 'ASC')
        .getRawMany();
    }

    const taskIds = tasks.map((t) => t.id);
    let taskMats: any[] = [];
    let taskAtts: any[] = [];
    if (taskIds.length > 0) {
      taskMats = await mgr
        .createQueryBuilder()
        .select([
          'tm.id AS id',
          'tm.task_id AS taskId',
          'tm.product_id AS productId',
          'tm.product_unit_id AS productUnitId',
          'tm.planned_quantity AS plannedQuantity',
        ])
        .from('production_template_pattern_option_task_material', 'tm')
        .where('tm.task_id IN (:...taskIds)', { taskIds })
        .orderBy('tm.id', 'ASC')
        .getRawMany();

      taskAtts = await mgr
        .createQueryBuilder()
        .select([
          'ta.id AS id',
          'ta.task_id AS taskId',
          'ta.file_id AS fileId',
          'ta.storage_key AS storageKey',
          'ta.description AS description',
          'ta.sort_order AS sortOrder',
        ])
        .from('production_template_pattern_option_task_attachment', 'ta')
        .where('ta.task_id IN (:...taskIds) AND ta.deleted_at IS NULL', { taskIds })
        .orderBy('ta.id', 'ASC')
        .getRawMany();
    }

    const specs = await mgr
      .createQueryBuilder()
      .select([
        'sp.id AS id',
        'sp.name AS name',
        'sp.value AS value',
        'sp.unit AS unit',
        'sp.sort_order AS sortOrder',
      ])
      .from('production_template_specification', 'sp')
      .where('sp.template_id = :templateId', { templateId })
      .orderBy('sp.id', 'ASC')
      .getRawMany();

    const payload = {
      templateId,
      versionId,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.description || null,
        dept: s.departmentId,
        dur: s.estimatedDurationMinutes,
        durVal: s.estimatedDurationValue != null ? Number(s.estimatedDurationValue) : null,
        durUnit: s.estimatedDurationUnit || null,
        cost: s.estimatedCost != null ? Number(s.estimatedCost) : null,
        updated: s.updatedAt?.getTime?.() || null,
      })),
      patterns: patterns.map((p) => ({
        id: p.id,
        name: p.name,
        updated: p.updatedAt?.getTime?.() || null,
      })),
      options: options.map((o) => ({
        id: o.id,
        patternId: o.patternId,
        name: o.name,
        code: o.code || null,
        desc: o.description || null,
        sortOrder: o.sortOrder,
        updated: o.updatedAt instanceof Date ? o.updatedAt.getTime() : o.updatedAt,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        optionId: t.optionId,
        name: t.name,
        code: t.code || null,
        desc: t.description || null,
        dept: t.departmentId,
        sortOrder: t.sortOrder,
        dur: t.estimatedDurationMinutes,
        durVal: t.estimatedDurationValue != null ? Number(t.estimatedDurationValue) : null,
        durUnit: t.estimatedDurationUnit || null,
        cost: t.estimatedCost != null ? Number(t.estimatedCost) : null,
        updated: t.updatedAt instanceof Date ? t.updatedAt.getTime() : t.updatedAt,
      })),
      stageMats: stageMats.map((m) => ({
        id: m.id,
        stageId: m.stageId,
        productId: m.productId,
        productUnitId: m.productUnitId || null,
        qty: m.plannedQuantity != null ? Number(m.plannedQuantity) : null,
      })),
      stageAtts: stageAtts.map((a) => ({
        id: a.id,
        stageId: a.stageId,
        fileId: a.fileId || null,
        storageKey: a.storageKey,
        desc: a.description || null,
        sortOrder: a.sortOrder,
      })),
      taskMats: taskMats.map((m) => ({
        id: m.id,
        taskId: m.taskId,
        productId: m.productId,
        productUnitId: m.productUnitId || null,
        qty: m.plannedQuantity != null ? Number(m.plannedQuantity) : null,
      })),
      taskAtts: taskAtts.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        fileId: a.fileId || null,
        storageKey: a.storageKey,
        desc: a.description || null,
        sortOrder: a.sortOrder,
      })),
      specs: specs.map((sp) => ({
        id: sp.id,
        name: sp.name,
        val: sp.value,
        unit: sp.unit || null,
        sortOrder: sp.sortOrder,
      })),
      wf: wfItems.map((w) => ({
        id: w.id,
        itemType: w.itemType,
        stageId: w.stageId,
        patternId: w.patternId,
        order: w.sortOrder,
      })),
    };

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

export const productionTemplateVersionService = new ProductionTemplateVersionService();
