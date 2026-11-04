import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { productionTemplateReferenceFileStorageService } from './production-template-reference-file-storage.service.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CreateStoredFileDto {
  templateId: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number | string;
  createdByUserId?: string | null;
}

export class ProductionTemplateSharedFileService {
  private fileRepo: Repository<ProductionTemplateStoredFileEntity>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.fileRepo = this.dataSource.getRepository(ProductionTemplateStoredFileEntity);
  }

  /**
   * Registers a newly uploaded or stored file under a template.
   * If a stored file with the same storageKey already exists, returns it (idempotent registration).
   */
  async getOrCreateStoredFile(
    data: CreateStoredFileDto,
    manager?: EntityManager
  ): Promise<ProductionTemplateStoredFileEntity> {
    const repo = manager
      ? manager.getRepository(ProductionTemplateStoredFileEntity)
      : this.fileRepo;

    const existing = await repo.findOne({
      where: { storageKey: data.storageKey },
      withDeleted: true,
    });

    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = null;
        return await repo.save(existing);
      }
      return existing;
    }

    const newFile = repo.create({
      templateId: data.templateId,
      storageKey: data.storageKey,
      originalFileName: data.originalFileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      createdByUserId: data.createdByUserId || null,
    });

    return await repo.save(newFile);
  }

  /**
   * Retrieves a stored file by ID.
   */
  async getStoredFileById(
    fileId: string,
    manager?: EntityManager
  ): Promise<ProductionTemplateStoredFileEntity> {
    const repo = manager
      ? manager.getRepository(ProductionTemplateStoredFileEntity)
      : this.fileRepo;

    const file = await repo.findOne({
      where: { id: fileId, deletedAt: IsNull() },
    });

    if (!file) {
      throw new NotFoundError('الملف المخزن غير موجود', 'PRODUCTION_TEMPLATE_STORED_FILE_NOT_FOUND');
    }

    return file;
  }

  /**
   * Checks if a file or storage key is still referenced by any active stage or task attachments
   * across all versions of templates.
   */
  async countActiveReferences(
    fileId: string,
    exclude?: { stageAttachmentId?: string; taskAttachmentId?: string },
    manager?: EntityManager
  ): Promise<number> {
    const stageAttRepo = manager
      ? manager.getRepository(ProductionTemplateStageAttachmentEntity)
      : this.dataSource.getRepository(ProductionTemplateStageAttachmentEntity);

    const taskAttRepo = manager
      ? manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity)
      : this.dataSource.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);

    let stageQb = stageAttRepo
      .createQueryBuilder('a')
      .where('a.fileId = :fileId AND a.deletedAt IS NULL', { fileId });

    if (exclude?.stageAttachmentId) {
      stageQb = stageQb.andWhere('a.id != :excludeStageId', { excludeStageId: exclude.stageAttachmentId });
    }

    const stageCount = await stageQb.getCount();

    let taskQb = taskAttRepo
      .createQueryBuilder('a')
      .where('a.fileId = :fileId AND a.deletedAt IS NULL', { fileId });

    if (exclude?.taskAttachmentId) {
      taskQb = taskQb.andWhere('a.id != :excludeTaskId', { excludeTaskId: exclude.taskAttachmentId });
    }

    const taskCount = await taskQb.getCount();

    return stageCount + taskCount;
  }

  /**
   * Safely deletes the physical file from disk ONLY IF no active references exist across any versions.
   * Called post-commit.
   */
  async safeDeletePhysicalFileIfUnreferenced(
    fileId: string,
    storageKey: string
  ): Promise<boolean> {
    try {
      const refCount = await this.countActiveReferences(fileId);
      if (refCount === 0) {
        // Soft delete stored file record
        await this.fileRepo.softDelete(fileId);

        // Remove from physical disk using safe path resolver with path.relative check
        try {
          await productionTemplateReferenceFileStorageService.deleteStoredFile(storageKey);
        } catch (unlinkErr: any) {
          console.warn(`Could not unlink unreferenced file ${storageKey}:`, unlinkErr);
        }
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`Error during safe file deletion check for fileId ${fileId}:`, err);
      return false;
    }
  }
}

export const productionTemplateSharedFileService = new ProductionTemplateSharedFileService();
