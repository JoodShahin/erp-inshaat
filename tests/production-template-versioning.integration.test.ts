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
import { ProductionTemplateStoredFileEntity } from '../src/modules/production/template-stored-file/production-template-stored-file.entity.js';
import { ProductionTemplateUploadTokenEntity } from '../src/modules/production/template-editing/production-template-upload-token.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderStatus, ProductionOrderPriority } from '../src/modules/production/order/production-order.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
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
});
