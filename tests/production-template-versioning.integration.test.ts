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
import { InventoryProductEntity } from '../src/modules/inventory/product/inventory-product.entity.js';
import { InventoryProductUnitEntity } from '../src/modules/inventory/product/inventory-product-unit.entity.js';
import { ProductionTemplateUploadTokenEntity } from '../src/modules/production/template-editing/production-template-upload-token.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderStatus, ProductionOrderPriority } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderEntity } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { ProductionTemplateFileCleanupQueueEntity, FileCleanupStatus } from '../src/modules/production/template-stored-file/production-template-file-cleanup-queue.entity.js';
import { ProductionTemplateEditingIdempotencyEntity } from '../src/modules/production/template-editing/production-template-editing-idempotency.entity.js';
import { productionTemplateApiRouter } from '../src/modules/production/template/production-template.route.js';
import { productionTemplateReferenceFileStorageService } from '../src/modules/production/template/production-template-reference-file-storage.service.js';
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
import { canonicalizeLineConfiguration, hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';
import {
  normalizeDecimal,
  areDecimalQuantitiesEqual,
  validateAndNormalizePlannedQuantity,
} from '../src/modules/production/template-editing/production-template-editing-normalizer.js';

describe('Production Template Versioning & Atomic Editing Integration Suite', () => {
  let templateService: ProductionTemplateService;
  let editingService: ProductionTemplateEditingService;
  let versionService: ProductionTemplateVersionService;
  let guardService: ProductionTemplateGuardService;
  let sharedFileService: ProductionTemplateSharedFileService;
  let testDepartmentId: string;
  let testUserId: string;
  let otherUserId: string;
  let materialTestProductId: string;

  // Create genuine production references for version-boundary tests.
  // A memorandum/order line alone must NOT freeze a template; only a room does.
  async function linkTemplateToRoom(templateId: string, createRoom = true): Promise<string | null> {
    const version = await versionService.getLatestVersion(templateId);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 18);
    const order = await AppDataSource.getRepository(ProductionOrderEntity).save({
      id: crypto.randomUUID(),
      orderNumber: 'IT-VER-' + suffix,
      status: ProductionOrderStatus.DRAFT,
      createdByUserId: testUserId,
    });
    const line = await AppDataSource.getRepository(ProductionOrderLineEntity).save({
      id: crypto.randomUUID(),
      orderId: order.id,
      templateId,
      templateVersionId: version.id,
      quantity: 1,
      sortOrder: 1,
      activeConfigurationHash: null,
    });
    if (!createRoom) return null;
    const template = await AppDataSource.getRepository(ProductionTemplateEntity).findOneByOrFail({ id: templateId });
    const plan = await AppDataSource.getRepository(ProductionExecutionPlanEntity).save({
      id: crypto.randomUUID(),
      orderId: order.id,
      orderLineId: line.id,
      templateId,
      templateName: template.name,
      templateCode: template.code,
      lineQuantity: 1,
      configurationHash: '1'.repeat(64),
    });
    const unit = await AppDataSource.getRepository(ProductionUnitEntity).save({
      id: crypto.randomUUID(),
      orderId: order.id,
      orderLineId: line.id,
      planId: plan.id,
      unitSequence: 1,
      unitNumber: 'IT-' + suffix,
      status: ProductionUnitStatus.CREATED,
    });
    return unit.id;
  }

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

    // The system seed does not populate the inventory catalog. Material tests must
    // provision their own valid FK targets, even on a freshly migrated database.
    const productRepo = AppDataSource.getRepository(InventoryProductEntity);
    const unitRepo = AppDataSource.getRepository(InventoryProductUnitEntity);
    const materialProduct = await productRepo.save(productRepo.create({
      id: crypto.randomUUID(),
      name: 'منتج مخصص لاختبارات مواد القوالب',
      code: 'IT-MAT-' + crypto.randomUUID().slice(0, 12),
      categoryId: null,
      baseUnitId: null,
      isActive: true,
    }));
    const materialUnit = await unitRepo.save(unitRepo.create({
      id: crypto.randomUUID(),
      productId: materialProduct.id,
      name: 'وحدة المواد الاختبارية',
      barcode: null,
      price: '1.0000',
      equivalentToUnitId: null,
      conversionQuantity: null,
      specifications: null,
    }));
    materialTestProductId = materialProduct.id;
    assert.equal(materialUnit.productId, materialTestProductId);

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

  it('provisions a valid material product and unit without relying on catalog seed data', async () => {
    const rows: Array<{ productId: string; unitId: string }> = await AppDataSource.query(
      `SELECT p.id AS productId, u.id AS unitId
       FROM inventory_product p
       JOIN inventory_product_unit u ON u.product_id = p.id
       WHERE p.id = ? AND p.is_active = 1
         AND p.deleted_at IS NULL AND u.deleted_at IS NULL`,
      [materialTestProductId]
    );
    assert.equal(rows.length, 1, 'Test setup must create its own active product and unit');
    assert.equal(rows[0].productId, materialTestProductId);
    assert.ok(rows[0].unitId);
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
    it('first structural AUTO save populates 1.0 instead of creating empty 1.0 and populated 1.1', async () => {
      const created = await templateService.createTemplate({
        name: 'قالب التحرير الذري الهيكلي',
        isActive: true,
      });

      const v1 = await versionService.getLatestVersion(created.id);
      const rev = await getRevision(created.id, v1.id);
      const preview = await editingService.previewEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'preview-stage', payload: {
            name: 'مرحلة معاينة أولية', departmentId: testDepartmentId,
          } }],
        },
        testUserId
      );
      assert.strictEqual(preview.classification, 'STRUCTURAL');
      assert.strictEqual(preview.isNewVersionMandatory, false);
      assert.strictEqual(preview.allowsOverwrite, true);

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

      assert.strictEqual(commitRes.createdNewVersion, false);
      assert.strictEqual(commitRes.changeType, 'STRUCTURAL');
      assert.strictEqual(commitRes.targetVersionNumber, '1.0');
      assert.ok(commitRes.tempClientMap['temp-stage-1']);

      const detailV1 = await templateService.getTemplateById(created.id, v1.id);
      assert.strictEqual(detailV1.stages.length, 1);

      assert.strictEqual(commitRes.targetVersionId, v1.id);
      assert.strictEqual(detailV1.stages[0].name, 'مرحلة الصب الخرساني');
      assert.strictEqual((await versionService.listVersions(created.id)).length, 1);

      // Referencing a template in a memorandum/order does not freeze it.
      await linkTemplateToRoom(created.id, false);
      const nextRevision = await getRevision(created.id, v1.id);
      const second = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: nextRevision,
          commitDecision: 'NEW_VERSION',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'second-stage', payload: {
            name: 'مرحلة لاحقة', departmentId: testDepartmentId,
          } }],
        },
        testUserId
      );
      assert.strictEqual(second.createdNewVersion, false);
      assert.strictEqual(second.targetVersionNumber, '1.0');
      assert.strictEqual((await versionService.listVersions(created.id)).length, 1);
      assert.strictEqual((await templateService.getTemplateById(created.id, v1.id)).stages.length, 2);

      // The first real room freezes the old state; later structural edits fork.
      const roomId = await linkTemplateToRoom(created.id);
      assert.ok(roomId);
      const frozenRevision = await getRevision(created.id, v1.id);
      const third = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: frozenRevision,
          commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'third-stage', payload: {
            name: 'مرحلة بعد أول غرفة', departmentId: testDepartmentId,
          } }],
        },
        testUserId
      );
      assert.strictEqual(third.createdNewVersion, true);
      assert.strictEqual(third.targetVersionNumber, '1.1');
      assert.strictEqual((await templateService.getTemplateById(created.id, v1.id)).stages.length, 2);
      assert.strictEqual((await templateService.getTemplateById(created.id, third.targetVersionId)).stages.length, 3);
    });

    it('keeps OVERWRITE_CURRENT and multiple structural edits in 1.0 until an archived room has used the template', async () => {
      const template = await templateService.createTemplate({ name: 'قالب الاختبار قبل وبعد الغرفة', isActive: true });
      const v1 = await versionService.getLatestVersion(template.id);
      const firstRevision = await getRevision(template.id, v1.id);
      const initial = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: firstRevision, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'pre-room-1',
            payload: { name: 'مرحلة أولى', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(initial.targetVersionNumber, '1.0');

      const secondRevision = await getRevision(template.id, v1.id);
      const beforeRoom = await editingService.previewEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: secondRevision, commitDecision: 'OVERWRITE_CURRENT',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'pre-room-2',
            payload: { name: 'مرحلة ثانية', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(beforeRoom.isTemplateUsedByRoom, false);
      assert.strictEqual(beforeRoom.isNewVersionMandatory, false);
      assert.strictEqual(beforeRoom.allowsOverwrite, true);
      const second = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: secondRevision, commitDecision: 'OVERWRITE_CURRENT',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'pre-room-2',
            payload: { name: 'مرحلة ثانية', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(second.createdNewVersion, false);
      assert.strictEqual((await versionService.listVersions(template.id)).length, 1);

      // Archived rooms still count as used; deleting their active record must
      // not permit changing a historical snapshot in place.
      const unitId = await linkTemplateToRoom(template.id);
      assert.ok(unitId);
      await AppDataSource.getRepository(ProductionUnitEntity).softDelete({ id: unitId! });
      const frozenRevision = await getRevision(template.id, v1.id);
      const afterRoom = await editingService.previewEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: frozenRevision, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'post-room-3',
            payload: { name: 'مرحلة ثالثة', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(afterRoom.isTemplateUsedByRoom, true);
      assert.strictEqual(afterRoom.isNewVersionMandatory, true);
      assert.strictEqual(afterRoom.allowsOverwrite, false);
      const third = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: frozenRevision, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'post-room-3',
            payload: { name: 'مرحلة ثالثة', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(third.createdNewVersion, true);
      assert.strictEqual(third.targetVersionNumber, '1.1');
      assert.strictEqual((await templateService.getTemplateById(template.id, v1.id)).stages.length, 2);
      assert.strictEqual((await templateService.getTemplateById(template.id, third.targetVersionId)).stages.length, 3);
    });

    it('checks room linkage per latest VERSION, not across the whole template', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب ارتباط الغرف بكل إصدار',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      const firstRevision = await getRevision(template.id, v1.id);
      await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: firstRevision, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'v1-stage',
            payload: { name: 'مرحلة النسخة الأولى', departmentId: testDepartmentId } }] },
        testUserId
      );

      // An actual room using 1.0 freezes 1.0.
      const oldRoomId = await linkTemplateToRoom(template.id);
      assert.ok(oldRoomId);
      let rev = await getRevision(template.id, v1.id);
      const fork = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v1.id, baseRevision: rev, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'v11-stage',
            payload: { name: 'مرحلة جديدة للإصدار الثاني', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(fork.createdNewVersion, true);
      assert.strictEqual(fork.targetVersionNumber, '1.1');
      const v11 = await versionService.getLatestVersion(template.id);
      assert.strictEqual(v11.id, fork.targetVersionId);

      // An archived room using historical 1.0 must not freeze unused 1.1.
      await AppDataSource.getRepository(ProductionUnitEntity).softDelete({ id: oldRoomId! });
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(template.id), false);
      rev = await getRevision(template.id, v11.id);
      const preview = await editingService.previewEditingSession(
        template.id,
        { baseVersionId: v11.id, baseRevision: rev, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'still-v11',
            payload: { name: 'مرحلة إضافية دون غرفة للإصدار الثاني', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(preview.classification, 'STRUCTURAL');
      assert.strictEqual(preview.isTemplateUsedByRoom, false);
      assert.strictEqual(preview.isNewVersionMandatory, false);
      assert.strictEqual(preview.allowsOverwrite, true);

      // Even explicit NEW_VERSION must update UNUSED 1.1 in place.
      const direct = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v11.id, baseRevision: rev, commitDecision: 'NEW_VERSION',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'still-v11',
            payload: { name: 'مرحلة إضافية دون غرفة للإصدار الثاني', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(direct.createdNewVersion, false);
      assert.strictEqual(direct.targetVersionId, v11.id);
      assert.strictEqual(direct.targetVersionNumber, '1.1');
      assert.strictEqual((await versionService.listVersions(template.id)).length, 2);
      assert.strictEqual((await templateService.getTemplateById(template.id, v1.id)).stages.length, 1);
      assert.strictEqual((await templateService.getTemplateById(template.id, v11.id)).stages.length, 3);

      // After a room uses 1.1, normal structural versioning resumes.
      const newRoomId = await linkTemplateToRoom(template.id);
      assert.ok(newRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(template.id), true);
      rev = await getRevision(template.id, v11.id);
      const afterRoomPreview = await editingService.previewEditingSession(
        template.id,
        { baseVersionId: v11.id, baseRevision: rev, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'v12-stage',
            payload: { name: 'مرحلة تستلزم إصدارًا ثالثًا', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(afterRoomPreview.isNewVersionMandatory, true);
      assert.strictEqual(afterRoomPreview.allowsOverwrite, false);
      const newFork = await editingService.commitEditingSession(
        template.id,
        { baseVersionId: v11.id, baseRevision: rev, commitDecision: 'AUTO',
          operations: [{ type: 'ADD_STAGE', tempClientId: 'v12-stage',
            payload: { name: 'مرحلة تستلزم إصدارًا ثالثًا', departmentId: testDepartmentId } }] },
        testUserId
      );
      assert.strictEqual(newFork.createdNewVersion, true);
      assert.strictEqual(newFork.targetVersionNumber, '1.2');
      assert.strictEqual((await templateService.getTemplateById(template.id, v11.id)).stages.length, 3);

      // Neither 1.0 nor 1.1 can be edited after becoming historical,
      // including the version whose room was archived.
      for (const historicId of [v1.id, v11.id]) {
        const historicRev = await getRevision(template.id, historicId);
        await assert.rejects(
          () => editingService.commitEditingSession(
            template.id,
            { baseVersionId: historicId, baseRevision: historicRev, commitDecision: 'OVERWRITE_CURRENT',
              operations: [{ type: 'ADD_STAGE', tempClientId: 'forbidden',
                payload: { name: 'محاولة تعديل إصدار تاريخي', departmentId: testDepartmentId } }] },
            testUserId
          ),
          (error: any) => error?.code === 'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST'
        );
      }
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
      const initialRevision = await getRevision(created.id, v1.id);

      // A pristine 1.0 is intentionally editable. First make it nonempty,
      // then verify a further structural overwrite is rejected.
      const initialCommit = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: initialRevision,
          commitDecision: 'AUTO',
          operations: [{
            type: 'ADD_STAGE',
            tempClientId: 'first-stage',
            payload: { name: 'مرحلة أولية', departmentId: testDepartmentId },
          }],
        },
        testUserId
      );
      assert.strictEqual(initialCommit.createdNewVersion, false);
      assert.strictEqual(initialCommit.targetVersionId, v1.id);
      await linkTemplateToRoom(created.id);
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

      assert.strictEqual(res.createdNewVersion, false);
      assert.strictEqual(res.targetVersionNumber, '1.0');

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
      assert.strictEqual(firstRes.createdNewVersion, false);

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
      assert.strictEqual(previewRes.isNewVersionMandatory, false);
      assert.strictEqual(previewRes.allowsOverwrite, true);
      assert.strictEqual(previewRes.conflicts.length, 0);

      // Verify no changes were committed to database
      const detail = await templateService.getTemplateById(created.id, v1.id);
      assert.strictEqual(detail.stages.length, 0);

      // Once the initial 1.0 is populated, preview must require a new
      // version for subsequent structural additions and must remain read-only.
      const first = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [{
            type: 'ADD_STAGE',
            tempClientId: 'seed-preview-stage',
            payload: { name: 'مرحلة أولية للمعاينة', departmentId: testDepartmentId },
          }],
        },
        testUserId
      );
      assert.strictEqual(first.targetVersionNumber, '1.0');
      await linkTemplateToRoom(created.id);
      const populatedRevision = await getRevision(created.id, v1.id);
      const previewAfterFirstSave = await editingService.previewEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: populatedRevision,
          commitDecision: 'AUTO',
          operations: [{
            type: 'ADD_STAGE',
            tempClientId: 'next-preview-stage',
            payload: { name: 'مرحلة ثانية للمعاينة', departmentId: testDepartmentId },
          }],
        },
        testUserId
      );
      assert.strictEqual(previewAfterFirstSave.classification, 'STRUCTURAL');
      assert.strictEqual(previewAfterFirstSave.isNewVersionMandatory, true);
      assert.strictEqual(previewAfterFirstSave.allowsOverwrite, false);
      assert.strictEqual((await templateService.getTemplateById(created.id, v1.id)).stages.length, 1);
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
          originalFileName: 'test1.pdf',
          storageKey,
          sizeBytes: 14,
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
              originalFileName: 'test1.pdf',
              storageKey,
              sizeBytes: 14,
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
          originalFileName: 'test2.pdf',
          storageKey,
          sizeBytes: 14,
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
              originalFileName: 'test2.pdf',
              storageKey,
              sizeBytes: 14,
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
          originalFileName: 'test3.pdf',
          storageKey,
          sizeBytes: 14,
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
          originalFileName: 'test4.pdf',
          storageKey,
          sizeBytes: 14,
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
            storageKey: resolved.storageKey,
            originalFileName: resolved.originalFileName,
            sizeBytes: resolved.sizeBytes,
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
          originalFileName: 'test5.pdf',
          storageKey,
          sizeBytes: 14,
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
          originalFileName: 'outside.txt',
          storageKey: '../scratch/' + path.basename(outsideFile),
          sizeBytes: 20,
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
          originalFileName: 'test7.pdf',
          storageKey,
          sizeBytes: 14,
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

      // Freeze the populated 1.0 by linking it to an actual production room.
      // An order line alone does not activate historical versioning.
      const linkedRoomId = await linkTemplateToRoom(created.id);
      assert.ok(linkedRoomId, 'An actual room must exist before structural changes fork a version');

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
          originalFileName: 'test9.pdf',
          storageKey,
          sizeBytes: 14,
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
          originalFileName: 'active.pdf',
          storageKey: unexpiredStorageKey,
          sizeBytes: 18,
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

    // ------------------------------------------------------------------------
    // Batch A Tests (A-T1 to A-T6)
    // ------------------------------------------------------------------------

    it('A-T1 — Expired lease and delayed old worker', async () => {
      const created = await templateService.createTemplate({ name: 'قالب سباق انتهاء العقد', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-at1.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-at1');

      const originalDelete = productionTemplateReferenceFileStorageService.deleteStoredFile;
      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFileName: 'at1.pdf',
          storageKey,
          sizeBytes: 11,
          mimeType: 'application/pdf',
          createdByUserId: null,
          deletedAt: new Date(),
        }));

        const queueItem = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PENDING,
          attempts: 0,
        }));

        // Worker A claims the task
        // We use a controlled barrier: stub deleteStoredFile so Worker A pauses before physical deletion
        let workerAReachedBarrier;
        const barrierPromise = new Promise((resolve) => {
          workerAReachedBarrier = resolve;
        });
        let workerACanProceed;
        const proceedPromise = new Promise((resolve) => {
          workerACanProceed = resolve;
        });

        let workerAClaimId = null;
        let workerACallCount = 0;

        productionTemplateReferenceFileStorageService.deleteStoredFile = async (key) => {
          workerACallCount++;
          if (workerACallCount === 1) {
            // Worker A reached pre-unlink / deletion point
            workerAReachedBarrier();
            await proceedPromise; // Wait for Worker B to steal the expired lease
          }
          return originalDelete.call(productionTemplateReferenceFileStorageService, key);
        };

        // Launch Worker A
        const workerAPromise = sharedFileService.executeCleanupTask(queueItem.id, false);

        // Wait until Worker A claims the task and reaches the deletion barrier
        await barrierPromise;

        // Verify Worker A claimed it
        const queueAfterA = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueAfterA.status, FileCleanupStatus.PROCESSING);
        workerAClaimId = queueAfterA.claimId;
        assert.ok(workerAClaimId);

        // Now simulate lease expiration while Worker A is paused
        await cleanupRepo.update(queueItem.id, {
          claimExpiresAt: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
        });

        // Worker B attempts to claim and execute the expired task
        const workerBResult = await sharedFileService.executeCleanupTask(queueItem.id, false);
        assert.strictEqual(workerBResult, true, 'Worker B must successfully claim and execute the expired task');

        // Check DB state after Worker B finishes
        const queueAfterB = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueAfterB.status, FileCleanupStatus.COMPLETED);
        const workerBClaimId = queueAfterB.claimId;
        assert.notStrictEqual(workerBClaimId, workerAClaimId, 'Worker B must have a new claimId');

        // Now unblock Worker A so it resumes
        workerACanProceed();
        const workerAResult = await workerAPromise;

        // Worker A lost its claim during processing, so it must return false and NOT corrupt Worker B's result
        assert.strictEqual(workerAResult, false, 'Worker A must fail because it lost ownership of the claim');

        const finalQueue = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(finalQueue.status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(finalQueue.claimId, workerBClaimId, 'Worker A must not overwrite Worker B claimId');
        assert.strictEqual(fs.existsSync(fullPath), false, 'File must be safely unlinked');
      } finally {
        productionTemplateReferenceFileStorageService.deleteStoredFile = originalDelete;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    it('A-T1b — Expired claim before pre-unlink prevents stale worker deletion', async () => {
      const created = await templateService.createTemplate({ name: 'قالب سباق انتهاء العقد قبل التحقق', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-at1b.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'content-at1b');

      try {
        const stored = await storedFileRepo.save(storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFileName: 'at1b.pdf',
          storageKey,
          sizeBytes: 12,
          mimeType: 'application/pdf',
          createdByUserId: null,
          deletedAt: new Date(),
        }));

        const queueItem = await cleanupRepo.save(cleanupRepo.create({
          id: crypto.randomUUID(),
          fileId: stored.id,
          storageKey: stored.storageKey,
          status: FileCleanupStatus.PENDING,
          attempts: 0,
        }));

        // Set up barrier before pre-unlink check for Worker A
        let workerAReachedBarrier!: () => void;
        const barrierPromise = new Promise<void>((resolve) => {
          workerAReachedBarrier = resolve;
        });
        let workerACanProceed!: () => void;
        const proceedPromise = new Promise<void>((resolve) => {
          workerACanProceed = resolve;
        });

        sharedFileService._testPreUnlinkBarrier = async () => {
          workerAReachedBarrier();
          await proceedPromise;
        };

        // Launch Worker A
        const workerAPromise = sharedFileService.executeCleanupTask(queueItem.id, false);

        // Wait until Worker A has claimed the task and hit the pre-unlink barrier
        await barrierPromise;

        // Verify Worker A claimed it
        const queueAfterA = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueAfterA.status, FileCleanupStatus.PROCESSING);
        const workerAClaimId = queueAfterA.claimId;
        assert.ok(workerAClaimId);

        // Simulate lease expiration for Worker A
        await cleanupRepo.update(queueItem.id, {
          claimExpiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
        });

        // Worker B claims and processes the task to completion
        // Remove test barrier for Worker B
        sharedFileService._testPreUnlinkBarrier = undefined;
        const workerBResult = await sharedFileService.executeCleanupTask(queueItem.id, false);
        assert.strictEqual(workerBResult, true, 'Worker B must successfully claim and execute the expired task');

        const queueAfterB = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueAfterB.status, FileCleanupStatus.COMPLETED);
        const workerBClaimId = queueAfterB.claimId;
        assert.notStrictEqual(workerBClaimId, workerAClaimId, 'Worker B must have a distinct claimId');

        // Unblock Worker A to proceed into Step 5.5 pre-unlink check
        workerACanProceed();
        const workerAResult = await workerAPromise;

        // Worker A must fail pre-unlink check and return false
        assert.strictEqual(workerAResult, false, 'Worker A must fail pre-unlink check because claim was lost');

        const finalQueue = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(finalQueue.status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(finalQueue.claimId, workerBClaimId, 'Worker A must not overwrite Worker B claimId');
        assert.strictEqual(fs.existsSync(fullPath), false, 'Physical file must be unlinked');
      } finally {
        sharedFileService._testPreUnlinkBarrier = undefined;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    it('A-T2 — Immutable storage identity: cannot reuse storageKey of deleted file', async () => {
      const created = await templateService.createTemplate({ name: 'قالب ثبات مفتاح التخزين', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-at2.pdf`;

      // 1. Create a soft-deleted stored file
      const stored = await storedFileRepo.save(storedFileRepo.create({
        id: fileId,
        templateId: created.id,
        originalFileName: 'at2.pdf',
        storageKey,
        sizeBytes: 100,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));

      // 2. Attempt to register a new stored file with the same storageKey
      await assert.rejects(
        async () => {
          await sharedFileService.getOrCreateStoredFile({
            templateId: created.id,
            originalFileName: 'at2-alternate.pdf',
            storageKey,
            sizeBytes: 200,
            mimeType: 'application/pdf',
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STORED_FILE_DELETED');
          return true;
        }
      );

      // Verify no alternate record was created in DB
      const count = await storedFileRepo.count({ where: { storageKey }, withDeleted: true });
      assert.strictEqual(count, 1, 'No new file record must be created with the same storageKey');
      const freshStored = await storedFileRepo.findOne({ where: { id: stored.id }, withDeleted: true });
      assert.strictEqual(freshStored?.originalFileName, 'at2.pdf', 'Existing record must remain unchanged');
    });

    it('A-T3 — Failed cleanup is reused instead of creating duplicate task', async () => {
      const created = await templateService.createTemplate({ name: 'قالب إعادة استخدام المهمة الفاشلة', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-at3.pdf`;

      const stored = await storedFileRepo.save(storedFileRepo.create({
        id: fileId,
        templateId: created.id,
        originalFileName: 'at3.pdf',
        storageKey,
        sizeBytes: 50,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));

      // Existing task with status FAILED and attempts = 1
      const initialTask = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: stored.id,
        storageKey,
        status: FileCleanupStatus.FAILED,
        attempts: 1,
        lastError: 'Simulated network glitch',
        nextRetryAt: new Date(Date.now() + 60 * 1000), // scheduled in the future
      }));

      // Trigger safeDeletePhysicalFileIfUnreferenced again on the unreferenced file
      await sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id);

      // Verify that NO second queue row was created
      const allTasks = await cleanupRepo.find({ where: { fileId: stored.id } });
      assert.strictEqual(allTasks.length, 1, 'Must reuse existing FAILED task without creating duplicate');
      assert.strictEqual(allTasks[0].id, initialTask.id, 'Task ID must remain identical');
      assert.strictEqual(allTasks[0].status, FileCleanupStatus.COMPLETED);
      assert.strictEqual(allTasks[0].attempts, 2, 'Attempts counter must be incremented on the existing record');
    });

    it('A-T4 — Automatic cleanup batch processes due tasks and ignores unexpired leases', async () => {
      const created = await templateService.createTemplate({ name: 'قالب المعالجة بالدفعات', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      // Task 1: Due PENDING task
      const file1 = await storedFileRepo.save(storedFileRepo.create({
        id: crypto.randomUUID(),
        templateId: created.id,
        originalFileName: 'due1.pdf',
        storageKey: `storage/template-stage-attachments/${Date.now()}-due1.pdf`,
        sizeBytes: 10,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));
      const task1 = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: file1.id,
        storageKey: file1.storageKey,
        status: FileCleanupStatus.PENDING,
        attempts: 0,
      }));

      // Task 2: PROCESSING task with active unexpired lease (NOT due)
      const file2 = await storedFileRepo.save(storedFileRepo.create({
        id: crypto.randomUUID(),
        templateId: created.id,
        originalFileName: 'active2.pdf',
        storageKey: `storage/template-stage-attachments/${Date.now()}-active2.pdf`,
        sizeBytes: 10,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));
      const task2 = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: file2.id,
        storageKey: file2.storageKey,
        status: FileCleanupStatus.PROCESSING,
        claimId: 'active-claim-uuid',
        claimedAt: new Date(),
        claimExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins in future
        attempts: 1,
      }));

      // Task 3: FAILED task with nextRetryAt in the past (Due)
      const file3 = await storedFileRepo.save(storedFileRepo.create({
        id: crypto.randomUUID(),
        templateId: created.id,
        originalFileName: 'due3.pdf',
        storageKey: `storage/template-stage-attachments/${Date.now()}-due3.pdf`,
        sizeBytes: 10,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));
      const task3 = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: file3.id,
        storageKey: file3.storageKey,
        status: FileCleanupStatus.FAILED,
        nextRetryAt: new Date(Date.now() - 5 * 60 * 1000), // in the past
        attempts: 1,
      }));

      // Task 4: FAILED task with nextRetryAt in the future (NOT due)
      const file4 = await storedFileRepo.save(storedFileRepo.create({
        id: crypto.randomUUID(),
        templateId: created.id,
        originalFileName: 'future4.pdf',
        storageKey: `storage/template-stage-attachments/${Date.now()}-future4.pdf`,
        sizeBytes: 10,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));
      const task4 = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: file4.id,
        storageKey: file4.storageKey,
        status: FileCleanupStatus.FAILED,
        nextRetryAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins in future
        attempts: 1,
      }));

      // Process batch
      const summary = await sharedFileService.processDueCleanupTasks(50);
      assert.ok(summary.processed >= 2, 'Should process at least the 2 due tasks');

      // Verify task1 and task3 are now COMPLETED
      const fresh1 = await cleanupRepo.findOneOrFail({ where: { id: task1.id } });
      const fresh3 = await cleanupRepo.findOneOrFail({ where: { id: task3.id } });
      assert.strictEqual(fresh1.status, FileCleanupStatus.COMPLETED);
      assert.strictEqual(fresh3.status, FileCleanupStatus.COMPLETED);

      // Verify task2 (active lease) was untouched
      const fresh2 = await cleanupRepo.findOneOrFail({ where: { id: task2.id } });
      assert.strictEqual(fresh2.status, FileCleanupStatus.PROCESSING);
      assert.strictEqual(fresh2.claimId, 'active-claim-uuid');

      // Verify task4 (future retry) was untouched
      const fresh4 = await cleanupRepo.findOneOrFail({ where: { id: task4.id } });
      assert.strictEqual(fresh4.status, FileCleanupStatus.FAILED);
      assert.strictEqual(fresh4.attempts, 1);
    });

    it('A-T5 — Historical retention prevents deleting files needed by historical versions while allowing orphan cleanup', async () => {
      const created = await templateService.createTemplate({ name: 'قالب فحص الاحتفاظ التاريخي', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      // 1. Create attachment in version 1.0
      const tok = await createTestUploadToken(created.id, testUserId, 'hist-retention.pdf', true);
      await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE',
              tempClientId: 's1',
              payload: { name: 'مرحلة تاريخية محتفظ بها', departmentId: testDepartmentId },
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
      const stored = await storedFileRepo.findOneOrFail({ where: { templateId: created.id } });
      const fullPath = path.resolve(process.cwd(), stored.storageKey);

      // Freeze the populated 1.0 by linking it to an actual production room.
      // An order line alone does not activate historical versioning.
      const linkedRoomId = await linkTemplateToRoom(created.id);
      assert.ok(linkedRoomId, 'An actual room must exist before structural changes fork a version');

      // Fork to version 1.1
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
              payload: { name: 'مرحلة ثانية لتفريغ النسخة', departmentId: testDepartmentId },
            },
          ],
        },
        testUserId
      );

      // In version 1.1, soft delete the attachment
      const vLatest = await versionService.getLatestVersion(created.id);
      const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const vLatestStage = await stageRepo.findOneOrFail({ where: { templateId: created.id, versionId: vLatest.id, name: 'مرحلة تاريخية محتفظ بها' } });
      await stageAttRepo.softDelete({ stageId: vLatestStage.id });

      // Even if attachment in v1.1 is deleted, v1Current (historical version) retains it!
      const hasRetention = await sharedFileService.hasRetentionReferences(stored.id);
      assert.strictEqual(hasRetention, true, 'hasRetentionReferences must return true for historical version');

      // Attempt safe deletion -> must be blocked
      const deleteResult = await sharedFileService.safeDeletePhysicalFileIfUnreferenced(stored.id);
      assert.strictEqual(deleteResult, false, 'Deletion must be blocked when historical retention exists');
      assert.strictEqual(fs.existsSync(fullPath), true, 'Physical file must remain on disk');

      // Now test an orphaned temporary file: has NO attachments to any stage/task
      const orphanFile = await storedFileRepo.save(storedFileRepo.create({
        id: crypto.randomUUID(),
        templateId: created.id,
        originalFileName: 'orphan.pdf',
        storageKey: `storage/template-stage-attachments/${Date.now()}-orphan.pdf`,
        sizeBytes: 15,
        mimeType: 'application/pdf',
      }));
      const orphanPath = path.resolve(process.cwd(), orphanFile.storageKey);
      fs.writeFileSync(orphanPath, 'orphan data');

      const orphanHasRetention = await sharedFileService.hasRetentionReferences(orphanFile.id);
      assert.strictEqual(orphanHasRetention, false, 'Orphaned file has no retention references');

      const orphanDeleted = await sharedFileService.safeDeletePhysicalFileIfUnreferenced(orphanFile.id);
      assert.strictEqual(orphanDeleted, true, 'Orphaned file can be safely deleted');
      assert.strictEqual(fs.existsSync(orphanPath), false, 'Orphaned physical file must be unlinked');
    });

    it('A-T6 — ENOENT is idempotent: deleting missing file twice succeeds safely without error', async () => {
      const created = await templateService.createTemplate({ name: 'قالب حذف مكرر آمن', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-at6.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

      const stored = await storedFileRepo.save(storedFileRepo.create({
        id: fileId,
        templateId: created.id,
        originalFileName: 'at6.pdf',
        storageKey,
        sizeBytes: 12,
        mimeType: 'application/pdf',
        deletedAt: new Date(),
      }));

      const queueItem = await cleanupRepo.save(cleanupRepo.create({
        id: crypto.randomUUID(),
        fileId: stored.id,
        storageKey,
        status: FileCleanupStatus.PENDING,
        attempts: 0,
      }));

      // First execution on missing file -> ENOENT handled as safe completion
      const res1 = await sharedFileService.executeCleanupTask(queueItem.id, false);
      assert.strictEqual(res1, true, 'First deletion of missing file must complete safely');
      const queueAfter1 = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
      assert.strictEqual(queueAfter1.status, FileCleanupStatus.COMPLETED);

      // Second execution on missing file -> idempotent safe success
      const res2 = await sharedFileService.executeCleanupTask(queueItem.id, true);
      assert.strictEqual(res2, false, 'Second execution on COMPLETED task returns false (already completed)');
      const queueAfter2 = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
      assert.strictEqual(queueAfter2.status, FileCleanupStatus.COMPLETED);
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
          title: 'Version-pinned production order',
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
         WHERE p.deleted_at IS NULL AND p.is_active = 1 AND u.deleted_at IS NULL AND p.id = ? 
         LIMIT 1`,
        [materialTestProductId]
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
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      // Create physical upload tokens for attachments
      const stageToken = await createTestUploadToken(template.id, testUserId, 'stage-spec.pdf', true);
      const taskToken = await createTestUploadToken(template.id, testUserId, 'task-guide.pdf', true);

      // 3. Commit initial rich structure on Version 1.0
      const initialCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
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
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
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

  // ------------------------------------------------------------------------
  // 14. Batch B Semantic Editing, Reordering & Materials Integrity Verification
  // ------------------------------------------------------------------------
  describe('14. Batch B Semantic Editing, Reordering & Materials Integrity Verification', () => {
    it('B-T1.1: Reorder options only results in MINOR change and persists', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص ترتيب الخيارات',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط الترتيب' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار أ' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o2', payload: { name: 'خيار ب' } },
          ],
        },
        testUserId
      );

      const p1Id = initCommit.tempClientMap['p1'];
      const o1Id = initCommit.tempClientMap['o1'];
      const o2Id = initCommit.tempClientMap['o2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      // Preview reorder only
      const preview = await editingService.previewEditingSession(template.id, {
        baseVersionId: vLatest.id,
        baseRevision: rev,
        operations: [
          {
            type: 'REORDER_PATTERN_OPTIONS',
            targetId: p1Id,
            payload: { optionIds: [o2Id, o1Id] },
          },
        ],
      });
      assert.strictEqual(preview.classification, 'MINOR');
      assert.strictEqual(preview.isNewVersionMandatory, false);

      // Commit reorder
      const reorderCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'REORDER_PATTERN_OPTIONS',
              targetId: p1Id,
              payload: { optionIds: [o2Id, o1Id] },
            },
          ],
        },
        testUserId
      );
      assert.strictEqual(reorderCommit.changeType, 'MINOR');

      // Reload and verify
      const detail = await templateService.getTemplateById(template.id, reorderCommit.targetVersionId);
      const pat = detail.patterns.find((p) => p.id === p1Id)!;
      assert.strictEqual(pat.options[0].id, o2Id);
      assert.strictEqual(pat.options[0].sortOrder, 1);
      assert.strictEqual(pat.options[1].id, o1Id);
      assert.strictEqual(pat.options[1].sortOrder, 2);
    });

    it('B-T1.2: Reorder tasks only results in MINOR change and persists', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص ترتيب المهام',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط مهام' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار المهام' } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't1', payload: { name: 'مهمة 1', departmentId: testDepartmentId } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't2', payload: { name: 'مهمة 2', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const o1Id = initCommit.tempClientMap['o1'];
      const t1Id = initCommit.tempClientMap['t1'];
      const t2Id = initCommit.tempClientMap['t2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      // Preview reorder only
      const preview = await editingService.previewEditingSession(template.id, {
        baseVersionId: vLatest.id,
        baseRevision: rev,
        operations: [
          {
            type: 'REORDER_OPTION_TASKS',
            targetId: o1Id,
            payload: { taskIds: [t2Id, t1Id] },
          },
        ],
      });
      assert.strictEqual(preview.classification, 'MINOR');

      // Commit
      const commitRes = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'REORDER_OPTION_TASKS',
              targetId: o1Id,
              payload: { taskIds: [t2Id, t1Id] },
            },
          ],
        },
        testUserId
      );
      assert.strictEqual(commitRes.changeType, 'MINOR');

      const detail = await templateService.getTemplateById(template.id, commitRes.targetVersionId);
      const opt = detail.patterns[0].options[0];
      assert.strictEqual(opt.tasks[0].id, t2Id);
      assert.strictEqual(opt.tasks[0].sortOrder, 1);
      assert.strictEqual(opt.tasks[1].id, t1Id);
      assert.strictEqual(opt.tasks[1].sortOrder, 2);
    });

    it('B-T1.3: Reorder workflow only persists on reload', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب سير العمل المحدث',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's1', payload: { name: 'المرحلة الأولى', departmentId: testDepartmentId } },
            { type: 'ADD_STAGE', tempClientId: 's2', payload: { name: 'المرحلة الثانية', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const s1Id = initCommit.tempClientMap['s1'];
      const s2Id = initCommit.tempClientMap['s2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      // Reorder workflow: s2 before s1
      const reorderCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'REORDER_WORKFLOW',
              payload: { itemIds: [s2Id, s1Id] },
            },
          ],
        },
        testUserId
      );
      assert.strictEqual(reorderCommit.changeType, 'MINOR');

      const detail = await templateService.getTemplateById(template.id, reorderCommit.targetVersionId);
      assert.strictEqual(detail.workflowItems.length, 2);
      assert.strictEqual(detail.workflowItems[0].stageId, s2Id);
      assert.strictEqual(detail.workflowItems[0].sortOrder, 1);
      assert.strictEqual(detail.workflowItems[1].stageId, s1Id);
      assert.strictEqual(detail.workflowItems[1].sortOrder, 2);
    });

    it('B-T1.4: Add option then reorder creates 1 new version with matching order', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب إضافة وترتيب خيار',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط تجربة' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار 1' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o2', payload: { name: 'خيار 2' } },
          ],
        },
        testUserId
      );

      const p1Id = initCommit.tempClientMap['p1'];
      const o1Id = initCommit.tempClientMap['o1'];
      const o2Id = initCommit.tempClientMap['o2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Single session: Add Option 3, and reorder to [opt3, opt1, opt2]
      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_OPTION', parentId: p1Id, tempClientId: 'opt3', payload: { name: 'خيار 3' } },
            {
              type: 'REORDER_PATTERN_OPTIONS',
              targetId: p1Id,
              payload: { optionIds: ['opt3', o1Id, o2Id] },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(secondCommit.createdNewVersion, true);
      assert.strictEqual(secondCommit.targetVersionNumber, '1.2');

      const detail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);
      const pat = detail.patterns[0];
      assert.strictEqual(pat.options.length, 3);
      assert.strictEqual(pat.options[0].name, 'خيار 3');
      assert.strictEqual(pat.options[0].sortOrder, 1);
      assert.strictEqual(pat.options[1].name, 'خيار 1');
      assert.strictEqual(pat.options[1].sortOrder, 2);
      assert.strictEqual(pat.options[2].name, 'خيار 2');
      assert.strictEqual(pat.options[2].sortOrder, 3);
    });

    it('B-T1.5: Delete option then reorder creates 1 new version with dense order', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب حذف وترتيب خيار',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط خيارات 3' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار أ' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o2', payload: { name: 'خيار ب' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o3', payload: { name: 'خيار ج' } },
          ],
        },
        testUserId
      );

      const p1Id = initCommit.tempClientMap['p1'];
      const o1Id = initCommit.tempClientMap['o1'];
      const o2Id = initCommit.tempClientMap['o2'];
      const o3Id = initCommit.tempClientMap['o3'];

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Single session: Delete o2, reorder to [o3, o1]
      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'DELETE_OPTION', targetId: o2Id },
            {
              type: 'REORDER_PATTERN_OPTIONS',
              targetId: p1Id,
              payload: { optionIds: [o3Id, o1Id] },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(secondCommit.createdNewVersion, true);
      assert.strictEqual(secondCommit.targetVersionNumber, '1.2');

      const detail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);
      const pat = detail.patterns[0];
      assert.strictEqual(pat.options.length, 2);
      assert.strictEqual(pat.options[0].name, 'خيار ج');
      assert.strictEqual(pat.options[0].sortOrder, 1);
      assert.strictEqual(pat.options[1].name, 'خيار أ');
      assert.strictEqual(pat.options[1].sortOrder, 2);
    });

    it('B-T1.6: Add task + delete task + reorder creates exact dense order', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب مهام كثيفة',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار' } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't1', payload: { name: 'مهمة أولى', departmentId: testDepartmentId } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't2', payload: { name: 'مهمة ثانية', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const o1Id = initCommit.tempClientMap['o1'];
      const t1Id = initCommit.tempClientMap['t1'];
      const t2Id = initCommit.tempClientMap['t2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Single session: Delete t1, Add t3, Reorder to [t3, t2]
      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'DELETE_TASK', targetId: t1Id },
            { type: 'ADD_TASK', parentId: o1Id, tempClientId: 't3', payload: { name: 'مهمة ثالثة', departmentId: testDepartmentId } },
            {
              type: 'REORDER_OPTION_TASKS',
              targetId: o1Id,
              payload: { taskIds: ['t3', t2Id] },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(secondCommit.createdNewVersion, true);

      const detail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);
      const opt = detail.patterns[0].options[0];
      assert.strictEqual(opt.tasks.length, 2);
      assert.strictEqual(opt.tasks[0].name, 'مهمة ثالثة');
      assert.strictEqual(opt.tasks[0].sortOrder, 1);
      assert.strictEqual(opt.tasks[1].name, 'مهمة ثانية');
      assert.strictEqual(opt.tasks[1].sortOrder, 2);
    });

    it('B-T1.7: Add stage + reorder workflow places stage in correct position', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب إضافة مرحلة وترتيب سير العمل',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's1', payload: { name: 'مرحلة قديمة', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const s1Id = initCommit.tempClientMap['s1'];

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Single session: Add s2, reorder workflow to [s2, s1]
      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's2', payload: { name: 'مرحلة سابقة', departmentId: testDepartmentId } },
            {
              type: 'REORDER_WORKFLOW',
              payload: { itemIds: ['s2', s1Id] },
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(secondCommit.createdNewVersion, true);

      const detail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);
      assert.strictEqual(detail.workflowItems.length, 2);
      assert.strictEqual(detail.workflowItems[0].stage?.name, 'مرحلة سابقة');
      assert.strictEqual(detail.workflowItems[0].sortOrder, 1);
      assert.strictEqual(detail.workflowItems[1].stage?.name, 'مرحلة قديمة');
      assert.strictEqual(detail.workflowItems[1].sortOrder, 2);
    });

    it('B-T1.8: Reorder then restore original returns NONE diff', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب إعادة الترتيب والإلغاء',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار 1' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o2', payload: { name: 'خيار 2' } },
          ],
        },
        testUserId
      );

      const p1Id = initCommit.tempClientMap['p1'];
      const o1Id = initCommit.tempClientMap['o1'];
      const o2Id = initCommit.tempClientMap['o2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      // Reorder to [o2, o1], then revert back to [o1, o2]
      const preview = await editingService.previewEditingSession(template.id, {
        baseVersionId: vLatest.id,
        baseRevision: rev,
        operations: [
          {
            type: 'REORDER_PATTERN_OPTIONS',
            targetId: p1Id,
            payload: { optionIds: [o2Id, o1Id] },
          },
          {
            type: 'REORDER_PATTERN_OPTIONS',
            targetId: p1Id,
            payload: { optionIds: [o1Id, o2Id] },
          },
        ],
      });

      assert.strictEqual(preview.classification, 'NONE');
      assert.strictEqual(preview.effectiveChangesCount, 0);
    });

    it('B-T2.1: UPDATE_OPTION with sortOrder is rejected with PRODUCTION_TEMPLATE_OPTION_REORDER_OPERATION_REQUIRED', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص حظر تعديل ترتيب الخيار',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار' } },
          ],
        },
        testUserId
      );

      const o1Id = initCommit.tempClientMap['o1'];
      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'UPDATE_OPTION',
                  targetId: o1Id,
                  payload: { name: 'تعديل', sortOrder: 5 },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_OPTION_REORDER_OPERATION_REQUIRED');
          return true;
        }
      );
    });

    it('B-T2.2: UPDATE_TASK with sortOrder is rejected with PRODUCTION_TEMPLATE_TASK_REORDER_OPERATION_REQUIRED', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص حظر تعديل ترتيب المهمة',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار' } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't1', payload: { name: 'مهمة', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const t1Id = initCommit.tempClientMap['t1'];
      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'UPDATE_TASK',
                  targetId: t1Id,
                  payload: { name: 'مهمة معدلة', sortOrder: 3 },
                },
              ],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_TASK_REORDER_OPERATION_REQUIRED');
          return true;
        }
      );
    });

    it('B-T3.1: Replace stage material executes DELETE before ADD without MySQL unique key conflict', async () => {
      const prodRows: any[] = await AppDataSource.query(
        `SELECT p.id as productId, u.id as unitId 
         FROM inventory_product p 
         JOIN inventory_product_unit u ON u.product_id = p.id 
         WHERE p.deleted_at IS NULL AND p.is_active = 1 AND u.deleted_at IS NULL AND p.id = ? 
         LIMIT 1`,
        [materialTestProductId]
      );
      assert.ok(prodRows.length > 0);
      const { productId, unitId } = prodRows[0];

      const template = await templateService.createTemplate({
        name: 'قالب استبدال مادة المرحلة',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      // Add stage with initial material
      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's1', payload: { name: 'مرحلة العزل', departmentId: testDepartmentId } },
            {
              type: 'ADD_STAGE_MATERIAL',
              parentId: 's1',
              payload: { productId, productUnitId: unitId, plannedQuantity: '5.000000' },
            },
          ],
        },
        testUserId
      );

      const s1Id = initCommit.tempClientMap['s1'];
      const stageMatRepo = AppDataSource.getRepository(ProductionTemplateStageMaterialEntity);
      const initialMat = await stageMatRepo.findOneOrFail({ where: { stageId: s1Id } });

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Replace material for the exact same product & unit in a single session
      // Even if client passes ADD before DELETE, normalizer ensures DELETE executes first
      const replaceCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE_MATERIAL',
              parentId: s1Id,
              payload: { productId, productUnitId: unitId, plannedQuantity: '20.000000' },
            },
            {
              type: 'DELETE_STAGE_MATERIAL',
              targetId: initialMat.id,
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(replaceCommit.createdNewVersion, true);

      // Verify DB has exactly 1 material with 20.000000
      const detail = await templateService.getTemplateById(template.id, replaceCommit.targetVersionId);
      const newStage = detail.stages[0];
      const finalMats = await stageMatRepo.find({ where: { stageId: newStage.id } });
      assert.strictEqual(finalMats.length, 1);
      assert.strictEqual(Number(finalMats[0].plannedQuantity), 20);
    });

    it('B-T3.2: Replace task material executes DELETE before ADD without MySQL unique key conflict', async () => {
      const prodRows: any[] = await AppDataSource.query(
        `SELECT p.id as productId, u.id as unitId 
         FROM inventory_product p 
         JOIN inventory_product_unit u ON u.product_id = p.id 
         WHERE p.deleted_at IS NULL AND p.is_active = 1 AND u.deleted_at IS NULL AND p.id = ? 
         LIMIT 1`,
        [materialTestProductId]
      );
      assert.ok(prodRows.length > 0);
      const { productId, unitId } = prodRows[0];

      const template = await templateService.createTemplate({
        name: 'قالب استبدال مادة المهمة',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار' } },
            { type: 'ADD_TASK', parentId: 'o1', tempClientId: 't1', payload: { name: 'مهمة', departmentId: testDepartmentId } },
            {
              type: 'ADD_TASK_MATERIAL',
              parentId: 't1',
              payload: { productId, productUnitId: unitId, plannedQuantity: '8.000000' },
            },
          ],
        },
        testUserId
      );

      const t1Id = initCommit.tempClientMap['t1'];
      const taskMatRepo = AppDataSource.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
      const initialMat = await taskMatRepo.findOneOrFail({ where: { taskId: t1Id } });

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Replace task material in single session
      const replaceCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_TASK_MATERIAL',
              parentId: t1Id,
              payload: { productId, productUnitId: unitId, plannedQuantity: '35.000000' },
            },
            {
              type: 'DELETE_TASK_MATERIAL',
              targetId: initialMat.id,
            },
          ],
        },
        testUserId
      );

      assert.strictEqual(replaceCommit.createdNewVersion, true);

      const detail = await templateService.getTemplateById(template.id, replaceCommit.targetVersionId);
      const newTaskId = detail.patterns[0].options[0].tasks[0].id;
      const finalMats = await taskMatRepo.find({ where: { taskId: newTaskId } });
      assert.strictEqual(finalMats.length, 1);
      assert.strictEqual(Number(finalMats[0].plannedQuantity), 35);
    });

    it('B-T3.3: areDecimalQuantitiesEqual compares DECIMAL(18,6) strings accurately without float bugs', () => {
      assert.strictEqual(areDecimalQuantitiesEqual('12.5', '12.500000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual('012.50', '12.500000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual('0', '0.000000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual(12.5, '12.500000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual('12.500001', '12.500000'), false);
      assert.strictEqual(areDecimalQuantitiesEqual('10', '10.000000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual(null, ''), true);
      assert.strictEqual(areDecimalQuantitiesEqual(undefined, null), true);
    });

    it('B-T3.4: Delete unknown material is rejected with specific error', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص مادة مجهولة',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      const rev = await getRevision(template.id, v1.id);
      const fakeId = crypto.randomUUID();

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [{ type: 'DELETE_STAGE_MATERIAL', targetId: fakeId }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STAGE_MATERIAL_NOT_FOUND');
          return true;
        }
      );

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [{ type: 'DELETE_TASK_MATERIAL', targetId: fakeId }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_TASK_MATERIAL_NOT_FOUND');
          return true;
        }
      );
    });

    it('B-T4.1: Delete unknown attachment is rejected with specific error', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب فحص مرفق مجهول',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      const rev = await getRevision(template.id, v1.id);
      const fakeId = crypto.randomUUID();

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [{ type: 'DELETE_STAGE_ATTACHMENT', targetId: fakeId }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_STAGE_ATTACHMENT_NOT_FOUND');
          return true;
        }
      );

      await assert.rejects(
        async () =>
          editingService.commitEditingSession(
            template.id,
            {
              baseVersionId: v1.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [{ type: 'DELETE_TASK_ATTACHMENT', targetId: fakeId }],
            },
            testUserId
          ),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_TASK_ATTACHMENT_NOT_FOUND');
          return true;
        }
      );
    });

    it('B-T4.2: Cancel temporary attachment leaves token unconsumed and schedules no cleanup', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب إلغاء المرفق المؤقت',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      // Add stage first
      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's1', payload: { name: 'المرحلة', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const s1Id = initCommit.tempClientMap['s1'];
      const vLatest = await versionService.getLatestVersion(template.id);
      rev = await getRevision(template.id, vLatest.id);

      // Create upload token
      const uploadToken = await createTestUploadToken(template.id, testUserId, 'temporary-plan.pdf', true);

      // Add stage attachment then delete it in the same session
      const cancelCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            {
              type: 'ADD_STAGE_ATTACHMENT',
              parentId: s1Id,
              tempClientId: 'att-temp',
              payload: { uploadToken },
            },
            {
              type: 'DELETE_STAGE_ATTACHMENT',
              targetId: 'att-temp',
            },
          ],
        },
        testUserId
      );

      // Canceling temporary attachment results in NONE change
      assert.strictEqual(cancelCommit.changeType, 'NONE');
      assert.strictEqual(cancelCommit.appliedOperationsCount, 0);

      // Token must NOT be marked as used
      const tokenRepo = AppDataSource.getRepository(ProductionTemplateUploadTokenEntity);
      const tokenEntity = await tokenRepo.findOneOrFail({ where: { id: uploadToken } });
      assert.strictEqual(tokenEntity.isUsed, false);

      // No cleanup queue row should exist for this template's session
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);
      const queueRows = await cleanupRepo.find();
      // Ensure no cleanup row was scheduled for our temporary plan
      const matching = queueRows.filter((r) => r.storageKey.includes('temporary-plan.pdf'));
      assert.strictEqual(matching.length, 0);
    });

    it('B-T5.1: Mixed edits fork exactly 1 new version leaving previous version intact', async () => {
      const template = await templateService.createTemplate({
        name: 'قالب التفرع الذري الموحد',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 's1', payload: { name: 'مرحلة قديمة', departmentId: testDepartmentId } },
            { type: 'ADD_PATTERN', tempClientId: 'p1', payload: { name: 'نمط قديم' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o1', payload: { name: 'خيار مستمر' } },
            { type: 'ADD_OPTION', parentId: 'p1', tempClientId: 'o2', payload: { name: 'خيار ملغي' } },
          ],
        },
        testUserId
      );

      const s1Id = initCommit.tempClientMap['s1'];
      const p1Id = initCommit.tempClientMap['p1'];
      const o1Id = initCommit.tempClientMap['o1'];
      const o2Id = initCommit.tempClientMap['o2'];

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // Mixed session:
      // 1. UPDATE_STAGE (name)
      // 2. ADD_STAGE (new structural stage)
      // 3. DELETE_OPTION (o2)
      // 4. REORDER_WORKFLOW
      const mixedCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'UPDATE_STAGE', targetId: s1Id, payload: { name: 'مرحلة محدثة' } },
            { type: 'ADD_STAGE', tempClientId: 's2', payload: { name: 'مرحلة جديدة تماماً', departmentId: testDepartmentId } },
            { type: 'DELETE_OPTION', targetId: o2Id },
            { type: 'REORDER_WORKFLOW', payload: { itemIds: ['s2', p1Id, s1Id] } },
          ],
        },
        testUserId
      );

      // Verify exactly 1 new version created
      assert.strictEqual(mixedCommit.createdNewVersion, true);
      assert.strictEqual(mixedCommit.targetVersionNumber, '1.2');

      // Verify Version 1.0 remains fully intact
      const detailV1 = await templateService.getTemplateById(template.id, vLatest.id);
      assert.strictEqual(detailV1.stages.length, 1);
      assert.strictEqual(detailV1.stages[0].name, 'مرحلة قديمة');
      assert.strictEqual(detailV1.patterns[0].options.length, 2);

      // Verify Version 1.1 contains all changes accurately
      const detailV11 = await templateService.getTemplateById(template.id, mixedCommit.targetVersionId);
      assert.strictEqual(detailV11.stages.length, 2);
      const stageUpdated = detailV11.stages.find((s) => s.name === 'مرحلة محدثة');
      const stageNew = detailV11.stages.find((s) => s.name === 'مرحلة جديدة تماماً');
      assert.ok(stageUpdated && stageNew);

      // Option 2 was deleted in 1.1
      assert.strictEqual(detailV11.patterns[0].options.length, 1);
      assert.strictEqual(detailV11.patterns[0].options[0].name, 'خيار مستمر');

      // Workflow ordering verified in 1.1: s2 (sortOrder 1), p1 (sortOrder 2), s1 (sortOrder 3)
      assert.strictEqual(detailV11.workflowItems.length, 3);
      assert.strictEqual(detailV11.workflowItems[0].stage?.name, 'مرحلة جديدة تماماً');
      assert.strictEqual(detailV11.workflowItems[0].sortOrder, 1);
      assert.strictEqual(detailV11.workflowItems[1].pattern?.name, 'نمط قديم');
      assert.strictEqual(detailV11.workflowItems[1].sortOrder, 2);
      assert.strictEqual(detailV11.workflowItems[2].stage?.name, 'مرحلة محدثة');
      assert.strictEqual(detailV11.workflowItems[2].sortOrder, 3);
    });

    it('B-T5.2: Comprehensive multi-entity roundtrip test (3 stages, 2 patterns, options, tasks, materials, attachments)', async () => {
      const prodRows: any[] = await AppDataSource.query(
        `SELECT p.id as productId, u.id as unitId 
         FROM inventory_product p 
         JOIN inventory_product_unit u ON u.product_id = p.id 
         WHERE p.deleted_at IS NULL AND p.is_active = 1 AND u.deleted_at IS NULL AND p.id = ? 
         LIMIT 2`,
        [materialTestProductId]
      );
      assert.ok(prodRows.length >= 1);
      const prod1 = prodRows[0];
      const prod2 = prodRows.length > 1 ? prodRows[1] : prodRows[0];

      const template = await templateService.createTemplate({
        name: 'قالب التحقق الدوري الشامل 3 مراحل',
        description: 'اختبار دورة الحياة الكاملة للقالب',
        isActive: true,
      });
      const v1 = await versionService.getLatestVersion(template.id);
      let rev = await getRevision(template.id, v1.id);
      // This suite exercises version cloning after a room has used the template.
      await linkTemplateToRoom(template.id);

      const stage1AttToken = await createTestUploadToken(template.id, testUserId, 'spec-stage1.pdf', true);
      const task1AttToken = await createTestUploadToken(template.id, testUserId, 'spec-task1.pdf', true);

      // 1. Initial Commit on 1.0: 3 Stages, 2 Patterns, Options, Tasks, Materials, Attachments
      const initCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'NEW_VERSION',
          operations: [
            // Stage 1
            { type: 'ADD_STAGE', tempClientId: 'stg-1', payload: { name: 'المرحلة 1: التجهيز', departmentId: testDepartmentId, estimatedCost: '250.0000' } },
            { type: 'ADD_STAGE_MATERIAL', parentId: 'stg-1', payload: { productId: prod1.productId, productUnitId: prod1.unitId, plannedQuantity: '10.000000' } },
            { type: 'ADD_STAGE_ATTACHMENT', parentId: 'stg-1', payload: { uploadToken: stage1AttToken } },

            // Stage 2
            { type: 'ADD_STAGE', tempClientId: 'stg-2', payload: { name: 'المرحلة 2: التصنيع', departmentId: testDepartmentId, estimatedCost: '600.0000' } },

            // Stage 3
            { type: 'ADD_STAGE', tempClientId: 'stg-3', payload: { name: 'المرحلة 3: الفحص والتسليم', departmentId: testDepartmentId, estimatedCost: '150.0000' } },

            // Pattern 1
            { type: 'ADD_PATTERN', tempClientId: 'pat-1', payload: { name: 'نمط الهيكل' } },
            { type: 'ADD_OPTION', parentId: 'pat-1', tempClientId: 'opt-11', payload: { name: 'هيكل حديدي' } },
            { type: 'ADD_OPTION', parentId: 'pat-1', tempClientId: 'opt-12', payload: { name: 'هيكل خرساني' } },
            { type: 'ADD_TASK', parentId: 'opt-11', tempClientId: 'tsk-111', payload: { name: 'لحام وتجميع', departmentId: testDepartmentId, estimatedCost: '400.0000' } },
            { type: 'ADD_TASK_MATERIAL', parentId: 'tsk-111', payload: { productId: prod2.productId, productUnitId: prod2.unitId, plannedQuantity: '5.500000' } },
            { type: 'ADD_TASK_ATTACHMENT', parentId: 'tsk-111', payload: { uploadToken: task1AttToken } },

            // Pattern 2
            { type: 'ADD_PATTERN', tempClientId: 'pat-2', payload: { name: 'نمط الطلاء' } },
            { type: 'ADD_OPTION', parentId: 'pat-2', tempClientId: 'opt-21', payload: { name: 'دهان إيبوكسي' } },
            { type: 'ADD_TASK', parentId: 'opt-21', tempClientId: 'tsk-211', payload: { name: 'تطبيق الطبقة الأولى', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const stg1Id = initCommit.tempClientMap['stg-1'];
      const stg2Id = initCommit.tempClientMap['stg-2'];
      const stg3Id = initCommit.tempClientMap['stg-3'];
      const pat1Id = initCommit.tempClientMap['pat-1'];
      const opt11Id = initCommit.tempClientMap['opt-11'];
      const opt12Id = initCommit.tempClientMap['opt-12'];
      const tsk111Id = initCommit.tempClientMap['tsk-111'];
      const pat2Id = initCommit.tempClientMap['pat-2'];
      const opt21Id = initCommit.tempClientMap['opt-21'];
      const tsk211Id = initCommit.tempClientMap['tsk-211'];

      // Verify Initial Structure in DB
      const initDetail = await templateService.getTemplateById(template.id, initCommit.targetVersionId);
      assert.strictEqual(initDetail.stages.length, 3);
      assert.strictEqual(initDetail.patterns.length, 2);
      assert.strictEqual(initDetail.workflowItems.length, 5);

      // Find attachment to delete
      const stageAttRepo = AppDataSource.getRepository(ProductionTemplateStageAttachmentEntity);
      const stage1Att = await stageAttRepo.findOneOrFail({ where: { stageId: stg1Id } });

      const vLatest = await versionService.getLatestVersion(template.id);
      // The next structural edit must fork only after a real room uses THIS
      // latest version; rooms from older versions do not freeze it.
      const currentVersionRoomId = await linkTemplateToRoom(template.id);
      assert.ok(currentVersionRoomId);
      assert.strictEqual(await editingService.hasProductionUnitForTemplateVersion(
        template.id, AppDataSource.manager, vLatest.id
      ), true);
      rev = await getRevision(template.id, vLatest.id);

      // 2. Second Session: Complex Multi-Operation Mutation
      // Adds, deletes, updates, reorders in a single atomic commit
      const secondCommit = await editingService.commitEditingSession(
        template.id,
        {
          baseVersionId: vLatest.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            // Update Stage 1 Cost
            { type: 'UPDATE_STAGE', targetId: stg1Id, payload: { estimatedCost: '350.0000' } },
            // Delete Stage 3
            { type: 'DELETE_STAGE', targetId: stg3Id },
            // Reorder Pattern 1 options: opt12 before opt11
            { type: 'REORDER_PATTERN_OPTIONS', targetId: pat1Id, payload: { optionIds: [opt12Id, opt11Id] } },
            // Add a task to opt12
            { type: 'ADD_TASK', parentId: opt12Id, tempClientId: 'tsk-121', payload: { name: 'صب الخرسانة', departmentId: testDepartmentId } },
            // Delete stage 1 attachment
            { type: 'DELETE_STAGE_ATTACHMENT', targetId: stage1Att.id },
            // Reorder workflow: pat2, stg2, pat1, stg1
            { type: 'REORDER_WORKFLOW', payload: { itemIds: [pat2Id, stg2Id, pat1Id, stg1Id] } },
          ],
        },
        testUserId
      );

      assert.strictEqual(secondCommit.createdNewVersion, true);
      assert.strictEqual(secondCommit.targetVersionNumber, '1.2');

      // 3. Verify Version 1.1 in MySQL
      const v11Detail = await templateService.getTemplateById(template.id, secondCommit.targetVersionId);

      // Stages: stg3 was deleted, stg1 & stg2 remain
      assert.strictEqual(v11Detail.stages.length, 2);
      const finalStg1 = v11Detail.stages.find((s) => s.name === 'المرحلة 1: التجهيز')!;
      assert.strictEqual(Number(finalStg1.estimatedCost), 350);

      // Stage 1 attachment was deleted
      const finalStageAtts = await stageAttRepo.find({ where: { stageId: finalStg1.id } });
      assert.strictEqual(finalStageAtts.length, 0);

      // Pattern 1 Options reordered: opt-12 is sortOrder 1, opt-11 is sortOrder 2
      const finalPat1 = v11Detail.patterns.find((p) => p.name === 'نمط الهيكل')!;
      assert.strictEqual(finalPat1.options.length, 2);
      assert.strictEqual(finalPat1.options[0].name, 'هيكل خرساني');
      assert.strictEqual(finalPat1.options[0].sortOrder, 1);
      assert.strictEqual(finalPat1.options[1].name, 'هيكل حديدي');
      assert.strictEqual(finalPat1.options[1].sortOrder, 2);

      // New task added to opt-12 exists
      assert.strictEqual(finalPat1.options[0].tasks.length, 1);
      assert.strictEqual(finalPat1.options[0].tasks[0].name, 'صب الخرسانة');

      // Workflow items compacted to dense 1..4 in specified order: pat2, stg2, pat1, stg1
      const finalWf = v11Detail.workflowItems;
      assert.strictEqual(finalWf.length, 4);
      assert.strictEqual(finalWf[0].pattern?.name, 'نمط الطلاء');
      assert.strictEqual(finalWf[0].sortOrder, 1);
      assert.strictEqual(finalWf[1].stage?.name, 'المرحلة 2: التصنيع');
      assert.strictEqual(finalWf[1].sortOrder, 2);
      assert.strictEqual(finalWf[2].pattern?.name, 'نمط الهيكل');
      assert.strictEqual(finalWf[2].sortOrder, 3);
      assert.strictEqual(finalWf[3].stage?.name, 'المرحلة 1: التجهيز');
      assert.strictEqual(finalWf[3].sortOrder, 4);
    });
  });

  // ------------------------------------------------------------------------
  // 15. Final Precision, Quantity Validation & Schema Verification (Tests F1 to F9)
  // ------------------------------------------------------------------------
  describe('15. Final Precision, Quantity Validation & Schema Verification (Tests F1 to F9)', () => {
    it('Test F1 — A-T1 uses valid StoredFile entity properties', async () => {
      const meta = AppDataSource.getMetadata(ProductionTemplateStoredFileEntity);
      const colProps = meta.columns.map((c) => c.propertyName);
      assert.ok(colProps.includes('originalFileName'), 'Entity must have originalFileName property');
      assert.ok(colProps.includes('sizeBytes'), 'Entity must have sizeBytes property');
      assert.ok(colProps.includes('storageKey'), 'Entity must have storageKey property');
      assert.ok(colProps.includes('mimeType'), 'Entity must have mimeType property');
      assert.ok(!colProps.includes('originalFilename'), 'Entity must NOT have originalFilename property');
      assert.ok(!colProps.includes('fileSize'), 'Entity must NOT have fileSize property');
      assert.ok(!colProps.includes('sha256'), 'Entity must NOT have sha256 property');

      // Verify saving a stored file with exact properties succeeds on live DB
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const created = await templateService.createTemplate({ name: 'قالب التحقق من خصائص الملف F1', isActive: true });
      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-f1.pdf`;

      const saved = await storedFileRepo.save(
        storedFileRepo.create({
          id: fileId,
          templateId: created.id,
          originalFileName: 'f1.pdf',
          storageKey,
          sizeBytes: 1024,
          mimeType: 'application/pdf',
          createdByUserId: null,
        })
      );
      assert.strictEqual(saved.originalFileName, 'f1.pdf');
      assert.strictEqual(Number(saved.sizeBytes), 1024);
      assert.strictEqual(saved.storageKey, storageKey);
    });

    it('Test F2 — Expired lease before pre-unlink check', async () => {
      // Re-verifies A-T1b contract: a worker losing claim before pre-unlink returns false and cannot delete
      const created = await templateService.createTemplate({ name: 'قالب التحقق F2 انتهاء العقد قبل التحقق', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-f2.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'f2-content');

      try {
        const stored = await storedFileRepo.save(
          storedFileRepo.create({
            id: fileId,
            templateId: created.id,
            originalFileName: 'f2.pdf',
            storageKey,
            sizeBytes: 10,
            mimeType: 'application/pdf',
            deletedAt: new Date(),
          })
        );

        const queueItem = await cleanupRepo.save(
          cleanupRepo.create({
            id: crypto.randomUUID(),
            fileId: stored.id,
            storageKey: stored.storageKey,
            status: FileCleanupStatus.PENDING,
            attempts: 0,
          })
        );

        let reachedBarrier!: () => void;
        const barrierPromise = new Promise<void>((resolve) => {
          reachedBarrier = resolve;
        });
        let canProceed!: () => void;
        const proceedPromise = new Promise<void>((resolve) => {
          canProceed = resolve;
        });

        sharedFileService._testPreUnlinkBarrier = async () => {
          reachedBarrier();
          await proceedPromise;
        };

        const workerAPromise = sharedFileService.executeCleanupTask(queueItem.id, false);
        await barrierPromise;

        // Expire lease
        await cleanupRepo.update(queueItem.id, {
          claimExpiresAt: new Date(Date.now() - 60 * 1000),
        });

        // Worker B steals and completes
        sharedFileService._testPreUnlinkBarrier = undefined;
        const resB = await sharedFileService.executeCleanupTask(queueItem.id, false);
        assert.strictEqual(resB, true);

        // Resume Worker A -> must fail pre-unlink
        canProceed();
        const resA = await workerAPromise;
        assert.strictEqual(resA, false, 'Worker A must fail pre-unlink check due to expired claim');

        const queueFinal = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueFinal.status, FileCleanupStatus.COMPLETED);
      } finally {
        sharedFileService._testPreUnlinkBarrier = undefined;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    it('Test F3 — Expired lease after pre-unlink check', async () => {
      // Re-verifies A-T1 contract: Worker A pauses at physical delete, Worker B completes task,
      // Worker A physical delete executes idempotently without crashing or altering Worker B's completion state
      const created = await templateService.createTemplate({ name: 'قالب التحقق F3 انتهاء العقد بعد التحقق', isActive: true });
      const storedFileRepo = AppDataSource.getRepository(ProductionTemplateStoredFileEntity);
      const cleanupRepo = AppDataSource.getRepository(ProductionTemplateFileCleanupQueueEntity);

      const fileId = crypto.randomUUID();
      const storageKey = `storage/template-stage-attachments/${Date.now()}-f3.pdf`;
      const fullPath = path.resolve(process.cwd(), storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'f3-content');

      const originalDelete = productionTemplateReferenceFileStorageService.deleteStoredFile;
      try {
        const stored = await storedFileRepo.save(
          storedFileRepo.create({
            id: fileId,
            templateId: created.id,
            originalFileName: 'f3.pdf',
            storageKey,
            sizeBytes: 10,
            mimeType: 'application/pdf',
            deletedAt: new Date(),
          })
        );

        const queueItem = await cleanupRepo.save(
          cleanupRepo.create({
            id: crypto.randomUUID(),
            fileId: stored.id,
            storageKey: stored.storageKey,
            status: FileCleanupStatus.PENDING,
            attempts: 0,
          })
        );

        let reachedDelete!: () => void;
        const deleteBarrier = new Promise<void>((resolve) => {
          reachedDelete = resolve;
        });
        let canDelete!: () => void;
        const deleteProceed = new Promise<void>((resolve) => {
          canDelete = resolve;
        });

        let callCount = 0;
        productionTemplateReferenceFileStorageService.deleteStoredFile = async (key) => {
          callCount++;
          if (callCount === 1) {
            reachedDelete();
            await deleteProceed;
          }
          return originalDelete.call(productionTemplateReferenceFileStorageService, key);
        };

        const workerAPromise = sharedFileService.executeCleanupTask(queueItem.id, false);
        await deleteBarrier;

        // Expire lease
        await cleanupRepo.update(queueItem.id, {
          claimExpiresAt: new Date(Date.now() - 60 * 1000),
        });

        // Worker B executes
        const resB = await sharedFileService.executeCleanupTask(queueItem.id, false);
        assert.strictEqual(resB, true);
        const queueAfterB = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueAfterB.status, FileCleanupStatus.COMPLETED);

        // Resume Worker A
        canDelete();
        const resA = await workerAPromise;
        assert.strictEqual(resA, false, 'Worker A must report false because its claim was lost in post-unlink check');

        const queueFinal = await cleanupRepo.findOneOrFail({ where: { id: queueItem.id } });
        assert.strictEqual(queueFinal.status, FileCleanupStatus.COMPLETED);
        assert.strictEqual(queueFinal.claimId, queueAfterB.claimId);
        assert.strictEqual(fs.existsSync(fullPath), false);
      } finally {
        productionTemplateReferenceFileStorageService.deleteStoredFile = originalDelete;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    });

    it('Test F4 — DECIMAL normalization accepts equivalent precision', () => {
      // Inputs: 12.5, 12.500000, 012.500000, 12.5000000
      assert.strictEqual(normalizeDecimal('12.5', 6), '12.500000');
      assert.strictEqual(normalizeDecimal('12.500000', 6), '12.500000');
      assert.strictEqual(normalizeDecimal('012.500000', 6), '12.500000');
      assert.strictEqual(normalizeDecimal('12.5000000', 6), '12.500000');

      // Equality checks
      assert.strictEqual(areDecimalQuantitiesEqual('12.5', '12.500000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual('012.500000', '12.5000000'), true);
      assert.strictEqual(areDecimalQuantitiesEqual('12.500001', '12.500000'), false);

      // validateAndNormalizePlannedQuantity checks
      assert.strictEqual(validateAndNormalizePlannedQuantity('12.5'), '12.500000');
      assert.strictEqual(validateAndNormalizePlannedQuantity('12.5000000'), '12.500000');
      assert.strictEqual(validateAndNormalizePlannedQuantity('012.500000'), '12.500000');
    });

    it('Test F5 — DECIMAL normalization rejects nonzero extra precision', () => {
      // Nonzero excess decimals
      assert.throws(
        () => normalizeDecimal('12.5000009', 6),
        (err: any) => err.code === 'DECIMAL_PRECISION_OVERFLOW'
      );
      assert.throws(
        () => normalizeDecimal('12.1234567', 6),
        (err: any) => err.code === 'DECIMAL_PRECISION_OVERFLOW'
      );

      // Non-numeric, NaN, Infinity, scientific notation
      assert.throws(
        () => normalizeDecimal('abc', 6),
        (err: any) => err.code === 'DECIMAL_FORMAT_INVALID'
      );
      assert.throws(
        () => normalizeDecimal('NaN', 6),
        (err: any) => err.code === 'DECIMAL_FORMAT_INVALID'
      );
      assert.throws(
        () => normalizeDecimal('Infinity', 6),
        (err: any) => err.code === 'DECIMAL_FORMAT_INVALID'
      );
      assert.throws(
        () => normalizeDecimal('1e3', 6),
        (err: any) => err.code === 'DECIMAL_FORMAT_INVALID'
      );

      // Integer digits overflow (>12 digits for DECIMAL(18,6))
      assert.throws(
        () => normalizeDecimal('1234567890123.5', 6),
        (err: any) => err.code === 'DECIMAL_INTEGER_OVERFLOW'
      );

      // areDecimalQuantitiesEqual rejects invalid decimal
      assert.throws(
        () => areDecimalQuantitiesEqual('12.5000009', '12.500000'),
        (err: any) => err.code === 'DECIMAL_PRECISION_OVERFLOW'
      );

      // validateAndNormalizePlannedQuantity rejects invalid / zero / negative
      assert.throws(
        () => validateAndNormalizePlannedQuantity('12.5000009'),
        (err: any) => err.code === 'DECIMAL_PRECISION_OVERFLOW'
      );
      assert.throws(
        () => validateAndNormalizePlannedQuantity('-1'),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID'
      );
      assert.throws(
        () => validateAndNormalizePlannedQuantity('0'),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID'
      );
      assert.throws(
        () => validateAndNormalizePlannedQuantity('0.000000'),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID'
      );
    });

    it('Test F6 — Material creation rejects invalid decimal', async () => {
      const prodRows: any[] = await AppDataSource.query(
        `SELECT p.id as productId, u.id as unitId 
         FROM inventory_product p 
         JOIN inventory_product_unit u ON u.product_id = p.id 
         WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND p.id = ? 
         LIMIT 1`,
        [materialTestProductId]
      );
      assert.ok(prodRows.length > 0, 'Must have at least 1 product and unit for material testing');
      const { productId, unitId } = prodRows[0];

      const created = await templateService.createTemplate({ name: 'قالب التحقق F6 رفض الكميات العشرية', isActive: true });
      const v1 = await versionService.getLatestVersion(created.id);
      let rev = await getRevision(created.id, v1.id);

      const setupCommit = await editingService.commitEditingSession(
        created.id,
        {
          baseVersionId: v1.id,
          baseRevision: rev,
          commitDecision: 'AUTO',
          operations: [
            { type: 'ADD_STAGE', tempClientId: 'stg-f6', payload: { name: 'مرحلة F6', departmentId: testDepartmentId } },
            { type: 'ADD_PATTERN', tempClientId: 'pat-f6', payload: { name: 'نمط F6' } },
            { type: 'ADD_OPTION', parentId: 'pat-f6', tempClientId: 'opt-f6', payload: { name: 'خيار F6' } },
            { type: 'ADD_TASK', parentId: 'opt-f6', tempClientId: 'tsk-f6', payload: { name: 'مهمة F6', departmentId: testDepartmentId } },
          ],
        },
        testUserId
      );

      const stgId = setupCommit.tempClientMap['stg-f6'];
      const tskId = setupCommit.tempClientMap['tsk-f6'];
      const vLatest = await versionService.getLatestVersion(created.id);
      rev = await getRevision(created.id, vLatest.id);

      // 1. ADD_STAGE_MATERIAL with non-zero excess decimal: 12.5000009
      await assert.rejects(
        async () => {
          await editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE_MATERIAL',
                  parentId: stgId,
                  payload: {
                    productId,
                    productUnitId: unitId,
                    plannedQuantity: '12.5000009',
                  },
                },
              ],
            },
            testUserId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'DECIMAL_PRECISION_OVERFLOW');
          return true;
        }
      );

      // 2. ADD_STAGE_MATERIAL with negative quantity: -5
      await assert.rejects(
        async () => {
          await editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE_MATERIAL',
                  parentId: stgId,
                  payload: {
                    productId,
                    productUnitId: unitId,
                    plannedQuantity: '-5',
                  },
                },
              ],
            },
            testUserId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID');
          return true;
        }
      );

      // 3. ADD_STAGE_MATERIAL with zero quantity: 0
      await assert.rejects(
        async () => {
          await editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_STAGE_MATERIAL',
                  parentId: stgId,
                  payload: {
                    productId,
                    productUnitId: unitId,
                    plannedQuantity: '0',
                  },
                },
              ],
            },
            testUserId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID');
          return true;
        }
      );

      // 4. ADD_TASK_MATERIAL with excess decimal: 12.1234567
      await assert.rejects(
        async () => {
          await editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_TASK_MATERIAL',
                  parentId: tskId,
                  payload: {
                    productId,
                    productUnitId: unitId,
                    plannedQuantity: '12.1234567',
                  },
                },
              ],
            },
            testUserId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'DECIMAL_PRECISION_OVERFLOW');
          return true;
        }
      );

      // 5. ADD_TASK_MATERIAL with negative quantity: -1
      await assert.rejects(
        async () => {
          await editingService.commitEditingSession(
            created.id,
            {
              baseVersionId: vLatest.id,
              baseRevision: rev,
              commitDecision: 'AUTO',
              operations: [
                {
                  type: 'ADD_TASK_MATERIAL',
                  parentId: tskId,
                  payload: {
                    productId,
                    productUnitId: unitId,
                    plannedQuantity: '-1',
                  },
                },
              ],
            },
            testUserId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_MATERIAL_QUANTITY_INVALID');
          return true;
        }
      );

      // Verify no rows saved in MySQL
      const stageMatRepo = AppDataSource.getRepository(ProductionTemplateStageMaterialEntity);
      const taskMatRepo = AppDataSource.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
      const stageCount = await stageMatRepo.count({ where: { stageId: stgId } });
      const taskCount = await taskMatRepo.count({ where: { taskId: tskId } });
      assert.strictEqual(stageCount, 0, 'No stage materials must be saved for rejected quantities');
      assert.strictEqual(taskCount, 0, 'No task materials must be saved for rejected quantities');
    });

    it('Test F7 — Indexes are present without unnecessary duplicates', async () => {
      const tables = [
        'production_template_version',
        'production_template_stage',
        'production_template_pattern',
        'production_template_workflow_item',
        'production_template_pattern_option',
        'production_template_pattern_option_task',
        'production_order_line',
      ];

      for (const table of tables) {
        const stats: any[] = await AppDataSource.query(
          `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
           FROM information_schema.STATISTICS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? 
           ORDER BY INDEX_NAME, SEQ_IN_INDEX ASC`,
          [table]
        );

        assert.ok(stats.length > 0, `Table ${table} must have indexes`);
        const indexMap: Record<string, string[]> = {};
        for (const row of stats) {
          if (!indexMap[row.INDEX_NAME]) {
            indexMap[row.INDEX_NAME] = [];
          }
          indexMap[row.INDEX_NAME].push(row.COLUMN_NAME.toLowerCase());
        }

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

    it('Test F8 — Migration compatibility', async () => {
      // 1. Verify Migration 27 is recorded in migrations table
      const migrationRows: any[] = await AppDataSource.query(
        `SELECT * FROM migrations WHERE name LIKE '%OptimizeProductionTemplateVersioningIndexes%'`
      );
      assert.ok(migrationRows.length > 0, 'Migration 27 must be recorded in migrations table');

      // 2. Verify request_hash and user_id exist in production_template_editing_idempotency
      const columns: any[] = await AppDataSource.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'production_template_editing_idempotency' 
           AND COLUMN_NAME IN ('request_hash', 'user_id')`
      );
      const colMap = new Map(columns.map((c) => [c.COLUMN_NAME, c]));
      assert.ok(colMap.has('request_hash'), 'request_hash column must exist');
      assert.ok(colMap.has('user_id'), 'user_id column must exist');

      // 3. Verify Foreign Key constraint FK_template_editing_idempotency_user
      const fks: any[] = await AppDataSource.query(
        `SELECT CONSTRAINT_NAME 
         FROM information_schema.TABLE_CONSTRAINTS 
         WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'production_template_editing_idempotency' 
           AND CONSTRAINT_TYPE = 'FOREIGN KEY' 
           AND CONSTRAINT_NAME = 'FK_template_editing_idempotency_user'`
      );
      assert.ok(fks.length > 0, 'FK_template_editing_idempotency_user must exist');
    });

    it('Test F9 — Existing database migration compatibility', async () => {
      // Verify all entities metadata match database columns without discrepancies
      const idempotencyMeta = AppDataSource.getMetadata(ProductionTemplateEditingIdempotencyEntity);
      const dbColumns: any[] = await AppDataSource.query(
        `SELECT COLUMN_NAME 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'production_template_editing_idempotency'`
      );
      const dbColNames = new Set(dbColumns.map((c) => c.COLUMN_NAME.toLowerCase()));
      for (const col of idempotencyMeta.columns) {
        assert.ok(
          dbColNames.has(col.databaseName.toLowerCase()),
          `Database must have column ${col.databaseName} for entity property ${col.propertyName}`
        );
      }
    });
  });
});
