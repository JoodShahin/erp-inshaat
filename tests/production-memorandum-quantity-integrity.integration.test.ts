import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { ProductionOrderEntity, ProductionOrderStatus } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplatePatternEntity } from '../src/modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../src/modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { ProductionUnitEventEntity } from '../src/modules/production/unit/production-unit-event.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import {
  ProductionOrderLineAllocationService,
  InternalTrustedContext,
} from '../src/modules/production/order-line/production-order-line-allocation.service.js';
import { hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { ForbiddenError } from '../src/common/errors/forbidden.error.js';
import { In, Not } from 'typeorm';

describe('Real MySQL Integration Tests: Memorandum Line Quantity Integrity & Concurrency Lock', () => {
  let testUserId: string;
  let testTemplateId: string;
  let testPatternId: string;
  let testOptSteelId: string;
  let testOptWoodId: string;
  let testStandardConfigHash: string;
  let testWoodConfigHash: string;
  let testInternalContext: InternalTrustedContext;

  let allocationService: ProductionOrderLineAllocationService;

  const createdOrderIds: string[] = [];
  const createdUnitIds: string[] = [];

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(UserEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
    const patternRepo = AppDataSource.getRepository(ProductionTemplatePatternEntity);
    const optRepo = AppDataSource.getRepository(ProductionTemplatePatternOptionEntity);

    const users = await userRepo.find({ take: 1 });
    if (users.length === 0) {
      throw new Error('No system users found in database for integration test');
    }
    testUserId = users[0].id;
    testInternalContext = {
      isInternalTrusted: true,
      operatorUserId: testUserId,
      reason: 'MySQL Integration Test',
    };

    // Create persistent test template & patterns
    testTemplateId = randomUUID();
    await tmplRepo.save(
      tmplRepo.create({
        id: testTemplateId,
        name: 'قالب تكامل سلامة الكميات',
        code: `TMPL-QTY-${Date.now().toString().slice(-4)}`,
        referenceNumber: 'REF-QTY',
        isActive: true,
      })
    );

    testPatternId = randomUUID();
    await patternRepo.save(
      patternRepo.create({
        id: testPatternId,
        templateId: testTemplateId,
        name: 'نوع الباب',
        code: `PAT-DOOR-${Date.now().toString().slice(-4)}`,
        sortOrder: 1,
      })
    );

    testOptSteelId = randomUUID();
    await optRepo.save(
      optRepo.create({
        id: testOptSteelId,
        patternId: testPatternId,
        name: 'باب حديد مصفح',
        code: 'OPT-STEEL',
        sortOrder: 1,
      })
    );

    testOptWoodId = randomUUID();
    await optRepo.save(
      optRepo.create({
        id: testOptWoodId,
        patternId: testPatternId,
        name: 'باب خشب زان',
        code: 'OPT-WOOD',
        sortOrder: 2,
      })
    );

    testStandardConfigHash = hashLineConfiguration(testTemplateId, [
      { templatePatternId: testPatternId, selectedOptionId: testOptSteelId },
    ]);
    testWoodConfigHash = hashLineConfiguration(testTemplateId, [
      { templatePatternId: testPatternId, selectedOptionId: testOptWoodId },
    ]);

    allocationService = new ProductionOrderLineAllocationService(AppDataSource);
  });

  after(async () => {
    try {
      if (AppDataSource.isInitialized) {
        const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
        const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
        const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
        const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
        const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);
        const optRepo = AppDataSource.getRepository(ProductionTemplatePatternOptionEntity);
        const patternRepo = AppDataSource.getRepository(ProductionTemplatePatternEntity);
        const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);

        if (createdOrderIds.length > 0) {
          const units = await unitRepo.find({ where: { orderId: In(createdOrderIds) } });
          for (const u of units) {
            if (!createdUnitIds.includes(u.id)) {
              createdUnitIds.push(u.id);
            }
          }
        }

        if (createdUnitIds.length > 0) {
          await eventRepo.delete({ unitId: In(createdUnitIds) });
          await unitRepo.delete({ id: In(createdUnitIds) });
        }

        if (createdOrderIds.length > 0) {
          await planRepo.delete({ orderId: In(createdOrderIds) });
          await lineRepo.delete({ orderId: In(createdOrderIds) });
          await orderRepo.delete({ id: In(createdOrderIds) });
        }

        await optRepo.delete({ id: In([testOptSteelId, testOptWoodId]) });
        await patternRepo.delete({ id: testPatternId });
        await tmplRepo.delete({ id: testTemplateId });
      }
    } catch {
      // Ignore cleanup error
    } finally {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    }
  });

  // ==========================================
  // TEST 1: Concurrency Lock & Pessimistic Write Serialization (Mandatory Case 7)
  // ==========================================
  it('1. Concurrency Case 7: Requested: 10, Linked: 8. Two concurrent requests each attempting to allocate 2 units. Exactly ONE succeeds, ONE fails, DB holds exactly 10 units', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    // 1. Setup Approved Order with 1 Line (requested: 10)
    const orderId = randomUUID();
    createdOrderIds.push(orderId);
    await orderRepo.save(
      orderRepo.create({
        id: orderId,
        orderNumber: `PO-LOCK-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: testUserId,
        createdByUserId: testUserId,
      })
    );

    const lineId = randomUUID();
    await lineRepo.save(
      lineRepo.create({
        id: lineId,
        orderId,
        templateId: testTemplateId,
        quantity: 10,
        sortOrder: 1,
        activeConfigurationHash: testStandardConfigHash,
      })
    );

    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: lineId,
        templateId: testTemplateId,
        templateName: 'قالب تكامل',
        templateCode: 'TMPL-QTY',
        lineQuantity: 10,
        configurationHash: testStandardConfigHash,
      })
    );

    // 2. Populate 8 active units in MySQL
    for (let i = 1; i <= 8; i++) {
      const uid = randomUUID();
      createdUnitIds.push(uid);
      await unitRepo.save(
        unitRepo.create({
          id: uid,
          orderId,
          orderLineId: lineId,
          planId,
          unitSequence: i,
          unitNumber: `U-LOCK-${i}`,
          status: ProductionUnitStatus.CREATED,
          isCancelled: false,
        })
      );
    }

    // 3. Create 4 unallocated candidate units in MySQL (2 for Request A, 2 for Request B)
    const candA1 = randomUUID();
    const candA2 = randomUUID();
    const candB1 = randomUUID();
    const candB2 = randomUUID();
    createdUnitIds.push(candA1, candA2, candB1, candB2);

    for (const [idx, cid] of [candA1, candA2, candB1, candB2].entries()) {
      await unitRepo.save(
        unitRepo.create({
          id: cid,
          orderId: null,
          orderLineId: null,
          planId,
          unitSequence: 100 + idx + 1,
          unitNumber: `U-CAND-${idx + 1}`,
          status: ProductionUnitStatus.CREATED,
          isCancelled: false,
        })
      );
    }

    // Verify initial status: 10 requested, 8 linked, 2 remaining
    const initialStatus = await allocationService.getLineAllocationStatus(lineId);
    assert.equal(initialStatus.quantities.requestedQuantity, 10);
    assert.equal(initialStatus.quantities.linkedQuantity, 8);
    assert.equal(initialStatus.quantities.remainingQuantity, 2);

    // 4. Fire two concurrent requests simultaneously, each attempting to allocate 2 candidate units!
    const [resultA, resultB] = await Promise.allSettled([
      allocationService.allocateAndLinkUnits({
        orderLineId: lineId,
        candidateUnitIds: [candA1, candA2],
        currentUser: testInternalContext,
      }),
      allocationService.allocateAndLinkUnits({
        orderLineId: lineId,
        candidateUnitIds: [candB1, candB2],
        currentUser: testInternalContext,
      }),
    ]);

    const successes = [resultA, resultB].filter((r) => r.status === 'fulfilled');
    const failures = [resultA, resultB].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly one concurrent request must succeed');
    assert.equal(failures.length, 1, 'Exactly one concurrent request must be rejected');

    const rejectedReason: any = (failures[0] as PromiseRejectedResult).reason;
    assert.ok(rejectedReason instanceof BusinessRuleError);
    assert.equal(rejectedReason.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');

    // 5. Verify final MySQL state: exactly 10 active units exist for this line (never 12!)
    const finalLinkedCount = await unitRepo.count({
      where: {
        orderLineId: lineId,
        isCancelled: false,
        status: Not(ProductionUnitStatus.CANCELLED),
      },
    });
    assert.equal(finalLinkedCount, 10, 'MySQL state must hold exactly 10 units, perfectly serialized!');

    const finalStatus = await allocationService.getLineAllocationStatus(lineId);
    assert.equal(finalStatus.quantities.remainingQuantity, 0);
    assert.equal(finalStatus.quantities.excessQuantity, 0);
    assert.equal(finalStatus.quantities.hasQuantityViolation, false);
  });

  // ==========================================
  // TEST 2: Atomic Rollback on Batch Mismatch in MySQL
  // ==========================================
  it('2. Atomic Transaction in MySQL: Batch linking rolls back completely when one candidate unit has mismatched pattern', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    const orderId = randomUUID();
    createdOrderIds.push(orderId);
    await orderRepo.save(
      orderRepo.create({
        id: orderId,
        orderNumber: `PO-ROLLBACK-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: testUserId,
        createdByUserId: testUserId,
      })
    );

    const targetLineId = randomUUID();
    const otherLineId = randomUUID();

    await lineRepo.save([
      lineRepo.create({
        id: targetLineId,
        orderId,
        templateId: testTemplateId,
        quantity: 5,
        sortOrder: 1,
        activeConfigurationHash: testStandardConfigHash,
      }),
      lineRepo.create({
        id: otherLineId,
        orderId,
        templateId: testTemplateId,
        quantity: 1,
        sortOrder: 2,
        activeConfigurationHash: testWoodConfigHash,
      }),
    ]);

    // Matching plan for unit 1
    const matchingPlanId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: matchingPlanId,
        orderId,
        orderLineId: targetLineId,
        templateId: testTemplateId,
        templateName: 'قالب مطابق',
        templateCode: 'TMPL-MATCH',
        lineQuantity: 5,
        configurationHash: testStandardConfigHash,
      })
    );

    // Mismatched plan for unit 2 (wood door)
    const mismatchPlanId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: mismatchPlanId,
        orderId,
        orderLineId: otherLineId,
        templateId: testTemplateId,
        templateName: 'قالب غير مطابق',
        templateCode: 'TMPL-MISMATCH',
        lineQuantity: 1,
        configurationHash: testWoodConfigHash,
      })
    );

    const unit1Id = randomUUID();
    const unit2Id = randomUUID();
    createdUnitIds.push(unit1Id, unit2Id);

    // Candidate units created unallocated (orderLineId: null)
    await unitRepo.save([
      unitRepo.create({
        id: unit1Id,
        orderId: null,
        orderLineId: null,
        planId: matchingPlanId,
        unitSequence: 201,
        unitNumber: 'U-MATCH',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
      }),
      unitRepo.create({
        id: unit2Id,
        orderId: null,
        orderLineId: null,
        planId: mismatchPlanId,
        unitSequence: 202,
        unitNumber: 'U-MISMATCH',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
      }),
    ]);

    // Attempt batch linking: unit 1 matches standard hash, but unit 2 matches wood hash -> Must fail closed!
    await assert.rejects(
      async () => {
        await allocationService.allocateAndLinkUnits({
          orderLineId: targetLineId,
          candidateUnitIds: [unit1Id, unit2Id],
          currentUser: testInternalContext,
        });
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_UNIT_PATTERN_MISMATCH');
        return true;
      }
    );

    // Verify atomic rollback in MySQL: 0 events created for this batch, units remain unallocated
    const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);
    const eventCount = await eventRepo.count({ where: { unitId: In([unit1Id, unit2Id]) } });
    assert.equal(eventCount, 0, 'No events must be persisted after rollback');

    const freshUnit1 = await unitRepo.findOne({ where: { id: unit1Id } });
    const freshUnit2 = await unitRepo.findOne({ where: { id: unit2Id } });
    assert.equal(freshUnit1?.orderLineId, null, 'Unit 1 link must have rolled back to null');
    assert.equal(freshUnit2?.orderLineId, null, 'Unit 2 link must have rolled back to null');
  });

  // ==========================================
  // TEST 3: Restore Cancelled Unit Enforces Line Limit in MySQL
  // ==========================================
  it('3. Restore in MySQL: Cancelled unit cannot be restored when line has 0 vacancy (2/2)', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    const orderId = randomUUID();
    createdOrderIds.push(orderId);
    await orderRepo.save(
      orderRepo.create({
        id: orderId,
        orderNumber: `PO-RESTORE-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: testUserId,
        createdByUserId: testUserId,
      })
    );

    const lineId = randomUUID();
    await lineRepo.save(
      lineRepo.create({
        id: lineId,
        orderId,
        templateId: testTemplateId,
        quantity: 2,
        sortOrder: 1,
        activeConfigurationHash: testStandardConfigHash,
      })
    );

    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: lineId,
        templateId: testTemplateId,
        templateName: 'قالب استعادة',
        templateCode: 'TMPL-RESTORE',
        lineQuantity: 2,
        configurationHash: testStandardConfigHash,
      })
    );

    // 2 active units (full capacity) + 1 cancelled unit
    const act1 = randomUUID();
    const act2 = randomUUID();
    const cancelledUnitId = randomUUID();
    createdUnitIds.push(act1, act2, cancelledUnitId);

    await unitRepo.save([
      unitRepo.create({
        id: act1,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 1,
        unitNumber: 'U-ACT-1',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
      }),
      unitRepo.create({
        id: act2,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 2,
        unitNumber: 'U-ACT-2',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
      }),
      unitRepo.create({
        id: cancelledUnitId,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 3,
        unitNumber: 'U-CANCELLED',
        status: ProductionUnitStatus.CANCELLED,
        isCancelled: true,
        cancellationReason: 'Defect in concrete casting',
      }),
    ]);

    // Attempting to restore cancelled unit when line is full (2/2) -> Must fail closed
    await assert.rejects(
      async () => {
        await allocationService.restoreCancelledUnit({
          orderLineId: lineId,
          unitId: cancelledUnitId,
          currentUser: testInternalContext,
          reason: 'Repair attempted',
        });
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_UNIT_RESTORE_QUANTITY_EXCEEDED');
        return true;
      }
    );

    // Verify unit remains cancelled in MySQL
    const freshCancelled = await unitRepo.findOne({ where: { id: cancelledUnitId } });
    assert.equal(freshCancelled?.isCancelled, true);
    assert.equal(freshCancelled?.status, ProductionUnitStatus.CANCELLED);
  });

  // ==========================================
  // TEST 4: Authorization Fail-Closed in MySQL Integration
  // ==========================================
  it('4. Authorization in MySQL: Rejects unauthenticated request with AUTHENTICATION_REQUIRED', async () => {
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const lines = await lineRepo.find({ take: 1 });
    if (lines.length === 0) return;

    await assert.rejects(
      async () => {
        await allocationService.allocateAndLinkUnits({
          orderLineId: lines[0].id,
          candidateUnitIds: [randomUUID()],
          currentUser: null as any,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, 'AUTHENTICATION_REQUIRED');
        return true;
      }
    );
  });
});
