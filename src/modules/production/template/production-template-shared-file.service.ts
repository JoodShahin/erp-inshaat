import { DataSource, EntityManager, Repository, IsNull, In, Not } from 'typeorm';
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
import { logger } from '../../../common/logging/logger.js';
import crypto from 'node:crypto';

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
   * Enforces pessimistic locking and strict cleanup/lifecycle protection.
   */
  async getOrCreateStoredFile(
    data: CreateStoredFileDto,
    manager?: EntityManager
  ): Promise<ProductionTemplateStoredFileEntity> {
    const executeInTx = async (txManager: EntityManager): Promise<ProductionTemplateStoredFileEntity> => {
      const repo = txManager.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = txManager.getRepository(ProductionTemplateFileCleanupQueueEntity);

      // Lock existing record by storageKey with pessimistic_write
      const existing = await repo.findOne({
        where: { storageKey: data.storageKey },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });

      if (existing) {
        // Invariant: Do not return a file record belonging to another template
        if (existing.templateId !== data.templateId) {
          throw new BusinessRuleError(
            'مفتاح التخزين مرتبط بسجل يخص قالباً آخر ولا يمكن مشاركته بين قوالب مختلفة',
            'PRODUCTION_TEMPLATE_STORED_FILE_TEMPLATE_MISMATCH'
          );
        }

        // Invariant: If file was soft-deleted, it cannot be automatically resurrected
        if (existing.deletedAt) {
          throw new BusinessRuleError(
            'الملف مؤرشف أو دخل مرحلة التنظيف ولا يمكن إعادة استخدامه تلقائياً',
            'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
          );
        }

        // Check if there is any cleanup queue task (PENDING, PROCESSING, FAILED, COMPLETED)
        const cleanupTask = await cleanupRepo.findOne({
          where: {
            fileId: existing.id,
            status: In([
              FileCleanupStatus.PENDING,
              FileCleanupStatus.PROCESSING,
              FileCleanupStatus.FAILED,
              FileCleanupStatus.COMPLETED,
            ]),
          },
        });

        if (cleanupTask) {
          throw new BusinessRuleError(
            'الملف مؤرشف أو دخل مرحلة التنظيف ولا يمكن إعادة استخدامه تلقائياً',
            'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
          );
        }

        return existing;
      }

      // No existing record -> Create a new StoredFile
      const newFile = repo.create({
        templateId: data.templateId,
        storageKey: data.storageKey,
        originalFileName: data.originalFileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        createdByUserId: data.createdByUserId || null,
      });

      return await repo.save(newFile);
    };

    if (manager) {
      return await executeInTx(manager);
    } else {
      return await this.dataSource.transaction(executeInTx);
    }
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
   * Unified pipeline for executing a cleanup task atomically.
   * Enforces pessimistic lock order (StoredFile -> CleanupQueue),
   * obtains an exclusive lease (PROCESSING + claimId), unlinks via storage service,
   * and finalizes state to COMPLETED or FAILED.
   */
  async executeCleanupTask(cleanupId: string, forceRetry = false): Promise<boolean> {
    let claimResult: {
      claimed: boolean;
      task?: ProductionTemplateFileCleanupQueueEntity;
      trustedStorageKey?: string;
      claimId?: string;
    } = { claimed: false };

    // Step 1-5: Atomic Claim within MySQL Transaction
    try {
      await this.dataSource.transaction(async (manager) => {
        const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);
        const fileRepo = manager.getRepository(ProductionTemplateStoredFileEntity);

        // Fetch task peek to identify fileId
        const taskPeek = await cleanupRepo.findOne({ where: { id: cleanupId } });
        if (!taskPeek || taskPeek.status === FileCleanupStatus.COMPLETED) {
          return;
        }

        // Lock StoredFile FIRST with pessimistic_write (universal lock order)
        const file = await fileRepo.findOne({
          where: { id: taskPeek.fileId },
          withDeleted: true,
          lock: { mode: 'pessimistic_write' },
        });
        if (!file) {
          return;
        }
        if (!file.deletedAt) {
          const refCount = await this.countActiveReferences(file.id, undefined, manager);
          if (refCount > 0) {
            return;
          }
          file.deletedAt = new Date();
          await fileRepo.save(file);
        }

        // Lock CleanupQueue row SECOND with pessimistic_write
        const task = await cleanupRepo.findOne({
          where: { id: cleanupId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!task || task.status === FileCleanupStatus.COMPLETED) {
          return;
        }

        // Check task status & lease expiration
        const now = new Date();
        if (task.status === FileCleanupStatus.PROCESSING) {
          // If another worker holds an active lease that has not expired, do not steal it
          if (task.claimExpiresAt && task.claimExpiresAt > now) {
            return;
          }
          // Lease expired (worker crash recovery): allowed to reclaim
        } else if (task.status !== FileCleanupStatus.PENDING && task.status !== FileCleanupStatus.FAILED) {
          return;
        }

        // Verify scheduled retry time
        if (!forceRetry && task.status === FileCleanupStatus.FAILED && task.nextRetryAt && task.nextRetryAt > now) {
          return;
        }

        // Check active references across templates and versions
        const refCount = await this.countActiveReferences(file.id, undefined, manager);
        if (refCount > 0) {
          // Re-referenced! Cancel physical cleanup safely
          task.status = FileCleanupStatus.COMPLETED;
          task.lastError = 'File was re-referenced by active template; cleanup cancelled';
          task.claimId = null;
          task.claimExpiresAt = null;
          await cleanupRepo.save(task);
          return;
        }

        // Ensure no other task for the same file is currently PROCESSING with valid lease
        const otherProcessing = await cleanupRepo.findOne({
          where: {
            fileId: file.id,
            status: FileCleanupStatus.PROCESSING,
          },
        });
        if (
          otherProcessing &&
          otherProcessing.id !== task.id &&
          otherProcessing.claimExpiresAt &&
          otherProcessing.claimExpiresAt > now
        ) {
          return;
        }

        // Verify storageKey consistency
        if (task.storageKey !== file.storageKey) {
          throw new BusinessRuleError(
            'تعارض في مسار تخزين الملف بين السجل والطابور',
            'ATTACHMENT_STORAGE_KEY_MISMATCH'
          );
        }

        // Atomically claim the task
        const claimId = crypto.randomUUID();
        task.status = FileCleanupStatus.PROCESSING;
        task.claimId = claimId;
        task.claimedAt = now;
        task.claimExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-minute lease
        await cleanupRepo.save(task);

        claimResult = {
          claimed: true,
          task,
          trustedStorageKey: file.storageKey,
          claimId,
        };
      });
    } catch (claimErr) {
      logger.error(`Error during claimCleanupTask for ${cleanupId}:`, claimErr);
      return false;
    }

    if (!claimResult.claimed || !claimResult.trustedStorageKey || !claimResult.claimId) {
      return false;
    }

    const { trustedStorageKey, claimId } = claimResult;

    // Step 6: Physical Deletion outside MySQL transaction using storage service
    let unlinkSuccess = false;
    let unlinkError: string | null = null;
    try {
      await productionTemplateReferenceFileStorageService.deleteStoredFile(trustedStorageKey);
      unlinkSuccess = true;
    } catch (err: any) {
      unlinkSuccess = false;
      unlinkError = err?.code ? `${err.code}: ${err.message}` : (err?.message || String(err));
      logger.warn(`Could not unlink unreferenced file ${trustedStorageKey}:`, err);
    }

    // Step 7: Finalize state within short transaction, verifying claimId ownership
    try {
      await this.dataSource.transaction(async (manager) => {
        const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);
        const task = await cleanupRepo.findOne({
          where: { id: cleanupId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!task) return;

        // Verify we still own the claim (lease was not stolen during long I/O)
        if (task.claimId !== claimId) {
          logger.warn(`Cleanup claim for task ${cleanupId} was lost during processing`);
          return;
        }

        if (unlinkSuccess) {
          task.status = FileCleanupStatus.COMPLETED;
          task.attempts += 1;
          task.lastError = null;
          task.claimExpiresAt = null;
          task.nextRetryAt = null;
          await cleanupRepo.save(task);
        } else {
          task.status = FileCleanupStatus.FAILED;
          task.attempts += 1;
          task.lastError = unlinkError;
          task.claimId = null;
          task.claimExpiresAt = null;
          task.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);
          await cleanupRepo.save(task);
        }
      });
    } catch (finalizeErr) {
      logger.error(`Error finalizing cleanup task ${cleanupId}:`, finalizeErr);
      return false;
    }

    return unlinkSuccess;
  }

  /**
   * Safely marks physical file for cleanup ONLY IF no active references exist across any versions.
   * Locks the StoredFile row, sets deletedAt, creates or reuses an existing PENDING CleanupQueue row,
   * and executes the unified cleanup pipeline.
   */
  async safeDeletePhysicalFileIfUnreferenced(
    fileId: string,
    _optionalStorageKey?: string
  ): Promise<boolean> {
    try {
      let cleanupQueueId: string | null = null;

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
        if (refCount > 0) {
          return;
        }

        // Put file in non-reusable state
        file.deletedAt = new Date();
        await fileRepo.save(file);

        const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);

        // Check if an active cleanup task already exists to prevent duplicate scheduling
        let queueItem = await cleanupRepo.findOne({
          where: {
            fileId,
            status: In([FileCleanupStatus.PENDING, FileCleanupStatus.PROCESSING]),
          },
        });

        if (!queueItem) {
          queueItem = cleanupRepo.create({
            fileId,
            storageKey: file.storageKey,
            status: FileCleanupStatus.PENDING,
            attempts: 0,
          });
          queueItem = await cleanupRepo.save(queueItem);
        }

        cleanupQueueId = queueItem.id;
      });

      if (!cleanupQueueId) {
        return false;
      }

      // Execute unified cleanup pipeline
      return await this.executeCleanupTask(cleanupQueueId);
    } catch (err) {
      logger.error(`Error during safe file deletion check for fileId ${fileId}:`, err);
      return false;
    }
  }

  /**
   * Retries physical unlink for a failed or pending cleanup queue item.
   */
  async retryFileCleanup(cleanupId: string): Promise<boolean> {
    return await this.executeCleanupTask(cleanupId, true);
  }
}

export const productionTemplateSharedFileService = new ProductionTemplateSharedFileService();
