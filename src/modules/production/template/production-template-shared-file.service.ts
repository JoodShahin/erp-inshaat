import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import {
  ProductionTemplateFileCleanupQueueEntity,
  FileCleanupStatus,
} from '../template-stored-file/production-template-file-cleanup-queue.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { productionTemplateReferenceFileStorageService } from './production-template-reference-file-storage.service.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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
  private cleanupRepo: Repository<ProductionTemplateFileCleanupQueueEntity>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.fileRepo = this.dataSource.getRepository(ProductionTemplateStoredFileEntity);
    this.cleanupRepo = this.dataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);
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
        // Check physical file existence and cleanup status
        const fullPath = path.resolve(process.cwd(), existing.storageKey);
        const physicalExists = fs.existsSync(fullPath);

        const cleanupRepo = manager
          ? manager.getRepository(ProductionTemplateFileCleanupQueueEntity)
          : this.cleanupRepo;
        const cleanupRecord = await cleanupRepo.findOne({
          where: { fileId: existing.id },
          order: { createdAt: 'DESC' },
        });

        if (!physicalExists || (cleanupRecord && cleanupRecord.status === FileCleanupStatus.COMPLETED)) {
          throw new BusinessRuleError(
            'الملف المخزن تم حذفه فيزيائياً أو دخل مرحلة التنظيف النهائي ولا يمكن إعادة استخدامه',
            'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
          );
        }

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
   * Uses transactional locking on the StoredFile row to eliminate race conditions with concurrent reuse.
   * Persists an entry in the file cleanup queue for auditability and recoverable retries.
   */
  async safeDeletePhysicalFileIfUnreferenced(
    fileId: string,
    _optionalStorageKey?: string
  ): Promise<boolean> {
    try {
      let shouldUnlink = false;
      let trustedStorageKey = '';
      let cleanupQueueId = '';

      await this.dataSource.transaction(async (manager) => {
        const fileRepo = manager.getRepository(ProductionTemplateStoredFileEntity);
        const file = await fileRepo.findOne({
          where: { id: fileId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!file) {
          return;
        }

        const refCount = await this.countActiveReferences(fileId, undefined, manager);
        if (refCount === 0) {
          trustedStorageKey = file.storageKey;
          file.deletedAt = new Date();
          await fileRepo.save(file);

          const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);
          const queueItem = cleanupRepo.create({
            fileId,
            storageKey: trustedStorageKey,
            status: FileCleanupStatus.PENDING,
            attempts: 0,
          });
          const savedQueue = await cleanupRepo.save(queueItem);
          cleanupQueueId = savedQueue.id;
          shouldUnlink = true;
        }
      });

      if (shouldUnlink && trustedStorageKey && cleanupQueueId) {
        try {
          const absolutePath = path.resolve(process.cwd(), trustedStorageKey);
          if (fs.existsSync(absolutePath)) {
            await fsp.unlink(absolutePath);
          } else {
            throw new Error(`الملف الفيزيائي غير موجود على القرص: ${trustedStorageKey}`);
          }
          await this.cleanupRepo.update(cleanupQueueId, {
            status: FileCleanupStatus.COMPLETED,
            attempts: 1,
            lastError: null,
          });
          return true;
        } catch (unlinkErr: any) {
          console.warn(`Could not unlink unreferenced file ${trustedStorageKey}:`, unlinkErr);
          await this.cleanupRepo.update(cleanupQueueId, {
            status: FileCleanupStatus.FAILED,
            attempts: 1,
            lastError: unlinkErr?.message || String(unlinkErr),
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
          });
          return false;
        }
      }
      return false;
    } catch (err) {
      console.warn(`Error during safe file deletion check for fileId ${fileId}:`, err);
      return false;
    }
  }

  /**
   * Retries physical unlink for a failed or pending cleanup queue item.
   */
  async retryFileCleanup(cleanupId: string): Promise<boolean> {
    const queueItem = await this.cleanupRepo.findOne({ where: { id: cleanupId } });
    if (!queueItem || queueItem.status === FileCleanupStatus.COMPLETED) {
      return false;
    }

    // Check if the file was re-referenced in the meantime
    const refCount = await this.countActiveReferences(queueItem.fileId);
    if (refCount > 0) {
      // Re-referenced! Cancel physical cleanup
      await this.cleanupRepo.update(cleanupId, {
        status: FileCleanupStatus.COMPLETED,
        lastError: 'File was re-referenced by active template; cleanup cancelled',
      });
      return false;
    }

    try {
      const absolutePath = path.resolve(process.cwd(), queueItem.storageKey);
      if (fs.existsSync(absolutePath)) {
        await fsp.unlink(absolutePath);
      } else {
        throw new Error(`الملف الفيزيائي غير موجود على القرص: ${queueItem.storageKey}`);
      }
      await this.cleanupRepo.update(cleanupId, {
        status: FileCleanupStatus.COMPLETED,
        attempts: queueItem.attempts + 1,
        lastError: null,
      });
      return true;
    } catch (err: any) {
      await this.cleanupRepo.update(cleanupId, {
        status: FileCleanupStatus.FAILED,
        attempts: queueItem.attempts + 1,
        lastError: err?.message || String(err),
        nextRetryAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      return false;
    }
  }
}

export const productionTemplateSharedFileService = new ProductionTemplateSharedFileService();
