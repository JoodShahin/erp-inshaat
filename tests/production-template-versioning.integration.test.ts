import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { ProductionTemplateService } from '../src/modules/production/template/production-template.service.js';
import { ProductionTemplateEditingService } from '../src/modules/production/template-editing/production-template-editing.service.js';
import { ProductionTemplateVersionService } from '../src/modules/production/template-version/production-template-version.service.js';
import { ProductionTemplateGuardService } from '../src/modules/production/template/production-template-guard.service.js';
import { ProductionTemplateSharedFileService } from '../src/modules/production/template/production-template-shared-file.service.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplateVersionEntity } from '../src/modules/production/template-version/production-template-version.entity.js';
import { ProductionTemplateStageEntity } from '../src/modules/production/template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../src/modules/production/template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternEntity } from '../src/modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../src/modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../src/modules/production/template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../src/modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../src/modules/production/template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../src/modules/production/template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplateStoredFileEntity } from '../src/modules/production/template-stored-file/production-template-stored-file.entity.js';
import { ProductionTemplateUploadTokenEntity } from '../src/modules/production/template-editing/production-template-upload-token.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderStatus, ProductionOrderPriority } from '../src/modules/production/order/production-order.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { ProductionTemplateFileCleanupQueueEntity, FileCleanupStatus } from '../src/modules/production/template-stored-file/production-template-file-cleanup-queue.entity.js';
import { ProductionTemplateEditingIdempotencyEntity } from '../src/modules/production/template-editing/production-template-editing-idempotency.entity.js';
import { productionTemplateApiRouter } from '../src/modules/production/template/production-template.route.js';
import { productionTemplateReferenceFileStorageService } from '../src/modules/production/template/production-template-reference-file-storage.service.js';
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
import { canonicalizeLineConfiguration, hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';

describe('Production Template Versioning & Atomic Editing Integration Suite', () => {
  let templateService: ProductionTemplateService;
  let editingService: ProductionTemplateEditingService;
  let versionService: ProductionTemplateVersionService;
  let guardService: ProductionTemplateGuardService;
  let sharedFileService: ProductionTemplateSharedFileService;
  let testDepartmentId: string;
  let testUserId: string;
  let otherUserId: string;

  async function getRevision(templateId: string, versionId: string): Promise<string> {
    return await versionService.computeVersionRevision(templateId, versionId);
  }

  async function createTestUploadToken(
    templateId: string,
    userId: string,
    filename = 'test-doc.pdf',
    createPhysical = true
  ): Promise<string> {
    const tokenRepo = AppDataSource.getRepository(ProductionTemplateUploadTokenEntity);
    const uploadsDir = path.resolve(process.cwd(), 'storage/test-uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, `${Date.now()}-${crypto.randomUUID()}-${filename}`);
    if (createPhysical) {
      fs.writeFileSync(filePath, 'dummy content for test attachment');
    }

    const token = tokenRepo.create({
      id: crypto.randomUUID(),
      templateId,
      userId,
      storageKey: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
      originalFileName: filename,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      isUsed: false,
    });
    await tokenRepo.save(token);
    return token.id;
  }

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    templateService = new ProductionTemplateService(AppDataSource);
    editingService = new ProductionTemplateEditingService(AppDataSource);
    versionService = new ProductionTemplateVersionService(AppDataSource);
    guardService = new ProductionTemplateGuardService(AppDataSource);
    sharedFileService = new ProductionTemplateSharedFileService(AppDataSource);

    // Ensure a test department exists
    const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);
    let dept = await deptRepo.findOne({ where: { isActive: true } });
    if (!dept) {
      dept = deptRepo.create({
        name: 'قسم الاختبارات الهندسية',
        code: 'TEST-DEPT-' + Date.now(),
        isActive: true,
      });
      dept = await deptRepo.save(dept);
    }
    testDepartmentId = dept.id;

    const userRepo = AppDataSource.getRepository(UserEntity);
    const existingUsers = await userRepo.find({ take: 2 });
    if (existingUsers.length > 0) {
      testUserId = existingUsers[0].id;
    }
    if (existingUsers.length > 1) {
      otherUserId = existingUsers[1].id;
    } else {
      const u2 = userRepo.create({
        fullName: 'المستخدم الإضافي',
        phone: '9665' + Math.floor(10000000 + Math.random() * 90000000),
        passwordHash: 'dummy',
        roleId: existingUsers[0].roleId,
        isActive: true,
      });
      const savedU2 = await userRepo.save(u2);
      otherUserId = savedU2.id;
    }
  });

  after(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
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

      // Verify version 1.0 exists in database
      const versions = await versionService.listVersions(created.id);
      assert.strictEqual(versions.length, 1);
      assert.strictEqual(versions[0].version, '1.0');
      assert.strictEqual(versions[0].isLatest, true);

      // Verify template detail returns active version summary
      const detail = await templateService.getTemplateById(created.id);
      assert.ok(detail.currentVersion);
      assert.strictEqual(detail.currentVersion.version, '1.0');
      assert.strictEqual(detail.currentVersion.isLatest, true);
      assert.strictEqual(typeof detail.currentVersion.revision, 'string');
      assert.strictEqual(detail.currentVersion.revision.length, 64);
    });
  });

  // ------------------------------------------------------------------------
  // 2. Strict Version Immutability & Historical Protection
  // ------------------------------------------------------------------------
  describe('2. Version Immutability & Historical Protection', () => {
    it('blocks direct mutations on historical versions when a newer version exists', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب الحماية التاريخية',
        isActive: true,
      });

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

      // Create v1.1
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
  // 3. Atomic Editing Sessions, Change Classification & Normalizer Cases
  // ------------------------------------------------------------------------
  describe('3. Atomic Editing Sessions & Semantic Normalizer', () => {
    it('STRUCTURAL operation automatically forks next version (1.0 -> 1.1)', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحرير الذري الهيكلي',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      const commitRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
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
        },
        testUserId
      );

      assert.strictEqual(commitRes.createdNewVersion, true);
      assert.strictEqual(commitRes.changeType, 'STRUCTURAL');
      assert.strictEqual(commitRes.targetVersionNumber, '1.1');
      assert.ok(commitRes.tempClientMap['temp-stage-1']);

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
      const rev = await getRevision(created.id, v1.id);

      const commitRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
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
        },
        testUserId
      );

      assert.strictEqual(commitRes.createdNewVersion, false);
      assert.strictEqual(commitRes.changeType, 'MINOR');
      assert.strictEqual(commitRes.targetVersionNumber, '1.0');

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
      const rev = await getRevision(created.id, v1.id);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
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
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STRUCTURAL_CHANGE_REQUIRES_NEW_VERSION');
          return true;
        }
      );
    });

    it('Normalizer Case A: cancels opposing add/delete of temporary stage resulting in NONE diff', async () => {
      const created = await templateService.createTemplate({ name: 'قالب فحص إلغاء التعديل', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      const res = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 'temp-stg',
              payload: { name: 'مرحلة مؤقتة', departmentId: testDepartmentId },
            },
            {
              type: 'DELETE_STAGE',
              targetId: 'temp-stg',
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(res.changeType, 'NONE');
      assert.strictEqual(res.createdNewVersion, false);
      assert.strictEqual(res.appliedOperationsCount, 0);
      assert.strictEqual(res.targetVersionNumber, '1.0');

      // Verify no stages created in database
      const detail = await templateService.getTemplateById(created.id, v1.id);
      assert.strictEqual(detail.stages.length, 0);
    });

    it('Normalizer Case B: mutate name A->B->A results in NONE diff without writing to DB', async () => {
      const created = await templateService.createTemplate({ name: 'قالب فحص استعادة البيانات', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // Create an initial spec
      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_SPEC',
              payload: { name: 'المقاومة', value: '350', unit: 'kg' },
            },
          ],
        },
        testUserId
      );

      const detail = await templateService.getTemplateById(created.id);
      const specId = detail.specifications[0].id;
      rev = await getRevision(created.id, v1.id);

      // Mutate from 350 to 400 and then back to 350 in same session
      const res = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'UPDATE_SPEC',
              targetId: specId,
              payload: { name: 'المقاومة', value: '400', unit: 'kg' },
            },
            {
              type: 'UPDATE_SPEC',
              targetId: specId,
              payload: { name: 'المقاومة', value: '350', unit: 'kg' },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(res.changeType, 'NONE');
      assert.strictEqual(res.createdNewVersion, false);
      assert.strictEqual(res.appliedOperationsCount, 0);
    });

    it('Normalizer Case C: add pattern + option + task and mutate task -> creates final state in one go', async () => {
      const created = await templateService.createTemplate({ name: 'قالب إضافة شجرة نهائية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      const res = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_PATTERN',
              tempClientId: 'pat-1',
              payload: { name: 'النمط أ' },
            },
            {
              type: 'ADD_OPTION',
              parentId: 'pat-1',
              tempClientId: 'opt-1',
              payload: { name: 'الخيار 1' },
            },
            {
              type: 'ADD_TASK',
              parentId: 'opt-1',
              tempClientId: 'tsk-1',
              payload: { name: 'المهمة المبدئية', departmentId: testDepartmentId },
            },
            {
              type: 'UPDATE_TASK',
              targetId: 'tsk-1',
              payload: { name: 'المهمة النهائية المعدلة' },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(res.createdNewVersion, true);
      assert.strictEqual(res.targetVersionNumber, '1.1');

      const detail = await templateService.getTemplateById(created.id, res.targetVersionId);
      assert.strictEqual(detail.patterns.length, 1);
      assert.strictEqual(detail.patterns[0].options.length, 1);
      assert.strictEqual(detail.patterns[0].options[0].tasks.length, 1);
      assert.strictEqual(detail.patterns[0].options[0].tasks[0].name, 'المهمة النهائية المعدلة');
    });

    it('Normalizer Case E: reorder workflow then revert -> cancels to NONE', async () => {
      const created = await templateService.createTemplate({ name: 'قالب فحص الترتيب', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // Create two stages
      const resInit = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's1',
              payload: { name: 'مرحلة 1', departmentId: testDepartmentId },
            },
            {
              type: 'ADD_STAGE',
              tempClientId: 's2',
              payload: { name: 'مرحلة 2', departmentId: testDepartmentId },
            },
          ],
        },
        testUserId
      );

      const stg1Id = resInit.tempClientMap['s1'];
      const stg2Id = resInit.tempClientMap['s2'];
      const vLatest = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, vLatest.id);

      // Reorder s2 before s1, then reorder s1 before s2 (back to original)
      const resRevert = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'REORDER_WORKFLOW',
              payload: {
                items: [
                  { type: 'STAGE', id: stg2Id },
                  { type: 'STAGE', id: stg1Id },
                ],
              },
            },
            {
              type: 'REORDER_WORKFLOW',
              payload: {
                items: [
                  { type: 'STAGE', id: stg1Id },
                  { type: 'STAGE', id: stg2Id },
                ],
              },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(resRevert.changeType, 'NONE');
      assert.strictEqual(resRevert.createdNewVersion, false);
      assert.strictEqual(resRevert.appliedOperationsCount, 0);
    });

    it('Fix 1: Workflow Reorder Persists Across Reload (C -> A -> B)', async () => {
      const created = await templateService.createTemplate({ name: 'قالب اختبار إعادة ترتيب سير العمل', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // 1. Initial setup: Stage A, Pattern B, Stage C
      const initRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 'stg-a', payload: { name: 'المرحلة A', departmentId: testDepartmentId } },
            { type: 'ADD_PATTERN', tempClientId: 'pat-b', payload: { name: 'النمط B' } },
            { type: 'ADD_OPTION', parentId: 'pat-b', tempClientId: 'opt-b', payload: { name: 'الخيار B1' } },
            { type: 'ADD_STAGE', tempClientId: 'stg-c', payload: { name: 'المرحلة C', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const targetVer = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, targetVer.id);

      const stgAId = initRes.tempClientMap['stg-a'];
      const patBId = initRes.tempClientMap['pat-b'];
      const stgCId = initRes.tempClientMap['stg-c'];

      // 2. Reorder to C -> A -> B using OVERWRITE_CURRENT
      const reorderRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: targetVer.id,
          baseRevision: rev,
          commitDecision: 'OVERWRITE_CURRENT',
          operations: [
            {
              type: 'REORDER_WORKFLOW',
              payload: {
                itemIds: [stgCId, stgAId, patBId],
              },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(reorderRes.createdNewVersion, false);
      assert.strictEqual(reorderRes.changeType, 'MINOR');

      // 3. Reload from database and verify order
      const detail = await templateService.getTemplateById(created.id, targetVer.id);
      assert.strictEqual(detail.workflowItems.length, 3);
      assert.strictEqual(detail.workflowItems[0].stageId, stgCId);
      assert.strictEqual(detail.workflowItems[0].sortOrder, 1);
      assert.strictEqual(detail.workflowItems[1].stageId, stgAId);
      assert.strictEqual(detail.workflowItems[1].sortOrder, 2);
      assert.strictEqual(detail.workflowItems[2].patternId, patBId);
      assert.strictEqual(detail.workflowItems[2].sortOrder, 3);
    });

    it('Fix 2: Pattern Options and Tasks Reorder Persists Across Reload', async () => {
      const created = await templateService.createTemplate({ name: 'قالب اختبار ترتيب الخيارات والمهام', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // Create Pattern with O1, O2, O3 and T1, T2, T3
      const initRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'pat-1', payload: { name: 'نمط الترتيب' } },
            { type: 'ADD_OPTION', parentId: 'pat-1', tempClientId: 'opt-1', payload: { name: 'خيار 1' } },
            { type: 'ADD_OPTION', parentId: 'pat-1', tempClientId: 'opt-2', payload: { name: 'خيار 2' } },
            { type: 'ADD_OPTION', parentId: 'pat-1', tempClientId: 'opt-3', payload: { name: 'خيار 3' } },
            { type: 'ADD_TASK', parentId: 'opt-1', tempClientId: 'tsk-1', payload: { name: 'مهمة 1', departmentId: testDepartmentId } },
            { type: 'ADD_TASK', parentId: 'opt-1', tempClientId: 'tsk-2', payload: { name: 'مهمة 2', departmentId: testDepartmentId } },
            { type: 'ADD_TASK', parentId: 'opt-1', tempClientId: 'tsk-3', payload: { name: 'مهمة 3', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const opt1Id = initRes.tempClientMap['opt-1'];
      const opt2Id = initRes.tempClientMap['opt-2'];
      const opt3Id = initRes.tempClientMap['opt-3'];
      const tsk1Id = initRes.tempClientMap['tsk-1'];
      const tsk2Id = initRes.tempClientMap['tsk-2'];
      const tsk3Id = initRes.tempClientMap['tsk-3'];

      const targetVer = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, targetVer.id);

      // Reorder options to opt-3 -> opt-1 -> opt-2 and tasks to tsk-3 -> tsk-1 -> tsk-2
      const reorderRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: targetVer.id,
          baseRevision: rev,
          commitDecision: 'OVERWRITE_CURRENT',
          operations: [
            {
              type: 'REORDER_PATTERN_OPTIONS',
              targetId: initRes.tempClientMap['pat-1'],
              payload: { optionIds: [opt3Id, opt1Id, opt2Id] },
            },
            {
              type: 'REORDER_OPTION_TASKS',
              targetId: opt1Id,
              payload: { taskIds: [tsk3Id, tsk1Id, tsk2Id] },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(reorderRes.createdNewVersion, false);
      assert.strictEqual(reorderRes.changeType, 'MINOR');

      // Reload and verify
      const detail = await templateService.getTemplateById(created.id, targetVer.id);
      const pattern = detail.patterns![0];
      assert.strictEqual(pattern.options[0].id, opt3Id);
      assert.strictEqual(pattern.options[0].sortOrder, 1);
      assert.strictEqual(pattern.options[1].id, opt1Id);
      assert.strictEqual(pattern.options[1].sortOrder, 2);
      assert.strictEqual(pattern.options[2].id, opt2Id);
      assert.strictEqual(pattern.options[2].sortOrder, 3);

      const opt1 = pattern.options.find((o) => o.id === opt1Id)!;
      assert.strictEqual(opt1.tasks[0].id, tsk3Id);
      assert.strictEqual(opt1.tasks[0].sortOrder, 1);
      assert.strictEqual(opt1.tasks[1].id, tsk1Id);
      assert.strictEqual(opt1.tasks[1].sortOrder, 2);
      assert.strictEqual(opt1.tasks[2].id, tsk2Id);
      assert.strictEqual(opt1.tasks[2].sortOrder, 3);
    });

    it('Fix 3: Estimated Cost Survives Normalization and Minor Cost Update Updates In-Place', async () => {
      const created = await templateService.createTemplate({ name: 'قالب اختبار التكلفة التقديرية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // Add stage with 1500 and task with 250
      const initRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 'stg-cost',
              payload: { name: 'مرحلة مكلفة', departmentId: testDepartmentId, estimatedCost: '1500' },
            },
            { type: 'ADD_PATTERN', tempClientId: 'pat-cost', payload: { name: 'نمط مكلف' } },
            { type: 'ADD_OPTION', parentId: 'pat-cost', tempClientId: 'opt-cost', payload: { name: 'خيار مكلف' } },
            {
              type: 'ADD_TASK',
              parentId: 'opt-cost',
              tempClientId: 'tsk-cost',
              payload: { name: 'مهمة مكلفة', departmentId: testDepartmentId, estimatedCost: '250' },
            },
          ],
        },
        testUserId
      );

      const targetVer = await versionService.getLatestVersion(created.id);
      let detail = await templateService.getTemplateById(created.id, targetVer.id);
      assert.strictEqual(Number(detail.stages[0].estimatedCost), 1500);
      assert.strictEqual(Number(detail.patterns![0].options[0].tasks[0].estimatedCost), 250);

      // Update cost only to 1800 and 300 using OVERWRITE_CURRENT
      rev = await getRevision(created.id, targetVer.id);
      const updateRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: targetVer.id,
          baseRevision: rev,
          commitDecision: 'OVERWRITE_CURRENT',
          operations: [
            {
              type: 'UPDATE_STAGE',
              targetId: initRes.tempClientMap['stg-cost'],
              payload: { estimatedCost: '1800' },
            },
            {
              type: 'UPDATE_TASK',
              targetId: initRes.tempClientMap['tsk-cost'],
              payload: { estimatedCost: '300' },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(updateRes.createdNewVersion, false);
      assert.strictEqual(updateRes.changeType, 'MINOR');

      detail = await templateService.getTemplateById(created.id, targetVer.id);
      assert.strictEqual(Number(detail.stages[0].estimatedCost), 1800);
      assert.strictEqual(Number(detail.patterns![0].options[0].tasks[0].estimatedCost), 300);

      // Decimal equality: updating from 1800 to 1800.00 results in NONE diff
      rev = await getRevision(created.id, targetVer.id);
      const noopRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: targetVer.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'UPDATE_STAGE',
              targetId: initRes.tempClientMap['stg-cost'],
              payload: { estimatedCost: '1800.00' },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(noopRes.changeType, 'NONE');
      assert.strictEqual(noopRes.appliedOperationsCount, 0);
    });

    it('Fix 5: Nested Temporary Elements Cancellation & Block Updating Deleted Elements', async () => {
      const created = await templateService.createTemplate({ name: 'قالب اختبار الإلغاء الشجري', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // Example 1: Add P -> O -> T, then delete P before save -> NONE
      const cancelRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط مؤقت' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار مؤقت' } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't1', payload: { name: 'مهمة مؤقتة', departmentId: testDepartmentId } },
            { type: 'DELETE_PATTERN', targetId: 'p1' },
          ],
        },
        testUserId
      );

      assert.strictEqual(cancelRes.changeType, 'NONE');
      assert.strictEqual(cancelRes.appliedOperationsCount, 0);

      // Example 2: Create a real option and task first
      const initRes = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p-real', payload: { name: 'النمط الحقيقي' } },
            { type: 'ADD_OPTION', parentId: 'p-real', tempClientId: 'o-real', payload: { name: 'الخيار الحقيقي' } },
            { type: 'ADD_TASK', parentId: 'o-real', tempClientId: 't-real', payload: { name: 'المهمة الحقيقية', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const targetVer = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, targetVer.id);
      const optId = initRes.tempClientMap['o-real'];
      const taskId = initRes.tempClientMap['t-real'];

      // Example 3: Delete option then try to update task under it in same session -> rejected!
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: targetVer.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                { type: 'DELETE_OPTION', targetId: optId },
                { type: 'UPDATE_TASK', targetId: taskId, payload: { name: 'محاولة تعديل مهمة ملغاة' } },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_PATTERN_OPTION_TASK_PARENT_DELETED');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 4. Concurrency & Revision Hardening
  // ------------------------------------------------------------------------
  describe('4. Mandatory Revision & Concurrency Hardening', () => {
    it('throws when baseRevision is missing or invalid', async () => {
      const created = await templateService.createTemplate({ name: 'قالب المراجعة الإلزامية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);

      // Missing baseRevision
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              commitDecision: 'AUTO',
              operations: [{ type: 'ADD_STAGE', tempClientId: 's', payload: { name: 's', departmentId: testDepartmentId } }],
            } as any,
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_REVISION_REQUIRED');
          return true;
        }
      );

      // Non-64 hex string baseRevision
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: 'invalid-not-sha256',
              commitDecision: 'AUTO',
              operations: [{ type: 'ADD_STAGE', tempClientId: 's', payload: { name: 's', departmentId: testDepartmentId } }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_REVISION_REQUIRED');
          return true;
        }
      );
    });

    it('Concurrency Conflict: throws when baseRevision is stale', async () => {
      const created = await templateService.createTemplate({ name: 'قالب تعارض المراجعة', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const staleRevision = '0000000000000000000000000000000000000000000000000000000000000000';

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: staleRevision,
              commitDecision: 'AUTO',
              operations: [{ type: 'ADD_STAGE', tempClientId: 's', payload: { name: 's', departmentId: testDepartmentId } }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_CONCURRENT_EDIT_CONFLICT');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 5. Idempotency Fingerprint & User Isolation
  // ------------------------------------------------------------------------
  describe('5. Idempotency Fingerprint & User Isolation', () => {
    it('duplicate commit with same key and matching request returns cached result', async () => {
      const created = await templateService.createTemplate({ name: 'قالب مفتاح التكرار المطابق', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const idempKey = 'idem-match-' + Date.now();

      const payload = {
        baseVersionId: v1.id,
        baseRevision: rev,
        idempotencyKey: idempKey,
        commitDecision: 'AUTO' as const,
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 'stg-idemp',
            payload: { name: 'مرحلة متكررة', departmentId: testDepartmentId },
          },
        ],
      };

      const firstRes = await editingService.commitEditingSession(created.id, payload, testUserId);
      assert.strictEqual(firstRes.createdNewVersion, true);

      // Re-send with identical payload
      const secondRes = await editingService.commitEditingSession(created.id, payload, testUserId);
      assert.deepStrictEqual(secondRes, firstRes);
    });

    it('rejects same idempotencyKey with different request payload (fingerprint mismatch)', async () => {
      const created = await templateService.createTemplate({ name: 'قالب تعارض محتوى التكرار', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const idempKey = 'idem-diff-' + Date.now();

      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          idempotencyKey: idempKey,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 'stg-1',
              payload: { name: 'طلب أولي', departmentId: testDepartmentId },
            },
          ],
        },
        testUserId
      );

      // Re-send same key with DIFFERENT payload
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              idempotencyKey: idempKey,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE',
                  tempClientId: 'stg-2',
                  payload: { name: 'طلب مختلف تماماً', departmentId: testDepartmentId },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
          return true;
        }
      );
    });

    it('rejects same idempotencyKey from a different user (user mismatch)', async () => {
      const created = await templateService.createTemplate({ name: 'قالب عزل مستخدمي التكرار', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const idempKey = 'idem-user-' + Date.now();

      const payload = {
        baseVersionId: v1.id,
        baseRevision: rev,
        idempotencyKey: idempKey,
        commitDecision: 'AUTO' as const,
        operations: [
          {
            type: 'ADD_STAGE',
            tempClientId: 'stg-u',
            payload: { name: 'طلب المستخدم الأول', departmentId: testDepartmentId },
          },
        ],
      };

      await editingService.commitEditingSession(created.id, payload, testUserId);

      // Attempt to retrieve using otherUserId
      await assert.rejects(
        async () => editingService.commitEditingSession(created.id, payload, otherUserId),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'IDEMPOTENCY_USER_MISMATCH');
          return true;
        }
      );
    });

    it('replays cached result even past 24 hours without re-executing', async () => {
      const created = await templateService.createTemplate({ name: 'قالب عدم انتهاء صلاحية التكرار', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const idempKey = 'idem-24h-' + Date.now();

      const payload = {
        baseVersionId: v1.id,
        baseRevision: rev,
        idempotencyKey: idempKey,
        commitDecision: 'AUTO' as const,
        operations: [
          {
            type: 'ADD_STAGE' as const,
            tempClientId: 'stg-old',
            payload: { name: 'طلب قديم', departmentId: testDepartmentId },
          },
        ],
      };

      const firstRes = await editingService.commitEditingSession(created.id, payload, testUserId);

      // Artificially age the idempotency record past 24 hours (e.g. 48 hours ago)
      const idempotencyRepo = AppDataSource.getRepository(ProductionTemplateEditingIdempotencyEntity);
      const record = await idempotencyRepo.findOneOrFail({ where: { templateId: created.id, idempotencyKey: idempKey } });
      record.createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await idempotencyRepo.save(record);

      // Second call must return the cached result instead of failing on revision mismatch or re-executing
      const replayRes = await editingService.commitEditingSession(created.id, payload, testUserId);
      assert.strictEqual(replayRes.targetVersionId, firstRes.targetVersionId);
      assert.strictEqual(replayRes.targetVersionNumber, firstRes.targetVersionNumber);
    });

    it('throws IDEMPOTENCY_RESPONSE_CORRUPTED when cached responseJson is corrupted', async () => {
      const created = await templateService.createTemplate({ name: 'قالب تلف استجابة التكرار', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const idempKey = 'idem-corrupt-' + Date.now();

      const payload = {
        baseVersionId: v1.id,
        baseRevision: rev,
        idempotencyKey: idempKey,
        commitDecision: 'AUTO' as const,
        operations: [
          {
            type: 'ADD_STAGE' as const,
            tempClientId: 'stg-corrupt',
            payload: { name: 'طلب سيتعرض للتلف', departmentId: testDepartmentId },
          },
        ],
      };

      await editingService.commitEditingSession(created.id, payload, testUserId);

      // Corrupt responseJson in database
      const idempotencyRepo = AppDataSource.getRepository(ProductionTemplateEditingIdempotencyEntity);
      const record = await idempotencyRepo.findOneOrFail({ where: { templateId: created.id, idempotencyKey: idempKey } });
      record.responseJson = 'INVALID_JSON{{{';
      await idempotencyRepo.save(record);

      await assert.rejects(
        async () => editingService.commitEditingSession(created.id, payload, testUserId),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'IDEMPOTENCY_RESPONSE_CORRUPTED');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 6. Attachment Input Security & Upload Token Lifecycle
  // ------------------------------------------------------------------------
  describe('6. Attachment Input Security & Upload Token Lifecycle', () => {
    it('rejects client-supplied storageKey with STORAGE_KEY_FORBIDDEN', async () => {
      const created = await templateService.createTemplate({ name: 'قالب رفض storageKey المباشر', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE',
                  tempClientId: 's1',
                  payload: { name: 'مرحلة بمرفق غير موثوق', departmentId: testDepartmentId },
                },
                {
                  type: 'ADD_STAGE_ATTACHMENT',
                  parentId: 's1',
                  payload: {
                    storageKey: 'arbitrary/path/to/server/file.pdf',
                  },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_ATTACHMENT_STORAGE_KEY_FORBIDDEN');
          return true;
        }
      );
    });

    it('consumes valid uploadToken and rejects token with missing physical file', async () => {
      const created = await templateService.createTemplate({ name: 'قالب الرموز والملفات الفيزيائية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      // Token pointing to non-existent physical file
      const missingFileTokenId = await createTestUploadToken(created.id, testUserId, 'ghost.pdf', false);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE',
                  tempClientId: 's-ghost',
                  payload: { name: 'مرحلة ملف وهمي', departmentId: testDepartmentId },
                },
                {
                  type: 'ADD_STAGE_ATTACHMENT',
                  parentId: 's-ghost',
                  payload: { uploadToken: missingFileTokenId },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_UPLOAD_PHYSICAL_FILE_MISSING');
          return true;
        }
      );
    });

    it('rejects uploadToken from another user or expired token', async () => {
      const created = await templateService.createTemplate({ name: 'قالب انتهاء صلاحية الرموز', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      // Token created by other user
      const otherUserToken = await createTestUploadToken(created.id, otherUserId, 'other.pdf', true);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE',
                  tempClientId: 's',
                  payload: { name: 'مرحلة', departmentId: testDepartmentId },
                },
                {
                  type: 'ADD_STAGE_ATTACHMENT',
                  parentId: 's',
                  payload: { uploadToken: otherUserToken },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_UPLOAD_TOKEN_UNAUTHORIZED');
          return true;
        }
      );
    });

    it('reusing existing file via fileId works under same template and rejects fileId from other template', async () => {
      const t1 = await templateService.createTemplate({ name: 'قالب 1 للملفات', isActive: true });
      const t2 = await templateService.createTemplate({ name: 'قالب 2 للملفات', isActive: true });

      const v1 = await versionService.getLatestVersion(t1.id);
      const rev1 = await getRevision(t1.id, v1.id);

      // Create a valid attachment in t1
      const tok1 = await createTestUploadToken(t1.id, testUserId, 'blueprint1.pdf', true);
      const resT1 = await editingService.commitEditingSession(
        t1.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev1,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's1',
              payload: { name: 'مرحلة ت1', departmentId: testDepartmentId },
            },
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: 's1',
              payload: { uploadToken: tok1 },
            },
          ],
        },
        testUserId
      );

      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const storedFile = await storedFileRepo.findOne({ where: { templateId: t1.id } });
      assert.ok(storedFile);

      // 1. Reusing storedFile.id under t1 works!
      const vLatestT1 = await versionService.getLatestVersion(t1.id);
      const revLatestT1 = await getRevision(t1.id, vLatestT1.id);
      const resReuse = await editingService.commitEditingSession(
        t1.id,
        {
          baseVersionId: vLatestT1.id,
          baseRevision: revLatestT1,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: resT1.tempClientMap['s1'],
              payload: { fileId: storedFile.id, description: 'إعادة استخدام الملف في نفس القالب' },
            },
          ],
        },
        testUserId
      );
      assert.strictEqual(resReuse.createdNewVersion, false);

      // 2. Attempting to reuse storedFile.id under t2 fails with UNAUTHORIZED
      const v2 = await versionService.getLatestVersion(t2.id);
      const rev2 = await getRevision(t2.id, v2.id);
      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            t2.id,
            {
              baseVersionId: v2.id,
              baseRevision: rev2,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE',
                  tempClientId: 's2',
                  payload: { name: 'مرحلة ت2', departmentId: testDepartmentId },
                },
                {
                  type: 'ADD_STAGE_ATTACHMENT',
                  parentId: 's2',
                  payload: { fileId: storedFile.id },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STORED_FILE_UNAUTHORIZED');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 7. Preview Endpoint Verification
  // ------------------------------------------------------------------------
  describe('7. Server Preview Endpoint', () => {
    it('returns classification, effectiveChangesCount, reasons without writing to database', async () => {
      const created = await templateService.createTemplate({ name: 'قالب فحص المعاينة', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      const previewRes = await editingService.previewEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's-preview',
              payload: { name: 'مرحلة المعاينة', departmentId: testDepartmentId },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(previewRes.classification, 'STRUCTURAL');
      assert.strictEqual(previewRes.effectiveChangesCount, 1);
      assert.strictEqual(previewRes.isNewVersionMandatory, true);
      assert.strictEqual(previewRes.allowsOverwrite, false);
      assert.strictEqual(previewRes.conflicts.length, 0);

      // Verify no changes were committed to database
      const detail = await templateService.getTemplateById(created.id, v1.id);
      assert.strictEqual(detail.stages.length, 0);
    });

    it('requires PRODUCTION_TEMPLATE_UPDATE permission on preview route', async () => {
      const previewLayer = (productionTemplateApiRouter as any).stack.find(
        (l: any) => l.route && l.route.path === '/:id/editing/preview' && l.route.methods.post
      );
      assert.ok(previewLayer, 'preview route layer must exist');

      const firstHandler = previewLayer.route.stack[0].handle;
      assert.ok(firstHandler, 'route stack first handler must exist');

      // Intercept authorizationService.hasPermission to inspect requested permission
      const authzModule = await import('../src/modules/system/authorization/authorization.service.js');
      const origHasPermission = authzModule.authorizationService.hasPermission;

      let verifiedPermission: string | null = null;
      authzModule.authorizationService.hasPermission = async (_user: any, perm: string) => {
        verifiedPermission = perm;
        return true;
      };

      try {
        let nextCalled = false;
        await firstHandler({ user: { id: testUserId } }, {}, (err?: any) => {
          if (!err) nextCalled = true;
        });
        assert.strictEqual(nextCalled, true);
        assert.strictEqual(verifiedPermission, SystemPermission.PRODUCTION_TEMPLATE_UPDATE);
      } finally {
        authzModule.authorizationService.hasPermission = origHasPermission;
      }
    });
  });

  // ------------------------------------------------------------------------
  // 8. Safe Shared File Cleanup Protocol
  // ------------------------------------------------------------------------
  describe('8. Safe Shared File Storage & Reference Cleanup', () => {
    it('unreferencing one attachment keeps physical file, unreferencing all deletes safely', async () => {
      const created = await templateService.createTemplate({ name: 'قالب تنظيف الملفات المشتركة', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      const tok = await createTestUploadToken(created.id, testUserId, 'cleanup-doc.pdf', true);
      const res = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's1',
              payload: { name: 'مرحلة التنظيف', departmentId: testDepartmentId },
            },
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: 's1',
              payload: { uploadToken: tok },
            },
          ],
        },
        testUserId
      );

      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const storedFile = await storedFileRepo.findOne({ where: { templateId: created.id } });
      assert.ok(storedFile);

      // Check active references
      const count1 = await sharedFileService.countActiveReferences(storedFile.id);
      assert.strictEqual(count1, 1);

      // Add a second reference to the same file
      const vLatest = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, vLatest.id);
      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: res.tempClientMap['s1'],
              payload: { fileId: storedFile.id },
            },
          ],
        },
        testUserId
      );

      const count2 = await sharedFileService.countActiveReferences(storedFile.id);
      assert.strictEqual(count2, 2);

      // Safe delete check: with 2 references, file is NOT deleted
      const deletedCheck = await sharedFileService.safeDeletePhysicalFileIfUnreferenced(
        storedFile.id,
        storedFile.storageKey
      );
      assert.strictEqual(deletedCheck, false);
    });

    // ------------------------------------------------------------------------
    // Test 1 — Pending cleanup prevents file reuse
    // ------------------------------------------------------------------------
    it('Test 1 — Pending cleanup prevents file reuse', async () => {
      const created = await templateService.createTemplate({ name: 'قالب منع إعادة استخدام ملف قيد التنظيف', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test1.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-1');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test1.pdf',
          storageKey,
          sha256: 'sha256-test-1',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PENDING,
          attempts: 0,
        }));

        // Attempt reuse via getOrCreateStoredFile -> must throw PRODUCTION_TEMPLATE_STORED_FILE_DELETED
        await assert.rejects(
          async () => {
            await sharedFileService.getOrCreateStoredFile({
              templateId: created.id,
              originalFilename: 'test1.pdf',
              storageKey,
              sha256: 'sha256-test-1',
              fileSize: 14,
              mimeType: 'application/pdf',
            });
          },
          (err: any) => {
            assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STORED_FILE_DELETED');
            return true;
          }
        );
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 2 — Failed cleanup prevents file reuse
    // ------------------------------------------------------------------------
    it('Test 2 — Failed cleanup prevents file reuse', async () => {
      const created = await templateService.createTemplate({ name: 'قالب منع إعادة استخدام ملف فاشل التنظيف', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test2.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-2');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test2.pdf',
          storageKey,
          sha256: 'sha256-test-2',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.FAILED,
          attempts: 1,
          lastError: 'Simulated prior failure',
        }));

        // Attempt reuse via getOrCreateStoredFile -> must throw PRODUCTION_TEMPLATE_STORED_FILE_DELETED
        await assert.rejects(
          async () => {
            await sharedFileService.getOrCreateStoredFile({
              templateId: created.id,
              originalFilename: 'test2.pdf',
              storageKey,
              sha256: 'sha256-test-2',
              fileSize: 14,
              mimeType: 'application/pdf',
            });
          },
          (err: any) => {
            assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STORED_FILE_DELETED');
            return true;
          }
        );
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 3 — Concurrent cleanup claims execute once
    // ------------------------------------------------------------------------
    it('Test 3 — Concurrent cleanup claims execute once', async () => {
      const created = await templateService.createTemplate({ name: 'قالب ادعاء التنظيف المتزامن', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test3.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-3');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test3.pdf',
          storageKey,
          sha256: 'sha256-test-3',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        const queueItem = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PENDING,
          attempts: 0,
        }));

        // Concurrently run retryFileCleanup on the exact same queueItem.id
        const [res1, res2] = await Promise.all([
          sharedFileService.retryFileCleanup(queueItem.id),
          sharedFileService.retryFileCleanup(queueItem.id),
        ]);

        // Exactly one worker must claim and succeed
        assert.strictEqual(Number(res1) + Number(res2), 1, 'Only one worker should claim and execute');

        const finalQueue = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(finalQueue.status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(finalQueue.attempts, 1);
        assert.ok(finalQueue.claimId, 'Winning claimId should be recorded');
        assert.strictEqual(fs.existsSync(fullPath), false, 'Physical file must be unlinked');
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 4 — Reuse and cleanup race
    // ------------------------------------------------------------------------
    it('Test 4 — Reuse and cleanup race', async () => {
      const created = await templateService.createTemplate({ name: 'قالب سباق إعادة الاستخدام والتنظيف', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test4.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-4');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test4.pdf',
          storageKey,
          sha256: 'sha256-test-4',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        const v1 = await versionService.getLatestVersion(created.id);
        const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
        const stage = await stageRepo.save(stageRepo.create({
          id: crypto.randomUUID(),
          templateId: created.id,
          versionId: v1.id,
          departmentId: testDepartmentId,
          name: 'مرحلة سباق الحذف',
          sortOrder: 1,
        }));

        // Concurrently attempt cleanup vs reuse via resolveAttachmentFile + attachment creation
        const cleanupPromise = sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id);
        const reusePromise = AppDataSource.transaction(async (manager) => {
          const resolved = await (editingService as any).resolveAttachmentFile(
            created.id,
            { fileId: stored.id },
            testUserId,
            manager
          );
          const att = manager.create(ProductionTemplateStageAttachmentEntity, {
            id: crypto.randomUUID(),
            stageId: stage.id,
            fileId: resolved.fileId,
            originalFilename: resolved.originalFileName,
            fileSize: resolved.sizeBytes,
            mimeType: resolved.mimeType,
          });
          return await manager.save(att);
        });

        const [cleanupResult, reuseResult] = await Promise.allSettled([cleanupPromise, reusePromise]);

        // Acceptable invariant:
        // Case A: Reuse won. Attachment created, cleanupResult is false (refCount >= 1), physical file intact.
        // Case B: Cleanup won. Stored file soft-deleted, reuse rejected with PRODUCTION_TEMPLATE_STORED_FILE_DELETED.
        if (reuseResult.status === 'fulfilled') {
          const refCount = await sharedFileService.countActiveReferences(stored.id);
          assert.ok(refCount >= 1, 'Active reference count must be >= 1');
          assert.strictEqual(fs.existsSync(fullPath), true, 'File must NOT be deleted when attachment wins');
          const freshStored = await storedFileRepo.findOneOrFail({ where: { id: stored.id } });
          assert.strictEqual(freshStored.deletedAt, null, 'Stored file must not be deleted');
        } else {
          assert.strictEqual((reuseResult.reason as any).code, 'PRODUCTION_TEMPLATE_STORED_FILE_DELETED');
          const finalStored = await storedFileRepo.findOne({ where: { id: stored.id }, withDeleted: true });
          assert.ok(finalStored?.deletedAt, 'Stored file must be soft deleted if cleanup won');
        }
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 5 — Cleanup retry after process failure
    // ------------------------------------------------------------------------
    it('Test 5 — Cleanup retry after process failure', async () => {
      const created = await templateService.createTemplate({ name: 'قالب إعادة محاولة التنظيف بعد الفشل', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test5.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-5');

      const originalDelete = productionTemplateReferenceFileStorageService.deleteStoredFile;
      let failOnce = true;
      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test5.pdf',
          storageKey,
          sha256: 'sha256-test-5',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        // Stub deleteStoredFile to simulate process/IO failure on first attempt
        productionTemplateReferenceFileStorageService.deleteStoredFile = async (key: string) => {
          if (failOnce) {
            failOnce = false;
            const err: any = new Error('EACCES: permission denied during unlink');
            err.code = 'EACCES';
            throw err;
          }
          return originalDelete.call(productionTemplateReferenceFileStorageService, key);
        };

        const deletedSuccessfully = await sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id);
        assert.strictEqual(deletedSuccessfully, false, 'First attempt must report failure due to simulated IO error');

        const queueEntry = await cleanupRepo.findOneOrFail({
          where: { fileId: stored.id },
          order: { createdAt: 'DESC' },
        });
        assert.strictEqual(queueEntry.status, FileCleanupStatus.FAILED);
        assert.strictEqual(queueEntry.attempts, 1);
        assert.ok(queueEntry.lastError?.includes('EACCES'));
        assert.strictEqual(fs.existsSync(fullPath), true, 'Physical file must remain when unlink fails');

        // Retry now that the transient failure is gone
        const retryResult = await sharedFileService.retryFileCleanup(queueEntry.id);
        assert.strictEqual(retryResult, true, 'Retry must succeed');

        const updatedQueue = await cleanupRepo.findOneOrFail({ where: { id: queueEntry.id } });
        assert.strictEqual(updatedQueue.status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(updatedQueue.attempts, 2);
        assert.strictEqual(fs.existsSync(fullPath), false, 'Physical file must be deleted after retry');
      } finally {
        productionTemplateReferenceFileStorageService.deleteStoredFile = originalDelete;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 6 — Cleanup cannot escape storage root
    // ------------------------------------------------------------------------
    it('Test 6 — Cleanup cannot escape storage root', async () => {
      const created = await templateService.createTemplate({ name: 'قالب منع الهروب من جذر التخزين', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const outsideFile = path.resolve(process.cwd(), `scratch/outside-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
      fs.writeFileSync(outsideFile, 'secret outside root content');

      try {
        const fileId = crypto.randomUUID();
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'outside.txt',
          storageKey: '../scratch/' + path.basename(outsideFile),
          sha256: 'sha256-test-6',
          fileSize: 20,
          mimeType: 'text/plain',
        }));

        const queueItem = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PENDING,
          attempts: 0,
        }));

        const res = await sharedFileService.retryFileCleanup(queueItem.id);
        assert.strictEqual(res, false, 'Cleanup must reject path traversal outside storage root');

        const updatedQueue = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(updatedQueue.status, FileCleanupStatus.FAILED);
        assert.ok(
          updatedQueue.lastError?.includes('ATTACHMENT_PATH_TRAVERSAL') ||
          updatedQueue.lastError?.includes('مسار الملف غير صالح') ||
          updatedQueue.lastError?.includes('outside allowed directory') ||
          updatedQueue.lastError?.includes('ATTACHMENT_INVALID_KEY')
        );
        assert.strictEqual(fs.existsSync(outsideFile), true, 'External file outside storage root must NOT be deleted');
      } finally {
        if (fs.existsSync(outsideFile)) fs.unlinkSync(outsideFile);
      }
    });

    // ------------------------------------------------------------------------
    // Test 7 — Duplicate cleanup scheduling
    // ------------------------------------------------------------------------
    it('Test 7 — Duplicate cleanup scheduling', async () => {
      const created = await templateService.createTemplate({ name: 'قالب منع تكرار مهام التنظيف', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test7.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-7');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test7.pdf',
          storageKey,
          sha256: 'sha256-test-7',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        // Concurrently invoke safeDeletePhysicalFileIfUnreferenced twice
        const [res1, res2] = await Promise.all([
          sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id),
          sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id),
        ]);

        // At least one executes or returns true, and only 1 queue entry should be created
        const queueEntries = await cleanupRepo.find({ where: { fileId: stored.id } });
        assert.strictEqual(queueEntries.length, 1, 'Only one queue entry must be created for the same file');
        assert.strictEqual(queueEntries[0].status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(fs.existsSync(fullPath), false, 'Physical file must be deleted');
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    // ------------------------------------------------------------------------
    // Test 8 — Historical attachment preservation
    // ------------------------------------------------------------------------
    it('Test 8 — Historical attachment preservation', async () => {
      const created = await templateService.createTemplate({ name: 'قالب حماية المرفقات التاريخية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      const tok = await createTestUploadToken(created.id, testUserId, 'historical-doc.pdf', true);
      const res = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's1',
              payload: { name: 'مرحلة تاريخية', departmentId: testDepartmentId },
            },
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: 's1',
              payload: { uploadToken: tok },
            },
          ],
        },
        testUserId
      );

      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const storedFile = await storedFileRepo.findOneOrFail({ where: { templateId: created.id } });
      const physicalPath = path.resolve(process.cwd(), storedFile.storageKey);
      assert.strictEqual(fs.existsSync(physicalPath), true);

      // Create version 1.1 by forking with a structural change
      const v1Current = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, v1Current.id);
      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1Current.id,
          baseRevision: rev,
          commitDecision: 'FORK',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's2',
              payload: { name: 'مرحلة ثانية لتفريغ إصدار جديد', departmentId: testDepartmentId },
            },
          ],
        },
        testUserId
      );

      const vLatest = await versionService.getLatestVersion(created.id);
      assert.notStrictEqual(vLatest.id, v1.id, 'New version should be created');

      // Both versions now reference the same storedFile
      const refCount2 = await sharedFileService.countActiveReferences(storedFile.id);
      assert.strictEqual(refCount2, 2);

      // Now soft-delete attachment in the newer version
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
      const vLatestStage = await stageRepo.findOneOrFail({ where: { templateId: created.id, versionId: vLatest.id, name: 'مرحلة تاريخية' } });
      await stageAttRepo.softDelete({ stageId: vLatestStage.id });

      // Trigger safe delete check
      const deletedCheck = await sharedFileService.safeDeletePhysicalFileIfUnreferenced(storedFile.id);
      assert.strictEqual(deletedCheck, false, 'File must NOT be deleted because v1 still references it');

      // Verify physical file remains intact and accessible for historical v1Current
      assert.strictEqual(fs.existsSync(physicalPath), true, 'Historical physical file must remain intact');
      const v1Stage = await stageRepo.findOneOrFail({ where: { templateId: created.id, versionId: v1Current.id, name: 'مرحلة تاريخية' } });
      const v1Att = await stageAttRepo.findOneOrFail({ where: { stageId: v1Stage.id } });
      assert.strictEqual(v1Att.deletedAt, null, 'Historical attachment must remain active');
    });

    // ------------------------------------------------------------------------
    // Test 9 — Cleanup lease recovery
    // ------------------------------------------------------------------------
    it('Test 9 — Cleanup lease recovery', async () => {
      const created = await templateService.createTemplate({ name: 'قالب استرداد عقد التنظيف المنتهي', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-test9.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-test-9');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFilename: 'test9.pdf',
          storageKey,
          sha256: 'sha256-test-9',
          fileSize: 14,
          mimeType: 'application/pdf',
        }));

        // Simulate a crashed worker with an expired lease
        const crashedClaimId = 'crashed-worker-uuid-123';
        const queueItem = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PROCESSING,
          claimId: crashedClaimId,
          claimedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
          claimExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // expired 5 minutes ago
          attempts: 1,
        }));

        // A new worker attempts to retry/execute the task
        const reclaimed = await sharedFileService.retryFileCleanup(queueItem.id);
        assert.strictEqual(reclaimed, true, 'Expired lease must be safely reclaimed by a new worker');

        const updatedQueue = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(updatedQueue.status, FileCleanupStatus.COMPLETED);
        assert.notStrictEqual(updatedQueue.claimId, crashedClaimId, 'Claim ID must be refreshed to the new worker');
        assert.strictEqual(updatedQueue.attempts, 2, 'Attempts counter must be incremented');
        assert.strictEqual(fs.existsSync(fullPath), false, 'Physical file must be unlinked');

        // Test non-expired lease cannot be stolen
        const unexpiredStorageKey = `storage/template-stage-attachments/${Date.now()}-test9-active.pdf`;
        const unexpiredPath = path.resolve(process.cwd(), unexpiredStorageKey);
        fs.writeFileSync(unexpiredPath, 'active-worker-data');

        const storedActive = await storedFileRepo.save(storedFileRepo.create({
          id: crypto.randomUUID(),
          templateId: created.id,
          originalFilename: 'active.pdf',
          storageKey: unexpiredStorageKey,
          sha256: 'sha256-test-9-active',
          fileSize: 18,
          mimeType: 'application/pdf',
        }));

        const activeQueue = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: storedActive.id,
          storageKey: storedActive.storageKey,
          status: FileCleanupStatus.PROCESSING,
          claimId: 'active-worker-uuid',
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // expires in 5 minutes
          attempts: 1,
        }));

        const stolen = await sharedFileService.retryFileCleanup(activeQueue.id);
        assert.strictEqual(stolen, false, 'Active unexpired lease MUST NOT be stolen by another worker');
        assert.strictEqual(fs.existsSync(unexpiredPath), true, 'File must remain untouched while worker is active');

        if (fs.existsSync(unexpiredPath)) fs.unlinkSync(unexpiredPath);
      } finally {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });
  });

  // ------------------------------------------------------------------------
  // 9. Production Order Line Compatibility & Logical Latest Versioning
  // ------------------------------------------------------------------------
  describe('9. Production Order Line Version Pinning & Logical Latest', () => {
    it('pins line to explicit templateVersionId and rejects invalid templateVersionId', async () => {
      const orderService = new ProductionOrderService(AppDataSource);
      const created = await templateService.createTemplate({ name: 'قالب فحص مذكرات الإنتاج', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);

      // Add pattern to v1
      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_PATTERN',
              tempClientId: 'pat-1',
              payload: { name: 'النمط 1' },
            },
            {
              type: 'ADD_OPTION',
              parentId: 'pat-1',
              tempClientId: 'opt-1',
              payload: { name: 'الخيار 1' },
            },
          ],
        },
        testUserId
      );

      const order = await orderService.createOrder(
        {
          orderNumber: 'ORD-PIN-' + Date.now(),
          status: ProductionOrderStatus.DRAFT,
          priority: ProductionOrderPriority.MEDIUM,
        },
        testUserId
      );

      // 1. Valid explicit templateVersionId
      const vLatest = await versionService.getLatestVersion(created.id);
      const line = await orderService.addLine(order.id, {
        templateId: created.id,
        templateVersionId: vLatest.id,
        quantity: 10,
      } as any);

      assert.strictEqual(line.templateVersionId, vLatest.id);

      // 2. Non-existent templateVersionId throws
      await assert.rejects(
        async () =>
          orderService.addLine(order.id, {
            templateId: created.id,
            templateVersionId: '00000000-0000-0000-0000-000000000000',
            quantity: 5,
          } as any),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_INVALID');
          return true;
        }
      );
    });
  });

  // ------------------------------------------------------------------------
  // 10. Numerical Version Sorting & Reuse Prevention
  // ------------------------------------------------------------------------
  describe('10. Numerical Version Sorting & Reuse Prevention', () => {
    it('sorts versions numerically (1.10 > 1.9) and never reuses deleted version numbers', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحقق من الترقيم العددي',
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
  // 11. Production Order Line Configuration Hash & Version Pinning
  // ------------------------------------------------------------------------
  describe('11. Production Order Line Configuration Hash & Version Pinning', () => {
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

  // ------------------------------------------------------------------------
  // 12. Composite Indexes Audit & Redundancy Prevention
  // ------------------------------------------------------------------------
  describe('12. Composite Indexes Audit & Redundancy Prevention', () => {
    it('verifies composite indexes exist and have no redundant duplicate column sets', async () => {
      const tablesToCheck = [
        'production_template',
        'production_template_version',
        'production_template_stage',
        'production_template_pattern',
        'production_template_workflow_item',
        'production_template_pattern_option',
        'production_template_pattern_option_task',
        'production_template_stage_attachment',
        'production_template_pattern_option_task_attachment',
        'production_template_upload_token',
        'production_order_line',
      ];

      for (const table of tablesToCheck) {
        const stats: any[] = await AppDataSource.query(
          `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
           FROM information_schema.STATISTICS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? 
           ORDER BY INDEX_NAME, SEQ_IN_INDEX ASC`,
          [table]
        );

        const indexMap: Record<string, string[]> = {};
        for (const row of stats) {
          if (!indexMap[row.INDEX_NAME]) {
            indexMap[row.INDEX_NAME] = [];
          }
          indexMap[row.INDEX_NAME].push(row.COLUMN_NAME.toLowerCase());
        }

        // Verify no two different indexes have the exact same list of columns
        const signatures = new Map<string, string>();
        for (const [idxName, cols] of Object.entries(indexMap)) {
          const sig = cols.join(',');
          if (signatures.has(sig)) {
            assert.fail(
              `Redundant index detected on table ${table}: ${idxName} has identical column signature (${sig}) as ${signatures.get(sig)}`
            );
          }
          signatures.set(sig, idxName);
        }
      }
    });
  });

  // ------------------------------------------------------------------------
  // 13. Comprehensive Template Lifecycle & Mutation Roundtrip Verification
  // ------------------------------------------------------------------------
  describe('13. Comprehensive Template Lifecycle & Mutation Roundtrip Verification', () => {
    it('creates complex template (2 stages, 2 patterns, options, tasks, costs, durations, materials, attachments) and mutates roundtrip accurately', async () => {
      // 1. Fetch valid product and unit for materials
      const prodRows: any[] = await AppDataSource.query(
        `SELECT p.id as productId, u.id as unitId 
         FROM inventory_product p 
         JOIN inventory_product_unit u ON u.product_id = p.id 
         WHERE p.deleted_at IS NULL AND p.is_active = 1 
         LIMIT 1`
      );
      assert.ok(prodRows.length > 0, 'Must have at least 1 product and unit for material testing');
      const { productId, unitId } = prodRows[0];

      // 2. Create base template
      const template = await templateService.createTemplate({
        name: 'قالب التحقق الشامل النهائي',
        description: 'وصف القالب الشامل',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);

      // Create physical upload tokens for attachments
      const stageToken = await createTestUploadToken(template.id, testUserId, 'stage-spec.pdf', true);
      const taskToken = await createTestUploadToken(template.id, testUserId, 'task-guide.pdf', true);

      // 3. Commit initial rich structure on Version 1.0
      const initialCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            // Stage 1
            {
              type: 'ADD_STAGE',
              tempClientId: 'stg-1',
              payload: {
                name: 'مرحلة الصب',
                departmentId: testDepartmentId,
                estimatedCost: '500.0000',
              },
            },
            // Stage 1 Material
            {
              type: 'ADD_STAGE_MATERIAL',
              parentId: 'stg-1',
              payload: {
                productId,
                productUnitId: unitId,
                plannedQuantity: '5.000000',
              },
            },
            // Stage 1 Attachment
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: 'stg-1',
              payload: {
                uploadToken: stageToken,
                title: 'مخطط الصب',
              },
            },
            // Stage 2
            {
              type: 'ADD_STAGE',
              tempClientId: 'stg-2',
              payload: {
                name: 'مرحلة التشطيب',
                departmentId: testDepartmentId,
                estimatedCost: '800.0000',
              },
            },
            // Pattern 1
            {
              type: 'ADD_PATTERN',
              tempClientId: 'pat-1',
              payload: { name: 'نمط العزل' },
            },
            // Pattern 1 Option 1
            {
              type: 'ADD_OPTION',
              parentId: 'pat-1',
              tempClientId: 'opt-1-1',
              payload: { name: 'عزل مائي' },
            },
            // Option 1 Task 1
            {
              type: 'ADD_TASK',
              parentId: 'opt-1-1',
              tempClientId: 'tsk-1-1-1',
              payload: {
                name: 'دهان البيتومين',
                departmentId: testDepartmentId,
                estimatedDurationValue: 150,
                estimatedDurationUnit: 'MINUTES',
                estimatedCost: '150.0000',
              },
            },
            // Task 1 Material
            {
              type: 'ADD_TASK_MATERIAL',
              parentId: 'tsk-1-1-1',
              payload: {
                productId,
                productUnitId: unitId,
                plannedQuantity: '10.000000',
              },
            },
            // Task 1 Attachment
            {
              type: 'ADD_TASK_ATTACHMENT',
              parentId: 'tsk-1-1-1',
              payload: {
                uploadToken: taskToken,
                title: 'كتالوج العزل',
              },
            },
            // Pattern 1 Option 2
            {
              type: 'ADD_OPTION',
              parentId: 'pat-1',
              tempClientId: 'opt-1-2',
              payload: { name: 'عزل حراري' },
            },
            // Option 2 Task 1
            {
              type: 'ADD_TASK',
              parentId: 'opt-1-2',
              tempClientId: 'tsk-1-2-1',
              payload: {
                name: 'تركيب ألواح الصوف الصخري',
                departmentId: testDepartmentId,
                estimatedDurationValue: 2,
                estimatedDurationUnit: 'DAYS',
                estimatedCost: '220.0000',
              },
            },
            // Pattern 2
            {
              type: 'ADD_PATTERN',
              tempClientId: 'pat-2',
              payload: { name: 'نمط التسليح' },
            },
            // Pattern 2 Option 1
            {
              type: 'ADD_OPTION',
              parentId: 'pat-2',
              tempClientId: 'opt-2-1',
              payload: { name: 'حديد 16 ملم' },
            },
          ],
        },
        testUserId
      );

      // Verify initial commit results (structural additions fork 1.0 -> 1.1)
      assert.strictEqual(initialCommit.createdNewVersion, true);
      assert.strictEqual(initialCommit.targetVersionNumber, '1.1');
      const stage1Id = initialCommit.tempClientMap['stg-1'];
      const stage2Id = initialCommit.tempClientMap['stg-2'];
      const pat1Id = initialCommit.tempClientMap['pat-1'];
      const opt11Id = initialCommit.tempClientMap['opt-1-1'];
      const opt12Id = initialCommit.tempClientMap['opt-1-2'];
      const tsk111Id = initialCommit.tempClientMap['tsk-1-1-1'];
      const pat2Id = initialCommit.tempClientMap['pat-2'];
      const opt21Id = initialCommit.tempClientMap['opt-2-1'];

      assert.ok(stage1Id && stage2Id && pat1Id && opt11Id && opt12Id && tsk111Id && pat2Id && opt21Id);

      // Check DB state for initial commit (under version 1.1)
      const initialDetail = await templateService.getTemplateById(template.id, initialCommit.targetVersionId);
      assert.strictEqual(initialDetail.stages.length, 2);
      assert.strictEqual(initialDetail.patterns.length, 2);
      assert.strictEqual(initialDetail.workflowItems.length, 4);

      // Find stage attachment to delete in next session
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const initialStageAtt = await stageAttRepo.findOneOrFail({ where: { stageId: stage1Id } });

      // 4. Execute Second Session: Mutations across the whole graph
      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            // Structural: Add task to Option 21
            {
              type: 'ADD_TASK',
              parentId: opt21Id,
              tempClientId: 'tsk-2-1-1',
              payload: {
                name: 'قص وثني الحديد',
                departmentId: testDepartmentId,
                estimatedDurationValue: 4,
                estimatedDurationUnit: 'HOURS',
                estimatedCost: '300.0000',
              },
            },
            // Add Task Material to new task
            {
              type: 'ADD_TASK_MATERIAL',
              parentId: 'tsk-2-1-1',
              payload: {
                productId,
                productUnitId: unitId,
                plannedQuantity: '2.500000',
              },
            },
            // Reorder Pattern 1 Options: opt-1-2 before opt-1-1
            {
              type: 'REORDER_PATTERN_OPTIONS',
              parentId: pat1Id,
              payload: {
                optionIds: [opt12Id, opt11Id],
              },
            },
            // Reorder Workflow Items: reverse order
            {
              type: 'REORDER_WORKFLOW',
              payload: {
                itemIds: [stage2Id, pat2Id, pat1Id, stage1Id],
              },
            },
            // Delete Stage 1 Attachment
            {
              type: 'DELETE_STAGE_ATTACHMENT',
              targetId: initialStageAtt.id,
            },
            // Add Template Specification
            {
              type: 'ADD_SPEC',
              payload: {
                name: 'مواصفة التحمل النهائي',
                value: '450 كجم/سم2',
                unit: 'كجم/سم2',
                sortOrder: 1,
              },
            },
          ],
        },
        testUserId
      );

      // Verify that structural additions triggered version fork to 1.2
      assert.strictEqual(secondCommit.createdNewVersion, true);
      assert.strictEqual(secondCommit.targetVersionNumber, '1.2');

      // 5. Item-by-item verification against actual database state in Version 1.2
      const finalDetail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);

      // Verify Stages
      assert.strictEqual(finalDetail.stages.length, 2);
      const finalStg1 = finalDetail.stages.find((s) => s.name === 'مرحلة الصب');
      const finalStg2 = finalDetail.stages.find((s) => s.name === 'مرحلة التشطيب');
      assert.ok(finalStg1 && finalStg2);
      assert.strictEqual(Number(finalStg1.estimatedCost), 500);
      assert.strictEqual(Number(finalStg2.estimatedCost), 800);

      // Verify Stage 1 Material is preserved
      const stageMatRepo = AppDataSource.getRepository(ProductionTemplateStageMaterialEntity);
      const stageMats = await stageMatRepo.find({ where: { stageId: finalStg1.id } });
      assert.strictEqual(stageMats.length, 1);
      assert.strictEqual(Number(stageMats[0].plannedQuantity), 5);

      // Verify Stage 1 Attachment was deleted in Version 1.1
      const stageAtts = await stageAttRepo.find({ where: { stageId: finalStg1.id } });
      assert.strictEqual(stageAtts.length, 0);

      // Verify Patterns & Options
      assert.strictEqual(finalDetail.patterns.length, 2);
      const finalPat1 = finalDetail.patterns.find((p) => p.name === 'نمط العزل')!;
      assert.strictEqual(finalPat1.options.length, 2);
      // Verify Option Reorder: opt-1-2 is now first (sort_order = 1), opt-1-1 is second (sort_order = 2)
      assert.strictEqual(finalPat1.options[0].name, 'عزل حراري');
      assert.strictEqual(finalPat1.options[0].sortOrder, 1);
      assert.strictEqual(finalPat1.options[1].name, 'عزل مائي');
      assert.strictEqual(finalPat1.options[1].sortOrder, 2);

      // Verify Pattern 2 & newly added Task
      const finalPat2 = finalDetail.patterns.find((p) => p.name === 'نمط التسليح')!;
      assert.strictEqual(finalPat2.options.length, 1);
      const finalOpt21 = finalPat2.options[0];
      assert.strictEqual(finalOpt21.tasks.length, 1);
      assert.strictEqual(finalOpt21.tasks[0].name, 'قص وثني الحديد');
      assert.strictEqual(finalOpt21.tasks[0].estimatedDurationMinutes, 240);
      assert.strictEqual(Number(finalOpt21.tasks[0].estimatedCost), 300);

      // Verify newly added Task Material
      const taskMatRepo = AppDataSource.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
      const taskMats = await taskMatRepo.find({ where: { taskId: finalOpt21.tasks[0].id } });
      assert.strictEqual(taskMats.length, 1);
      assert.strictEqual(Number(taskMats[0].plannedQuantity), 2.5);

      // Verify Workflow Items ordering and dense 1..N compaction
      const wfItems = finalDetail.workflowItems;
      assert.strictEqual(wfItems.length, 4);
      assert.strictEqual(wfItems[0].sortOrder, 1);
      assert.strictEqual(wfItems[1].sortOrder, 2);
      assert.strictEqual(wfItems[2].sortOrder, 3);
      assert.strictEqual(wfItems[3].sortOrder, 4);
      assert.strictEqual(wfItems[0].stage?.name, 'مرحلة التشطيب');
      assert.strictEqual(wfItems[1].pattern?.name, 'نمط التسليح');
      assert.strictEqual(wfItems[2].pattern?.name, 'نمط العزل');
      assert.strictEqual(wfItems[3].stage?.name, 'مرحلة الصب');

      // Verify Template Specification exists at template level
      const specs = finalDetail.specifications;
      assert.strictEqual(specs.length, 1);
      assert.strictEqual(specs[0].name, 'مواصفة التحمل النهائي');
      assert.strictEqual(specs[0].value, '450 كجم/سم2');
      assert.strictEqual(specs[0].unit, 'كجم/سم2');
    });
  });
});
