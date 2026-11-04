import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AppDataSource } from '../src/database/data-source.js';
import { ProductionTemplateService } from '../src/modules/production/template/production-template.service.js';
import { ProductionTemplateEditingService } from '../src/modules/production/template-editing/production-template-editing.service.js';
import { ProductionTemplateVersionService } from '../src/modules/production/template-version/production-template-version.service.js';
import { ProductionTemplateGuardService } from '../src/modules/production/template/production-template-guard.service.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplateVersionEntity } from '../src/modules/production/template-version/production-template-version.entity.js';
import { ProductionTemplateStageEntity } from '../src/modules/production/template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../src/modules/production/template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplateStoredFileEntity } from '../src/modules/production/template-stored-file/production-template-stored-file.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { canonicalizeLineConfiguration, hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';

describe('Production Template Versioning & Atomic Editing Integration Suite', () => {
  let templateService: ProductionTemplateService;
  let editingService: ProductionTemplateEditingService;
  let versionService: ProductionTemplateVersionService;
  let guardService: ProductionTemplateGuardService;
  let testDepartmentId: string;

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    templateService = new ProductionTemplateService(AppDataSource);
    editingService = new ProductionTemplateEditingService(AppDataSource);
    versionService = new ProductionTemplateVersionService(AppDataSource);
    guardService = new ProductionTemplateGuardService(AppDataSource);

    // Ensure a test department exists
    const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);
    let dept = await deptRepo.findOne({ where: { isActive: true } });
    if (!dept) {
      dept = deptRepo.create({
        name: 'قسم الاختبارات الهندسية',
        code: 'TEST-DEPT',
        isActive: true,
      });
      dept = await deptRepo.save(dept);
    }
    testDepartmentId = dept.id;
  });

  after(async () => {
    // Keep connection intact for runner
  });

  // ------------------------------------------------------------------------
  // 1. Auto-Code Sequence & Initial 1.0 Version
  // ------------------------------------------------------------------------
  describe('1. Auto-Code Generation & Initial 1.0 Version', () => {
    it('creates template with auto-generated code PT-XXXXXX and initial 1.0 version in single transaction', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب اختبار النسخ والإصدارات',
        referenceNumber: 'REF-VER-01',
        description: 'قالب للتأكد من الإصدار الأولي',
        isActive: true,
      });

      assert.ok(created.id);
      assert.match(created.code, /^PT-\d{6}$/);

      // Verify initial version 1.0 was persisted in DB
      const versionRepo = AppDataSource.getRepository(ProductionTemplateVersionEntity);
      const versions = await versionRepo.find({ where: { templateId: created.id } });

      assert.strictEqual(versions.length, 1);
      assert.strictEqual(versions[0].version, '1.0');

      // Verify template detail returns version info
      const detail = await templateService.getTemplateById(created.id);
      assert.ok(detail.currentVersion);
      assert.strictEqual(detail.currentVersion.version, '1.0');
      assert.strictEqual(detail.currentVersion.isLatest, true);
      assert.strictEqual(detail.versions?.length, 1);
    });
  });

  // ------------------------------------------------------------------------
  // 2. Strict Version Immutability & Historical Protection
  // ------------------------------------------------------------------------
  describe('2. Version Immutability & Historical Protection', () => {
    it('blocks direct mutations on historical versions when a newer version exists', async () => {
      // 1. Create a template
      const created = await templateService.createTemplate({
        name: 'قالب الحماية التاريخية',
        isActive: true,
      });

      // 2. Add an initial stage in v1.0
      const v1 = await versionService.getLatestVersion(created.id);
      const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
      const stage1 = stageRepo.create({
        templateId: created.id,
        versionId: v1.id,
        departmentId: testDepartmentId,
        name: 'مرحلة قديمة v1',
        sortOrder: 1,
      });
      await stageRepo.save(stage1);

      // 3. Create v1.1
      await AppDataSource.transaction(async (manager) => {
        await versionService.createNextVersion(created.id, manager);
      });

      // Now v1 is historical! Mutating stage1 should fail closed
      await assert.rejects(
        async () => guardService.requireMutableStageBelongsToTemplate(created.id, stage1.id),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 3. Atomic Editing Sessions & Auto-Classification
  // ------------------------------------------------------------------------
  describe('3. Atomic Editing Sessions & Change Classification', () => {
    it('STRUCTURAL operation automatically forks next version (1.0 -> 1.1)', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحرير الذري الهيكلي',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);
      assert.strictEqual(v1.version, '1.0');

      // Commit session with ADD_STAGE (structural change)
      const commitRes = await editingService.commitEditingSession(created.id, {
        baseVersionId: v1.id,
        commitDecision: 'AUTO',
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 'temp-stage-1',
            payload: {
              name: 'مرحلة الصب الخرساني',
              departmentId: testDepartmentId,
              estimatedDurationMinutes: 60,
            },
          },
        ],
      });

      assert.strictEqual(commitRes.createdNewVersion, true);
      assert.strictEqual(commitRes.changeType, 'STRUCTURAL');
      assert.strictEqual(commitRes.targetVersionNumber, '1.1');
      assert.ok(commitRes.tempClientMap['temp-stage-1']);

      // Verify v1.1 has the stage and v1.0 remains untouched
      const detailV1 = await templateService.getTemplateById(created.id, v1.id);
      assert.strictEqual(detailV1.stages.length, 0);

      const detailV11 = await templateService.getTemplateById(created.id, commitRes.targetVersionId);
      assert.strictEqual(detailV11.stages.length, 1);
      assert.strictEqual(detailV11.stages[0].name, 'مرحلة الصب الخرساني');
    });

    it('MINOR operation with AUTO decision updates in-place on current version', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحرير الطفيف',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);

      // Commit session with ADD_SPEC (minor change)
      const commitRes = await editingService.commitEditingSession(created.id, {
        baseVersionId: v1.id,
        commitDecision: 'AUTO',
        operations: [
          {
            type: 'ADD_SPEC',
            payload: {
              name: 'العرض الإجمالي',
              value: '400',
              unit: 'cm',
            },
          },
        ],
      });

      assert.strictEqual(commitRes.createdNewVersion, false);
      assert.strictEqual(commitRes.changeType, 'MINOR');
      assert.strictEqual(commitRes.targetVersionNumber, '1.0');

      // Verify spec added to template
      const detail = await templateService.getTemplateById(created.id);
      assert.strictEqual(detail.specifications.length, 1);
      assert.strictEqual(detail.specifications[0].name, 'العرض الإجمالي');
    });

    it('rejects STRUCTURAL changes with OVERWRITE_CURRENT decision', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب فحص حظر التعديل المباشر',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);

      // Attempt structural change (ADD_STAGE) with OVERWRITE_CURRENT
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(created.id, {
            baseVersionId: v1.id,
            commitDecision: 'OVERWRITE_CURRENT',
            operations: [
              {
                type: 'ADD_STAGE',
                tempClientId: 'illegal-stage',
                payload: {
                  name: 'مرحلة غير مسموح بها',
                  departmentId: testDepartmentId,
                },
              },
            ],
          }),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STRUCTURAL_CHANGE_REQUIRES_NEW_VERSION');
          return true;
        }
      );
    });

    it('rejects modifying elements from another version or template (Strict Hierarchy)', async () => {
      const t1 = await templateService.createTemplate({ name: 'قالب 1', isActive: true });
      const t2 = await templateService.createTemplate({ name: 'قالب 2', isActive: true });

      const v1 = await versionService.getLatestVersion(t1.id);
      const v2 = await versionService.getLatestVersion(t2.id);

      // Add stage to template 2
      const resT2 = await editingService.commitEditingSession(t2.id, {
        baseVersionId: v2.id,
        commitDecision: 'AUTO',
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 't2-stage',
            payload: { name: 'مرحلة قالب 2', departmentId: testDepartmentId },
          },
        ],
      });
      const t2StageId = resT2.tempClientMap['t2-stage'];

      // Attempt to delete t2's stage within t1's editing session
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(t1.id, {
            baseVersionId: v1.id,
            commitDecision: 'AUTO',
            operations: [
              {
                type: 'DELETE_STAGE',
                targetId: t2StageId,
              },
            ],
          }),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STAGE_NOT_FOUND');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 4. Shared File Storage & Attachment Integrity
  // ------------------------------------------------------------------------
  describe('4. Shared File Storage & Attachment Cloner Integrity', () => {
    it('cloning a version shares stored files and avoids duplicate file entries or storageKey conflicts', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب المرفقات المشتركة',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);

      // 1. Add a stage with an attachment (structural change forks to v1.1)
      const v1Fork = await editingService.commitEditingSession(created.id, {
        baseVersionId: v1.id,
        commitDecision: 'AUTO',
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 'stage-with-att',
            payload: {
              name: 'مرحلة التصميم',
              departmentId: testDepartmentId,
            },
          },
          {
            type: 'ADD_STAGE_ATTACHMENT',
            parentId: 'stage-with-att',
            payload: {
              storageKey: `uploads/test-template-${created.id}-drawing.pdf`,
              originalFileName: 'blueprint.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1048576,
            },
          },
        ],
      });

      assert.strictEqual(v1Fork.createdNewVersion, true);
      assert.strictEqual(v1Fork.targetVersionNumber, '1.1');

      // Verify stored file record created
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const storedFiles = await storedFileRepo.find({ where: { templateId: created.id } });
      assert.strictEqual(storedFiles.length, 1);
      const storedFileId = storedFiles[0].id;

      // 2. Now commit another structural change to fork v1.2
      const forkRes = await editingService.commitEditingSession(created.id, {
        baseVersionId: v1Fork.targetVersionId,
        commitDecision: 'NEW_VERSION',
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 'stage-v2',
            payload: {
              name: 'مرحلة فحص الجودة الإضافية',
              departmentId: testDepartmentId,
            },
          },
        ],
      });

      assert.strictEqual(forkRes.createdNewVersion, true);
      assert.strictEqual(forkRes.targetVersionNumber, '1.2');

      // Verify stored file was NOT duplicated (still exactly 1 stored file for this storageKey)
      const storedFilesAfter = await storedFileRepo.find({ where: { templateId: created.id } });
      assert.strictEqual(storedFilesAfter.length, 1);

      // Verify both v1.0 and v1.1 stages reference the exact same file_id
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const allAttachments = await stageAttRepo.find({
        where: { storageKey: `uploads/test-template-${created.id}-drawing.pdf` },
      });

      // Must have 2 attachment rows (one in v1.0 and one cloned in v1.1)
      assert.strictEqual(allAttachments.length, 2);
      assert.strictEqual(allAttachments[0].fileId, storedFileId);
      assert.strictEqual(allAttachments[1].fileId, storedFileId);
    });
  });

  // ------------------------------------------------------------------------
  // 5. Version Sorting & Reuse Prevention
  // ------------------------------------------------------------------------
  describe('5. Numerical Version Sorting & Reuse Prevention', () => {
    it('sorts versions numerically (1.10 > 1.9) and never reuses deleted version numbers', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحقق من الترقيم',
        isActive: true,
      });

      const versionRepo = AppDataSource.getRepository(ProductionTemplateVersionEntity);

      // Insert versions 1.0, 1.9, 1.10
      await versionRepo.save([
        versionRepo.create({ templateId: created.id, version: '1.9' }),
        versionRepo.create({ templateId: created.id, version: '1.10' }),
      ]);

      const sorted = await versionService.getSortedActiveVersions(created.id);
      assert.strictEqual(sorted[0].version, '1.10');
      assert.strictEqual(sorted[1].version, '1.9');
      assert.strictEqual(sorted[2].version, '1.0');

      // Next version must be 1.11
      const nextVer = await AppDataSource.transaction(async (manager) => {
        return await versionService.createNextVersion(created.id, manager);
      });
      assert.strictEqual(nextVer.version, '1.11');

      // Soft delete 1.11
      await versionRepo.softDelete(nextVer.id);

      // createNextVersion again: must NOT reuse 1.11, must produce 1.12!
      const nextAfterDelete = await AppDataSource.transaction(async (manager) => {
        return await versionService.createNextVersion(created.id, manager);
      });
      assert.strictEqual(nextAfterDelete.version, '1.12');
    });
  });

  // ------------------------------------------------------------------------
  // 6. Production Order Line Configuration Hash & Version Pinning
  // ------------------------------------------------------------------------
  describe('6. Production Order Line Version Pinning & Configuration Hash', () => {
    it('canonicalizeLineConfiguration produces deterministic hashes with backward compatibility', () => {
      const templateId = 'tmpl-uuid-1';
      const selections = [
        { templatePatternId: 'pat-b', selectedOptionId: 'opt-2' },
        { templatePatternId: 'pat-a', selectedOptionId: 'opt-1' },
      ];

      // Legacy format (no versionId)
      const legacyCanon = canonicalizeLineConfiguration(templateId, selections);
      assert.strictEqual(legacyCanon, 'tmpl-uuid-1|pat-a:opt-1|pat-b:opt-2');

      const legacyHash = hashLineConfiguration(templateId, selections);
      assert.strictEqual(legacyHash.length, 64);

      // Versioned format
      const versionId = 'ver-uuid-1';
      const versionedCanon = canonicalizeLineConfiguration(templateId, selections, versionId);
      assert.strictEqual(versionedCanon, 'ver-uuid-1:tmpl-uuid-1|pat-a:opt-1|pat-b:opt-2');

      const versionedHash = hashLineConfiguration(templateId, selections, versionId);
      assert.strictEqual(versionedHash.length, 64);
      assert.notStrictEqual(legacyHash, versionedHash);
    });
  });
});
