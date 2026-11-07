import { DataSource, EntityManager, Repository, IsNull, In, Brackets } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import {
  ProductionTemplateFileCleanupQueueEntity,
  FileCleanupStatus,
} from '../template-stored-file/production-template-file-cleanup-queue.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionTemplateVersionEntity } from '../template-version/production-template-version.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { compareVersions } from '../template-version/version-number.helper.js';
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

  /** Optional test hook to pause execution right before pre-unlink check (e.g. Test A-T1b) */
  public _testPreUnlinkBarrier?: () => Promise<void>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.fileRepo = this.dataSource.getRepository(ProductionTemplateStoredFileEntity);
    this.cleanupRepo = this.dataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);
  }

  /**
   * Registers a newly uploaded or stored file under a template.
   * If a stored file with the same storageKey already exists, returns it (idempotent registration).
   * Enforces pessimistic locking, immutable storage identity, and strict cleanup/lifecycle protection.
   */
  async getOrCreateStoredFile(
    data: CreateStoredFileDto,
    manager?: EntityManager
  ): Promise<ProductionTemplateStoredFileEntity> {
    const executeInTx = async (txManager: EntityManager): Promise<ProductionTemplateStoredFileEntity> => {
      const repo = txManager.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = txManager.getRepository(ProductionTemplateFileCleanupQueueEntity);

      // Lock existing record by storageKey with pessimistic_write (including soft-deleted)
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

      // Defense-in-depth: Check if storageKey has ever entered cleanup queue
      const queueByStorageKey = await cleanupRepo.findOne({
        where: { storageKey: data.storageKey },
      });
      if (queueByStorageKey) {
        throw new BusinessRuleError(
          'مفتاح التخزين مخصص لعملية تنظيف أو تم حذفه مسبقاً ولا يمكن إعادة استخدامه',
          'PRODUCTION_TEMPLATE_STORED_FILE_DELETED'
        );
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
   * Checks whether a stored file has retention references that require keeping the physical file,
   * including active attachments across versions, attachments belonging to historical template versions,
   * or versions pinned by production order lines.
   */
  async hasRetentionReferences(
    fileId: string,
    manager?: EntityManager
  ): Promise<boolean> {
    const em = manager || this.dataSource.manager;

    // 1. Any active reference immediately mandates retention
    const activeRefs = await this.countActiveReferences(fileId, undefined, em);
    if (activeRefs > 0) {
      return true;
    }

    // 2. Query all versions associated with stage attachments for this file (including soft-deleted attachments)
    const stageVersions = await em
      .createQueryBuilder(ProductionTemplateStageAttachmentEntity, 'att')
      .withDeleted()
      .innerJoin('production_template_stage', 's', 's.id = att.stage_id')
      .innerJoin('production_template_version', 'v', 'v.id = s.version_id AND v.deleted_at IS NULL')
      .select('v.id', 'versionId')
      .addSelect('v.template_id', 'templateId')
      .addSelect('v.version', 'version')
      .where('att.file_id = :fileId', { fileId })
      .getRawMany<{ versionId: string; templateId: string; version: string }>();

    // 3. Query all versions associated with task attachments for this file
    const taskVersions = await em
      .createQueryBuilder(ProductionTemplatePatternOptionTaskAttachmentEntity, 'att')
      .withDeleted()
      .innerJoin('production_template_pattern_option_task', 't', 't.id = att.task_id')
      .innerJoin('production_template_pattern_option', 'o', 'o.id = t.option_id')
      .innerJoin('production_template_pattern', 'p', 'p.id = o.pattern_id')
      .innerJoin('production_template_version', 'v', 'v.id = p.version_id AND v.deleted_at IS NULL')
      .select('v.id', 'versionId')
      .addSelect('v.template_id', 'templateId')
      .addSelect('v.version', 'version')
      .where('att.file_id = :fileId', { fileId })
      .getRawMany<{ versionId: string; templateId: string; version: string }>();

    const allVersionRefs = [...stageVersions, ...taskVersions];
    if (allVersionRefs.length === 0) {
      return false;
    }

    const versionRepo = em.getRepository(ProductionTemplateVersionEntity);
    const orderLineRepo = em.getRepository(ProductionOrderLineEntity);

    for (const vRef of allVersionRefs) {
      // Check if pinned by production order line
      const lineCount = await orderLineRepo.count({
        where: {
          templateVersionId: vRef.versionId,
        },
      });
      if (lineCount > 0) {
        return true;
      }

      // Check if this version is a historical version (i.e. superseded by a newer version)
      const templateVersions = await versionRepo.find({
        where: { templateId: vRef.templateId },
        order: { createdAt: 'DESC' },
      });

      if (templateVersions.length > 1) {
        const sorted = templateVersions.sort((a, b) => compareVersions(b.version, a.version));
        const latest = sorted[0];
        // If vRef is not the latest version, it is a historical version and must be retained
        if (vRef.versionId !== latest.id) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Unified pipeline for executing a cleanup task atomically.
   * Enforces pessimistic lock order (StoredFile -> CleanupQueue),
   * obtains an exclusive lease (PROCESSING + claimId), unlinks via storage service,
   * and finalizes state to COMPLETED or FAILED.
   *
   * Physical deletion is at-least-once and idempotent; claimId fences database state
   * transitions, while immutable storage identity prevents unsafe deletion of another file.
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
          if (await this.hasRetentionReferences(file.id, manager)) {
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
          task.claimExpiresAt = null;
          await cleanupRepo.save(task);
          return;
        }

        // Conservative policy: check retention references across historical versions
        const hasRetention = await this.hasRetentionReferences(file.id, manager);
        if (hasRetention) {
          task.status = FileCleanupStatus.COMPLETED;
          task.lastError = 'File is required by historical template version retention; cleanup cancelled';
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

    // Optional test hook: barrier before pre-unlink check (e.g. Test A-T1b)
    if (this._testPreUnlinkBarrier) {
      await this._testPreUnlinkBarrier();
    }

    // Step 5.5: Pre-unlink check: verify task is still PROCESSING, claimId still matches, and file is not re-referenced
    const preCheckOk = await this.dataSource.transaction(async (manager) => {
      const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);
      const fileRepo = manager.getRepository(ProductionTemplateStoredFileEntity);
      const currentTask = await cleanupRepo.findOne({
        where: { id: cleanupId },
      });
      if (!currentTask || currentTask.status !== FileCleanupStatus.PROCESSING || currentTask.claimId !== claimId) {
        return false;
      }
      const file = await fileRepo.findOne({
        where: { id: currentTask.fileId },
        withDeleted: true,
      });
      if (!file || !file.deletedAt) {
        return false;
      }
      const refCount = await this.countActiveReferences(file.id, undefined, manager);
      if (refCount > 0) {
        return false;
      }
      if (await this.hasRetentionReferences(file.id, manager)) {
        return false;
      }
      return true;
    });

    if (!preCheckOk) {
      logger.warn(`Cleanup pre-check failed for task ${cleanupId}; worker lost claim or file was re-referenced`);
      return false;
    }

    // Step 6: Physical Deletion outside MySQL transaction using storage service.
    // Physical deletion is at-least-once and idempotent; claimId fences database state transitions,
    // while immutable storage identity prevents unsafe deletion of another file.
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
    let finalized = false;
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
          logger.warn(`Cleanup claim for task ${cleanupId} was lost during processing; ignoring old worker results`);
          return;
        }

        if (unlinkSuccess) {
          task.status = FileCleanupStatus.COMPLETED;
          task.attempts += 1;
          task.lastError = null;
          task.claimExpiresAt = null;
          task.nextRetryAt = null;
          await cleanupRepo.save(task);
          finalized = true;
        } else {
          task.status = FileCleanupStatus.FAILED;
          task.attempts += 1;
          task.lastError = unlinkError;
          task.claimId = null;
          task.claimExpiresAt = null;
          task.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);
          await cleanupRepo.save(task);
          finalized = true;
        }
      });
    } catch (finalizeErr) {
      logger.error(`Error finalizing cleanup task ${cleanupId}:`, finalizeErr);
      return false;
    }

    return unlinkSuccess && finalized;
  }

  /**
   * Safely marks physical file for cleanup ONLY IF no active references exist across any versions.
   * Locks the StoredFile row, sets deletedAt, creates or reuses an existing PENDING/FAILED CleanupQueue row,
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
          where: { id: fileId },
          withDeleted: true,
          lock: { mode: 'pessimistic_write' },
        });
        if (!file) {
          return;
        }

        const refCount = await this.countActiveReferences(fileId, undefined, manager);
        if (refCount > 0) {
          return;
        }

        const hasRetention = await this.hasRetentionReferences(fileId, manager);
        if (hasRetention) {
          return;
        }

        // Put file in non-reusable state
        if (!file.deletedAt) {
          file.deletedAt = new Date();
          await fileRepo.save(file);
        }

        const cleanupRepo = manager.getRepository(ProductionTemplateFileCleanupQueueEntity);

        // Check if an existing cleanup task already exists (PENDING, PROCESSING, or FAILED) to prevent duplicates
        let queueItem = await cleanupRepo.findOne({
          where: {
            fileId,
            status: In([FileCleanupStatus.PENDING, FileCleanupStatus.PROCESSING, FileCleanupStatus.FAILED]),
          },
          order: { createdAt: 'DESC' },
        });

        if (queueItem) {
          // If task was FAILED, reschedule it without losing attempt history
          if (queueItem.status === FileCleanupStatus.FAILED) {
            queueItem.nextRetryAt = null;
            await cleanupRepo.save(queueItem);
          }
        } else {
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
   * forceRetry = true bypasses nextRetryAt backoff, but strictly respects
   * any active, unexpired lease held by another worker.
   */
  async retryFileCleanup(cleanupId: string): Promise<boolean> {
    return await this.executeCleanupTask(cleanupId, true);
  }

  /**
   * Processes a batch of due cleanup tasks (PENDING, FAILED with nextRetryAt <= NOW,
   * or PROCESSING with expired leases).
   * Note: This is designed to be executed periodically by an external scheduler or CLI command.
   */
  async processDueCleanupTasks(
    batchSize = 50
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    const now = new Date();
    const tasks = await this.cleanupRepo
      .createQueryBuilder('q')
      .where(
        new Brackets((qb) => {
          qb.where('q.status = :pending', { pending: FileCleanupStatus.PENDING })
            .orWhere('q.status = :failed AND (q.nextRetryAt IS NULL OR q.nextRetryAt <= :now)', {
              failed: FileCleanupStatus.FAILED,
              now,
            })
            .orWhere('q.status = :processing AND q.claimExpiresAt <= :now', {
              processing: FileCleanupStatus.PROCESSING,
              now,
            });
        })
      )
      .orderBy('q.createdAt', 'ASC')
      .limit(batchSize)
      .getMany();

    let succeeded = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        const result = await this.executeCleanupTask(task.id, false);
        if (result) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (err) {
        logger.error(`Error processing cleanup task ${task.id} in batch:`, err);
        failed++;
      }
    }

    return {
      processed: tasks.length,
      succeeded,
      failed,
    };
  }
}

export const productionTemplateSharedFileService = new ProductionTemplateSharedFileService();
