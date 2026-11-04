import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateVersionEntity } from './production-template-version.entity.js';
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
}

export const productionTemplateVersionService = new ProductionTemplateVersionService();
