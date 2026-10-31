import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { ProductionOrderEntity, ProductionOrderStatus } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplateStageEntity } from '../src/modules/production/template-stage/production-template-stage.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../src/modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { ProductionYardEntity } from '../src/modules/production/yard/production-yard.entity.js';
import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionExecutionTaskEntity } from '../src/modules/production/execution-plan/production-execution-task.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { ProductionUnitEventEntity } from '../src/modules/production/unit/production-unit-event.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderGuardService } from '../src/modules/production/order/production-order-guard.service.js';
import { ProductionExecutionPlanService } from '../src/modules/production/execution-plan/production-execution-plan.service.js';
import { ProductionUnitService } from '../src/modules/production/unit/production-unit.service.js';
import { ProductionAccessPolicyService } from '../src/modules/production/authorization/production-access-policy.service.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { In } from 'typeorm';

describe('Phase 2.1 Real MySQL Integration Tests: Production Order Approval into Memorandum', () => {
  let testUserId: string;
  let testAltUserId: string;
  let testDeptId: string;
  let testYardId: string;
  let testTemplateId: string;
  let testStageId: string;
  let orderService: ProductionOrderService;

  const createdOrderIds: string[] = [];

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(UserEntity);
    const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);
    const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
    const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
    const wfRepo = AppDataSource.getRepository(ProductionTemplateWorkflowItemEntity);

    const existingUsers = await userRepo.find({ take: 2 });
    if (existingUsers.length === 0) {
      throw new Error('No system users found in database for integration test');
    }
    testUserId = existingUsers[0].id;
    testAltUserId = existingUsers.length > 1 ? existingUsers[1].id : existingUsers[0].id;

    testDeptId = randomUUID();
    await deptRepo.save(
      deptRepo.create({
        id: testDeptId,
        name: `قسم إنتاج مذكرة ${Date.now()}`,
        code: `DEPT-MEM-${Date.now().toString().slice(-4)}`,
        isActive: true,
      })
    );

    testYardId = randomUUID();
    await yardRepo.save(
      yardRepo.create({
        id: testYardId,
        departmentId: testDeptId,
        name: 'ساحة مذكرة الإنتاج',
        code: `YARD-MEM-${Date.now().toString().slice(-4)}`,
        capacity: 50,
        isActive: true,
      })
    );

    testTemplateId = randomUUID();
    await tmplRepo.save(
      tmplRepo.create({
        id: testTemplateId,
        name: 'قالب مذكرة إنتاج تكامل',
        code: `TMPL-MEM-${Date.now().toString().slice(-4)}`,
        referenceNumber: 'REF-MEM',
        isActive: true,
      })
    );

    testStageId = randomUUID();
    await stageRepo.save(
      stageRepo.create({
        id: testStageId,
        templateId: testTemplateId,
        name: 'مرحلة الصب تكامل',
        departmentId: testDeptId,
        sortOrder: 1,
        estimatedDurationMinutes: 60,
      })
    );

    await wfRepo.save(
      wfRepo.create({
        id: randomUUID(),
        templateId: testTemplateId,
        itemType: 'STAGE',
        stageId: testStageId,
        sortOrder: 1,
      })
    );

    const guardService = new ProductionOrderGuardService(AppDataSource);
    const mockAuthz: any = {
      getApplicableAccessRules: async () => [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    };
    const mockResolver: any = {
      resolve: async () => ({ isConsistent: true }),
    };
    const accessPolicyService = new ProductionAccessPolicyService(mockAuthz);
    const planService = new ProductionExecutionPlanService(AppDataSource, mockAuthz, accessPolicyService, mockResolver);
    const unitService = new ProductionUnitService(AppDataSource, mockAuthz, accessPolicyService, mockResolver);

    orderService = new ProductionOrderService(AppDataSource, guardService, planService, unitService);
  });

  after(async () => {
    try {
      if (AppDataSource.isInitialized) {
        const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
        const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
        const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
        const taskRepo = AppDataSource.getRepository(ProductionExecutionTaskEntity);
        const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
        const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);
        const wfRepo = AppDataSource.getRepository(ProductionTemplateWorkflowItemEntity);
        const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
        const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
        const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
        const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);

        if (createdOrderIds.length > 0) {
          const units = await unitRepo.find({ where: { orderId: In(createdOrderIds) } });
          if (units.length > 0) {
            await eventRepo.delete({ unitId: In(units.map((u) => u.id)) });
          }
          await unitRepo.delete({ orderId: In(createdOrderIds) });
          const plans = await planRepo.find({ where: { orderId: In(createdOrderIds) } });
          if (plans.length > 0) {
            await taskRepo.delete({ planId: In(plans.map((p) => p.id)) });
          }
          await planRepo.delete({ orderId: In(createdOrderIds) });
          await lineRepo.delete({ orderId: In(createdOrderIds) });
          await orderRepo.delete({ id: In(createdOrderIds) });
        }

        await wfRepo.delete({ templateId: testTemplateId });
        await stageRepo.delete({ templateId: testTemplateId });
        await tmplRepo.delete({ id: testTemplateId });
        await yardRepo.delete({ id: testYardId });
        await deptRepo.delete({ id: testDeptId });
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
  // 1. MySQL Memorandum Approval Verification
  // ==========================================
  it('1. Approves draft order in MySQL as memorandum: transitions to APPROVED without creating plans, tasks, units, or events', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);

    const created = await orderService.createOrder({ description: 'Order for memorandum approval' }, testUserId);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 4 });

    const approvedDto = await orderService.approveOrder(orderId, testUserId);

    // 1. DTO verification
    assert.equal(approvedDto.status, ProductionOrderStatus.APPROVED);
    assert.equal(approvedDto.approvedByUserId, testUserId);
    assert.ok(approvedDto.approvedAt);
    assert.equal(approvedDto.hasExecutionPlans, false);
    assert.equal(approvedDto.summary.totalQuantity, 4);
    assert.equal(approvedDto.summary.totalLinkedQuantity, 0);
    assert.equal(approvedDto.summary.totalRemainingQuantity, 4);

    // 2. MySQL Row verification
    const orderRow = await orderRepo.findOne({ where: { id: orderId } });
    assert.equal(orderRow?.status, ProductionOrderStatus.APPROVED);
    assert.equal(orderRow?.approvedByUserId, testUserId);
    assert.ok(orderRow?.approvedAt);

    // 3. MySQL 0 Execution Entities verification
    const planCount = await planRepo.count({ where: { orderId } });
    assert.equal(planCount, 0, 'Must have zero execution plans in MySQL');

    const unitCount = await unitRepo.count({ where: { orderId } });
    assert.equal(unitCount, 0, 'Must have zero production units in MySQL');
  });

  // ==========================================
  // 2. MySQL Quantity Tracking with Historical Units
  // ==========================================
  it('2. Quantities in MySQL: computes linkedQuantity and remainingQuantity from actual units and excludes cancelled units', async () => {
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    const created = await orderService.createOrder({ description: 'Order for quantity tracking' }, testUserId);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    const line = await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 5 });
    await orderService.approveOrder(orderId, testUserId);

    // Create a dummy planId to satisfy foreign key constraint on unit table
    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: line.id,
        templateId: testTemplateId,
        templateName: 'قالب',
        templateCode: 'TMPL-01',
        lineQuantity: 5,
        configurationHash: 'hash-test-quantities',
      })
    );

    // Insert 2 active units and 1 cancelled unit directly into MySQL
    await unitRepo.save([
      unitRepo.create({
        id: randomUUID(),
        orderId,
        orderLineId: line.id,
        planId,
        unitSequence: 1,
        unitNumber: 'PO-MEM-U001',
        status: ProductionUnitStatus.IN_PROGRESS,
        isCancelled: false,
      }),
      unitRepo.create({
        id: randomUUID(),
        orderId,
        orderLineId: line.id,
        planId,
        unitSequence: 2,
        unitNumber: 'PO-MEM-U002',
        status: ProductionUnitStatus.COMPLETED,
        isCancelled: false,
      }),
      unitRepo.create({
        id: randomUUID(),
        orderId,
        orderLineId: line.id,
        planId,
        unitSequence: 3,
        unitNumber: 'PO-MEM-U003',
        status: ProductionUnitStatus.CANCELLED,
        isCancelled: true,
      }),
    ]);

    const orderDetail = await orderService.getOrderById(orderId);
    const lineDetail = orderDetail.lines![0];

    assert.equal(lineDetail.requestedQuantity, 5);
    assert.equal(lineDetail.linkedQuantity, 2, 'Must count only the 2 non-cancelled units');
    assert.equal(lineDetail.remainingQuantity, 3, '5 - 2 = 3 remaining units');
    assert.equal(orderDetail.summary.totalQuantity, 5);
    assert.equal(orderDetail.summary.totalLinkedQuantity, 2);
    assert.equal(orderDetail.summary.totalRemainingQuantity, 3);
  });

  // ==========================================
  // 3. MySQL Reopen Safety
  // ==========================================
  it('3. Reopening in MySQL: succeeds when units/plans = 0, but is rejected when units exist', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    const created = await orderService.createOrder({ description: 'Order for reopen testing' }, testUserId);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    const line = await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 2 });
    await orderService.approveOrder(orderId, testUserId);

    // 1. Reopen approved order with 0 units/plans -> Must succeed
    const reopened = await orderService.reopenOrder(orderId, testUserId);
    assert.equal(reopened.status, ProductionOrderStatus.DRAFT);
    assert.equal(reopened.approvedAt, null);
    assert.equal(reopened.approvedByUserId, null);

    const orderRowAfterReopen = await orderRepo.findOne({ where: { id: orderId } });
    assert.equal(orderRowAfterReopen?.status, ProductionOrderStatus.DRAFT);
    assert.equal(orderRowAfterReopen?.approvedAt, null);
    assert.equal(orderRowAfterReopen?.approvedByUserId, null);

    // Re-approve order
    await orderService.approveOrder(orderId, testUserId);

    // Create a plan and unit
    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: line.id,
        templateId: testTemplateId,
        templateName: 'قالب',
        templateCode: 'TMPL-01',
        lineQuantity: 2,
        configurationHash: 'hash-test-reopen',
      })
    );

    await unitRepo.save(
      unitRepo.create({
        id: randomUUID(),
        orderId,
        orderLineId: line.id,
        planId,
        unitSequence: 1,
        unitNumber: 'PO-REOPEN-U001',
        status: ProductionUnitStatus.CREATED,
      })
    );

    // 2. Reopen order with units attached -> Must fail closed
    await assert.rejects(
      async () => {
        await orderService.reopenOrder(orderId, testUserId);
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_ORDER_HAS_EXECUTION_PLANS');
        return true;
      }
    );

    const orderRowAfterBlockedReopen = await orderRepo.findOne({ where: { id: orderId } });
    assert.equal(orderRowAfterBlockedReopen?.status, ProductionOrderStatus.APPROVED, 'Status must remain APPROVED');
  });

  // ==========================================
  // 4. MySQL Concurrency Pessimistic Write Serialization
  // ==========================================
  it('4. Concurrency in MySQL: two concurrent approvals serialize through pessimistic lock; one succeeds and one fails', async () => {
    const created = await orderService.createOrder({ description: 'Testing concurrent approvals in MySQL' }, testUserId);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 2 });

    const [res1, res2] = await Promise.allSettled([
      orderService.approveOrder(orderId, testUserId),
      orderService.approveOrder(orderId, testAltUserId),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly one approval must succeed');
    assert.equal(failures.length, 1, 'Exactly one approval must fail due to lock & status guard');

    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const orderRow = await orderRepo.findOne({ where: { id: orderId } });
    assert.equal(orderRow?.status, ProductionOrderStatus.APPROVED);
  });
});
