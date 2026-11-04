import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { logger } from '../../../common/logging/logger.js';

export const ATTACHMENT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

export const ALLOWED_MIME_EXTENSIONS_MAP: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export class ProductionTemplateReferenceFileStorageService {
  private readonly storageRoot: string;

  constructor(customStorageRoot?: string) {
    this.storageRoot = path.resolve(
      process.cwd(),
      customStorageRoot || process.env.FILE_STORAGE_ROOT || 'storage/template-stage-attachments'
    );
    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
  }

  /**
   * Helper to ensure a resolved path is strictly inside storageRoot using path.relative.
   */
  private assertPathWithinStorageRoot(targetPath: string, errorCode: string): void {
    const rel = path.relative(this.storageRoot, targetPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BusinessRuleError('مسار الملف خارج نطاق التخزين المسموح', errorCode);
    }
  }

  /**
   * Cleans up a temporary file (e.g. Multer upload) safely with error logging.
   */
  async cleanupTemporaryFile(filePath?: string): Promise<void> {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err: any) {
      logger.error(`Failed to cleanup temporary upload file: ${filePath}`, { error: err?.message });
    }
  }

  /**
   * Deletes a stored file physically from final storage with error logging.
   * Treats already absent files (ENOENT) safely as completed, but throws on permission (EACCES) or I/O errors.
   */
  async deleteStoredFile(storageKey: string): Promise<{ wasDeleted: boolean; wasMissing: boolean }> {
    const p = this.resolveAbsolutePath(storageKey);
    if (!fs.existsSync(p)) {
      logger.info(`Physical file already absent at key ${storageKey}`, { path: p });
      return { wasDeleted: false, wasMissing: true };
    }

    try {
      await fs.promises.unlink(p);
      return { wasDeleted: true, wasMissing: false };
    } catch (unlinkErr: any) {
      if (unlinkErr?.code === 'ENOENT') {
        logger.info(`Physical file vanished before unlink at key ${storageKey}`, { path: p });
        return { wasDeleted: false, wasMissing: true };
      }
      logger.error(`Failed to delete stored file with key ${storageKey}`, { error: unlinkErr?.message });
      throw unlinkErr;
    }
  }

  /**
   * Backward-compatible alias for deleteStoredFile.
   */
  async deleteFile(storageKey: string): Promise<{ wasDeleted: boolean; wasMissing: boolean }> {
    return this.deleteStoredFile(storageKey);
  }

  /**
   * Validates file buffer/meta, verifies MIME/extension compatibility,
   * writes file under opaque safe path, and cleans up temporary upload file.
   *
   * @param categoryPrefix Trusted server category prefix (e.g. 'production-template-stage' or 'production-template-pattern-task')
   * @param ownerId Owner ID (stageId or taskId)
   * @param file Uploaded file object
   */
  async saveFileWithPrefix(
    categoryPrefix: string,
    ownerId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }
  ): Promise<{ storageKey: string; sizeBytes: number; mimeType: string }> {
    try {
      // 1. Validate file size
      if (file.size > ATTACHMENT_MAX_FILE_SIZE_BYTES) {
        throw new BusinessRuleError(
          `حجم الملف يتجاوز الحد الأقصى المسموح به وهو 20 ميغابايت`,
          'ATTACHMENT_FILE_TOO_LARGE'
        );
      }
      if (file.size <= 0) {
        throw new BusinessRuleError('الملف فارغ', 'ATTACHMENT_FILE_EMPTY');
      }

      // 2. Validate MIME type
      const mimeType = file.mimetype.toLowerCase();
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        throw new BusinessRuleError(
          'نوع الملف غير مدعوم. الأنواع المسموحة هي: PDF, PNG, JPG, WEBP',
          'ATTACHMENT_UNSUPPORTED_MIME_TYPE'
        );
      }

      // 3. Validate Extension
      const rawExt = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(rawExt)) {
        throw new BusinessRuleError(
          'امتداد الملف غير مدعوم. الامتدادات المسموحة هي: .pdf, .png, .jpg, .jpeg, .webp',
          'ATTACHMENT_UNSUPPORTED_EXTENSION'
        );
      }

      // 4. Validate MIME and Extension Compatibility
      const allowedExtsForMime = ALLOWED_MIME_EXTENSIONS_MAP[mimeType];
      if (!allowedExtsForMime || !allowedExtsForMime.includes(rawExt)) {
        throw new BusinessRuleError(
          'امتداد الملف لا يتطابق مع نوع المحتوى',
          'ATTACHMENT_MIME_EXTENSION_MISMATCH'
        );
      }

      // Sanitize extension (no traversal or invalid chars)
      const safeExt = rawExt.replace(/[^a-z0-9.]/gi, '');

      // 5. Generate opaque key: <categoryPrefix>/<ownerId>/<uuid><safeExt>
      const safePrefix = categoryPrefix.replace(/[^a-zA-Z0-9_-]/g, '');
      const safeOwnerId = ownerId.replace(/[^a-zA-Z0-9_-]/g, '');
      const fileId = crypto.randomUUID();
      const relativeKey = path.posix.join(
        safePrefix,
        safeOwnerId,
        `${fileId}${safeExt}`
      );

      const targetFullPath = path.resolve(this.storageRoot, relativeKey);
      this.assertPathWithinStorageRoot(targetFullPath, 'ATTACHMENT_INVALID_PATH');

      // Ensure parent dir exists
      const targetDir = path.dirname(targetFullPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // 6. Write file to final storage
      if (file.buffer) {
        await fs.promises.writeFile(targetFullPath, file.buffer);
      } else if (file.path) {
        await fs.promises.copyFile(file.path, targetFullPath);
      } else {
        throw new BusinessRuleError('محتوى الملف غير متوفر', 'ATTACHMENT_FILE_DATA_MISSING');
      }

      // Clean up multer temp file on success
      await this.cleanupTemporaryFile(file.path);

      return {
        storageKey: relativeKey,
        sizeBytes: file.size,
        mimeType,
      };
    } catch (error) {
      // Clean up multer temp file on any validation or write failure
      await this.cleanupTemporaryFile(file.path);
      throw error;
    }
  }

  /**
   * Resolves absolute path of an attachment file with strict path.relative traversal check.
   */
  resolveAbsolutePath(storageKey: string): string {
    if (!storageKey || typeof storageKey !== 'string' || storageKey.includes('..') || storageKey.includes('\0')) {
      throw new BusinessRuleError('مفتاح التخزين غير صالح', 'ATTACHMENT_INVALID_KEY');
    }

    const normalizedKey = storageKey.replace(/\\/g, '/').trim();
    const rootRel = path.relative(process.cwd(), this.storageRoot).replace(/\\/g, '/');
    let effectiveKey = normalizedKey;
    if (effectiveKey.startsWith(rootRel + '/')) {
      effectiveKey = effectiveKey.slice(rootRel.length + 1);
    }

    const resolved = path.resolve(this.storageRoot, effectiveKey);
    this.assertPathWithinStorageRoot(resolved, 'ATTACHMENT_PATH_TRAVERSAL');

    return resolved;
  }

  /**
   * Checks whether the file physically exists on disk.
   */
  fileExists(storageKey: string): boolean {
    try {
      const p = this.resolveAbsolutePath(storageKey);
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }
}

export const productionTemplateReferenceFileStorageService = new ProductionTemplateReferenceFileStorageService();
