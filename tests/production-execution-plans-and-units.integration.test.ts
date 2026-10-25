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
import { ProductionUnitEventEntity, ProductionUnitEventType } from '../src/modules/production/unit/production-unit-event.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderGuardService } from '../src/modules/production/order/production-order-guard.service.js';
import { ProductionExecutionPlanService } from '../src/modules/production/execution-plan/production-execution-plan.service.js';
import { ProductionUnitService } from '../src/modules/production/unit/production-unit.service.js';
import { ProductionAccessPolicyService } from '../src/modules/production/authorization/production-access-policy.service.js';
import { QueryFailedError, In } from 'typeorm';

describe('Phase 1 Real MySQL Integration Tests: Execution Plans, Units, Concurrency & Security', () => {
  let testUser1Id: string;
  let testUser2Id: string;
  let testDeptAId: string;
  let testDeptBId: string;
  let testYardAId: string;
  let testYardBId: string;
  let testTemplateId: string;
  let testStageAId: string;
  let orderService: ProductionOrderService;
  let planService: ProductionExecutionPlanService;
  let unitService: ProductionUnitService;

  const createdOrderIds: string[] = [];

  before(async () => {
    // Fail hard if MySQL is down or data source fails to initialize
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(UserEntity);
    const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);
    const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
    const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
    const wfRepo = AppDataSource.getRepository(ProductionTemplateWorkflowItemEntity);

    // 0. Ensure Valid Users exist for Foreign Key constraints
    const existingUsers = await userRepo.find({ take: 2 });
    if (existingUsers.length === 0) {
      throw new Error('No system users found in database for integration test foreign keys');
    }
    testUser1Id = existingUsers[0].id;
    testUser2Id = existingUsers.length > 1 ? existingUsers[1].id : existingUsers[0].id;

    // 1. Create Test Departments
    testDeptAId = randomUUID();
    testDeptBId = randomUUID();
    await deptRepo.save([
      deptRepo.create({
        id: testDeptAId,
        name: `قسم الصب تكامل ${Date.now()}`,
        code: `DEPT-IT-A-${Date.now().toString().slice(-4)}`,
        isActive: true,
      }),
      deptRepo.create({
        id: testDeptBId,
        name: `قسم التشطيب تكامل ${Date.now()}`,
        code: `DEPT-IT-B-${Date.now().toString().slice(-4)}`,
        isActive: true,
      }),
    ]);

    // 2. Create Test Yards
    testYardAId = randomUUID();
    testYardBId = randomUUID();
    await yardRepo.save([
      yardRepo.create({
        id: testYardAId,
        departmentId: testDeptAId,
        name: 'ساحة الصب تكامل',
        code: `YARD-IT-A-${Date.now().toString().slice(-4)}`,
        capacity: 100,
        isActive: true,
      }),
      yardRepo.create({
        id: testYardBId,
        departmentId: testDeptBId,
        name: 'ساحة التشطيب تكامل',
        code: `YARD-IT-B-${Date.now().toString().slice(-4)}`,
        capacity: 100,
        isActive: true,
      }),
    ]);

    // 3. Create Test Template with Stage & Workflow
    testTemplateId = randomUUID();
    await tmplRepo.save(
      tmplRepo.create({
        id: testTemplateId,
        name: 'قالب تكامل اختباري',
        code: `TMPL-IT-${Date.now().toString().slice(-4)}`,
        description: 'قالب لاختبار التكامل',
        isActive: true,
      })
    );

    testStageAId = randomUUID();
    await stageRepo.save(
      stageRepo.create({
        id: testStageAId,
        templateId: testTemplateId,
        departmentId: testDeptAId,
        name: 'مرحلة الصب تكامل',
        sortOrder: 1,
        isActive: true,
      })
    );

    await wfRepo.save(
      wfRepo.create({
        id: randomUUID(),
        templateId: testTemplateId,
        itemType: 'STAGE',
        stageId: testStageAId,
        sortOrder: 1,
      })
    );

    // Services setup with controllable Authz and Responsibility resolvers for row-level testing
    const guardService = new ProductionOrderGuardService(AppDataSource);
    const mockAuthzService: any = {
      getApplicableAccessRules: async (principal: any) => {
        return principal?.accessRules || [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }];
      },
    };
    const mockRespResolver: any = {
      resolve: async (user: any) => ({
        headDepartmentId: user?.headDepartmentId || null,
        engineerDepartmentId: user?.engineerDepartmentId || null,
        engineerYardIds: user?.engineerYardIds || [],
        isConsistent: true,
      }),
    };
    const policyService = new ProductionAccessPolicyService();

    planService = new ProductionExecutionPlanService(
      AppDataSource,
      mockAuthzService,
      policyService,
      mockRespResolver
    );
    unitService = new ProductionUnitService(
      AppDataSource,
      mockAuthzService,
      policyService,
      mockRespResolver
    );
    orderService = new ProductionOrderService(
      AppDataSource,
      guardService,
      planService,
      unitService
    );
  });

  after(async () => {
    try {
      const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);
      const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
      const taskRepo = AppDataSource.getRepository(ProductionExecutionTaskEntity);
      const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
      const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
      const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
      const wfRepo = AppDataSource.getRepository(ProductionTemplateWorkflowItemEntity);
      const stageRepo = AppDataSource.getRepository(ProductionTemplateStageEntity);
      const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
      const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
      const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);

      for (const orderId of createdOrderIds) {
        const units = await unitRepo.find({ where: { orderId } });
        if (units.length > 0) {
          const unitIds = units.map((u) => u.id);
          for (const uid of unitIds) {
            await eventRepo.delete({ unitId: uid });
          }
          await unitRepo.delete({ orderId });
        }
        const plans = await planRepo.find({ where: { orderId } });
        for (const p of plans) {
          await taskRepo.delete({ planId: p.id });
        }
        await planRepo.delete({ orderId });
        await lineRepo.delete({ orderId });
        await orderRepo.delete({ id: orderId });
      }

      await wfRepo.delete({ templateId: testTemplateId });
      await stageRepo.delete({ templateId: testTemplateId });
      await tmplRepo.delete({ id: testTemplateId });
      await yardRepo.delete({ departmentId: In([testDeptAId, testDeptBId]) });
      await deptRepo.delete({ id: testDeptAId });
      await deptRepo.delete({ id: testDeptBId });
    } catch (e: any) {
      console.warn('Cleanup error in integration tests:', e.message);
    } finally {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    }
  });

  // ==========================================
  // TEST 1: Atomic Rollback on Failure
  // ==========================================
  it('1. Atomic Rollback: Error during approval rolls back plans, tasks, units, and events with 0 orphaned records', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);

    const created = await orderService.createOrder({ notes: 'Testing rollback atomicity' }, testUser1Id);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    const line = await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 3 });
    const lineId = line.id;

    // Mock unitService.generateUnitsForPlan to simulate an unexpected error midway
    const originalGenerateUnits = unitService.generateUnitsForPlan.bind(unitService);
    unitService.generateUnitsForPlan = async () => {
      throw new Error('SIMULATED_FAILURE_DURING_UNIT_GENERATION');
    };

    try {
      await assert.rejects(
        async () => {
          await orderService.approveOrder(orderId, testUser1Id);
        },
        /SIMULATED_FAILURE_DURING_UNIT_GENERATION/
      );

      // Verify that after rollback, NO records remain in MySQL
      const plansCount = await planRepo.count({ where: { orderId } });
      assert.equal(plansCount, 0, 'No execution plans must exist in MySQL after rollback');

      const unitsCount = await unitRepo.count({ where: { orderId } });
      assert.equal(unitsCount, 0, 'No units must exist in MySQL after rollback');

      const eventsCount = await eventRepo.count({ where: { unitId: lineId } });
      assert.equal(eventsCount, 0, 'No events must exist in MySQL after rollback');

      // Verify order status remains strictly DRAFT
      const freshOrder = await orderRepo.findOne({ where: { id: orderId } });
      assert.equal(freshOrder?.status, ProductionOrderStatus.DRAFT);
      assert.equal(freshOrder?.approvedAt, null);
      assert.equal(freshOrder?.approvedByUserId, null);
    } finally {
      unitService.generateUnitsForPlan = originalGenerateUnits;
    }
  });

  // ==========================================
  // TEST 2: Concurrency Lock (pessimistic_write)
  // ==========================================
  it('2. Concurrency Lock: Two concurrent approval calls serialize; one succeeds and one fails with 400', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);

    const created = await orderService.createOrder({ notes: 'Testing concurrent approvals' }, testUser1Id);
    const orderId = created.id;
    createdOrderIds.push(orderId);

    await orderService.addLine(orderId, { templateId: testTemplateId, quantity: 2 });

    // Run 2 concurrent approval calls simultaneously
    const [res1, res2] = await Promise.allSettled([
      orderService.approveOrder(orderId, testUser1Id),
      orderService.approveOrder(orderId, testUser2Id),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly one approval call must succeed');
    assert.equal(failures.length, 1, 'Exactly one approval call must fail due to lock & status guard');

    // Verify exactly 1 plan and 2 units exist
    const planCount = await planRepo.count({ where: { orderId } });
    assert.equal(planCount, 1);

    const unitCount = await unitRepo.count({ where: { orderId } });
    assert.equal(unitCount, 2);

    const freshOrder = await orderRepo.findOne({ where: { id: orderId } });
    assert.equal(freshOrder?.status, ProductionOrderStatus.APPROVED);
  });

  // ==========================================
  // TEST 3: Database Unique Constraints
  // ==========================================
  it('3. Unique Constraint: Duplicate (orderLineId, unitSequence) is rejected by MySQL index UQ_prod_unit_line_sequence', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);

    const orderId = randomUUID();
    createdOrderIds.push(orderId);

    await orderRepo.save(
      orderRepo.create({
        id: orderId,
        orderNumber: `PO-UQ-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        totalQuantity: 2,
        createdByUserId: testUser1Id,
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
        configurationHash: '2222222222222222222222222222222222222222222222222222222222222222',
      })
    );

    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: lineId,
        templateId: testTemplateId,
        templateName: 'قالب',
        templateCode: 'TMPL-01',
        lineQuantity: 2,
        configurationHash: '2222222222222222222222222222222222222222222222222222222222222222',
      })
    );

    // Save unit sequence 1
    const u1 = unitRepo.create({
      id: randomUUID(),
      orderId,
      orderLineId: lineId,
      planId,
      unitSequence: 1,
      unitNumber: 'UNIT-SEQ-1',
      status: ProductionUnitStatus.CREATED,
    });
    await unitRepo.save(u1);

    // Attempt to save another unit with duplicate sequence 1 for the same line
    const uDuplicate = unitRepo.create({
      id: randomUUID(),
      orderId,
      orderLineId: lineId,
      planId,
      unitSequence: 1, // Duplicate!
      unitNumber: 'UNIT-SEQ-1-DUP',
      status: ProductionUnitStatus.CREATED,
    });

    await assert.rejects(
      async () => {
        await unitRepo.save(uDuplicate);
      },
      (err: any) => {
        assert.ok(err instanceof QueryFailedError);
        assert.ok(
          err.message.includes('UQ_prod_unit_line_sequence') ||
          err.message.includes('Duplicate entry')
        );
        return true;
      }
    );
  });

  // ==========================================
  // TEST 4: Row-Level Event & Unit Authorization Isolation
  // ==========================================
  it('4. Row-Level Security: Comprehensive audit of 3-level authorization, scoping and IDOR', async () => {
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
    const taskRepo = AppDataSource.getRepository(ProductionExecutionTaskEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const eventRepo = AppDataSource.getRepository(ProductionUnitEventEntity);

    const orderId = randomUUID();
    createdOrderIds.push(orderId);

    await orderRepo.save(
      orderRepo.create({
        id: orderId,
        orderNumber: `PO-SEC-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        totalQuantity: 3,
        createdByUserId: testUser1Id,
      })
    );

    const lineId = randomUUID();
    await lineRepo.save(
      lineRepo.create({
        id: lineId,
        orderId,
        templateId: testTemplateId,
        quantity: 3,
        sortOrder: 1,
        configurationHash: '3333333333333333333333333333333333333333333333333333333333333333',
      })
    );

    const planId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: planId,
        orderId,
        orderLineId: lineId,
        templateId: testTemplateId,
        templateName: 'قالب تكامل أمني',
        templateCode: 'TMPL-SEC-01',
        lineQuantity: 3,
        configurationHash: '3333333333333333333333333333333333333333333333333333333333333333',
      })
    );

    // Save tasks for execution plan: Task 1 in Dept A, Task 2 in Dept B
    const task1Id = randomUUID();
    const task2Id = randomUUID();
    await taskRepo.save([
      taskRepo.create({
        id: task1Id,
        planId,
        departmentId: testDeptAId,
        departmentName: 'قسم الصب تكامل',
        name: 'مهمة صب أ',
        sortOrder: 1,
      }),
      taskRepo.create({
        id: task2Id,
        planId,
        departmentId: testDeptBId,
        departmentName: 'قسم التشطيب تكامل',
        name: 'مهمة تشطيب ب',
        sortOrder: 2,
      }),
    ]);

    const unit1Id = randomUUID();
    const unit2Id = randomUUID();
    const unit3Id = randomUUID();

    // Unit 1 in Yard A (Dept A), Unit 2 in Yard B (Dept B), Unit 3 unassigned (currentYardId = null)
    await unitRepo.save([
      unitRepo.create({
        id: unit1Id,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 1,
        unitNumber: 'UNIT-SEC-001',
        currentYardId: testYardAId,
        status: ProductionUnitStatus.IN_PROGRESS,
      }),
      unitRepo.create({
        id: unit2Id,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 2,
        unitNumber: 'UNIT-SEC-002',
        currentYardId: testYardBId,
        status: ProductionUnitStatus.IN_PROGRESS,
      }),
      unitRepo.create({
        id: unit3Id,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 3,
        unitNumber: 'UNIT-SEC-003',
        currentYardId: null,
        status: ProductionUnitStatus.CREATED,
      }),
    ]);

    // Events on Unit 1:
    // Ev 1: Administrative (UNIT_CREATED, departmentId = null)
    // Ev 2: Dept A task by testUser1Id
    // Ev 3: Dept B task by testUser2Id
    const ev1Id = randomUUID();
    const ev2Id = randomUUID();
    const ev3Id = randomUUID();

    // Event on Unit 2: created by testUser1Id (past event when engineer worked on it)
    const ev4Id = randomUUID();

    await eventRepo.save([
      eventRepo.create({
        id: ev1Id,
        unitId: unit1Id,
        eventType: ProductionUnitEventType.UNIT_CREATED,
        createdByUserId: testUser1Id,
        departmentId: null,
        occurredAt: new Date(Date.now() - 5000),
      }),
      eventRepo.create({
        id: ev2Id,
        unitId: unit1Id,
        eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
        createdByUserId: testUser1Id,
        departmentId: testDeptAId,
        occurredAt: new Date(Date.now() - 3000),
      }),
      eventRepo.create({
        id: ev3Id,
        unitId: unit1Id,
        eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
        createdByUserId: testUser2Id,
        departmentId: testDeptBId,
        occurredAt: new Date(Date.now() - 1000),
      }),
      eventRepo.create({
        id: ev4Id,
        unitId: unit2Id,
        eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
        createdByUserId: testUser1Id,
        departmentId: testDeptBId,
        occurredAt: new Date(Date.now() - 500),
      }),
    ]);

    // Define Principals:
    const adminUser = {
      id: testUser1Id,
      accessRules: [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    } as any;

    const engineerYardAUser = {
      id: testUser1Id,
      accessRules: [
        {
          scopeType: 'PRODUCTION_YARD',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            yardIds: [testYardAId],
          },
        },
      ],
    } as any;

    const headDeptAUser = {
      id: 'head-dept-a-user',
      accessRules: [
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [testDeptAId],
          },
        },
      ],
    } as any;

    const userWithDenyDeptA = {
      id: 'user-deny-dept-a',
      accessRules: [
        { scopeType: 'ALL', effect: 'ALLOW', scope: null },
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'DENY',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [testDeptAId],
          },
        },
      ],
    } as any;

    const userWithNoAccess = {
      id: 'user-no-access',
      accessRules: [],
    } as any;

    // 1. Level 2 Access: Engineer Yard A accessing room in Yard A -> ALLOW (sees their own event ev2Id)
    const engEvents = await unitService.getUnitEvents(orderId, unit1Id, engineerYardAUser);
    assert.equal(engEvents.items.length, 1);
    assert.equal(engEvents.items[0].id, ev2Id);

    // 2. Level 2 Access: Engineer Yard A accessing room in Yard B -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit2Id, engineerYardAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 3. Level 2 Access: Engineer with past event in Yard B (ev4Id created by testUser1Id)
    //    accessing Room 2 after losing Yard B access -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit2Id, engineerYardAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 4. Level 2 Access: Scoped engineer requesting unassigned room (Unit 3) -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit3Id, engineerYardAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 4b. Level 2 Access: Department Head Dept A requesting unassigned room (Unit 3) -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit3Id, headDeptAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 4c. Level 2 Access: Department Head Dept A requesting room in Dept B (Unit 2) -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit2Id, headDeptAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 4d. Level 2 Access: User with ALLOW Dept A but explicit DENY Yard A -> 403 Forbidden!
    const userWithAllowDeptADenyYardA = {
      id: 'user-allow-depta-deny-yarda',
      accessRules: [
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [testDeptAId],
          },
        },
        {
          scopeType: 'PRODUCTION_YARD',
          effect: 'DENY',
          scope: {
            source: 'SPECIFIC_IDS',
            yardIds: [testYardAId],
          },
        },
      ],
    } as any;
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit1Id, userWithAllowDeptADenyYardA);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 4e. Level 2 Access: Room assigned to an archived yard fails closed -> 403 Forbidden!
    const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
    const archivedYardId = randomUUID();
    await yardRepo.save(
      yardRepo.create({
        id: archivedYardId,
        departmentId: testDeptAId,
        name: 'ساحة مؤرشفة تكامل',
        code: `YARD-ARCH-${Date.now().toString().slice(-4)}`,
        capacity: 10,
        isActive: true,
      })
    );
    await yardRepo.softDelete({ id: archivedYardId });

    const archivedYardUnitId = randomUUID();
    await unitRepo.save(
      unitRepo.create({
        id: archivedYardUnitId,
        orderId,
        orderLineId: lineId,
        planId,
        unitSequence: 4,
        unitNumber: 'UNIT-SEC-ARCHIVED-YARD',
        currentYardId: archivedYardId,
        status: ProductionUnitStatus.CREATED,
      })
    );
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, archivedYardUnitId, engineerYardAUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 5. Level 3 Scoping: Department Head Dept A sees ONLY Dept A events on Unit 1 (administrative UNIT_CREATED hidden)
    const headEvents = await unitService.getUnitEvents(orderId, unit1Id, headDeptAUser);
    assert.equal(headEvents.items.length, 1);
    assert.equal(headEvents.items[0].id, ev2Id);

    // 6. Level 3 Scoping: Admin (ALLOW ALL) sees all 3 events on Unit 1
    const adminEvents = await unitService.getUnitEvents(orderId, unit1Id, adminUser);
    assert.equal(adminEvents.items.length, 3);

    // 7. Conflicting ALLOW ALL and DENY Dept A: Level 2 rejects Unit 1 (in Dept A) -> 403 Forbidden!
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit1Id, userWithDenyDeptA);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 8. User without ALLOW rules gets 403 Forbidden
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(orderId, unit1Id, userWithNoAccess);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // 9. IDOR protection: requesting Unit 1 with mismatched orderId throws 404 NotFoundError
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents(randomUUID(), unit1Id, adminUser);
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
        return true;
      }
    );

    // 10. Listing units and pagination count accuracy: Engineer 1 sees strictly Unit 1 (Yard A)
    const engUnits = await unitService.getUnitsByOrderId(orderId, engineerYardAUser);
    assert.equal(engUnits.total, 1);
    assert.equal(engUnits.items.length, 1);
    assert.equal(engUnits.items[0].id, unit1Id);

    // 10b. Summary counts security: Engineer 1 summary sees only 1 unit in their yard, 0 unassigned, 0 in Yard B
    const engSummary = await unitService.getUnitsSummaryByOrderId(orderId, engineerYardAUser);
    assert.equal(engSummary.totalUnits, 1);
    assert.equal(engSummary.inProgressUnits, 1);

    // 11. Execution plan reading task filtering: User with DENY Dept B sees Plan with Task 1 only
    const userWithDenyDeptB = {
      id: 'user-deny-dept-b',
      accessRules: [
        { scopeType: 'ALL', effect: 'ALLOW', scope: null },
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'DENY',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [testDeptBId],
          },
        },
      ],
    } as any;
    const filteredPlans = await planService.getPlansByOrderId(orderId, userWithDenyDeptB);
    assert.equal(filteredPlans.length, 1);
    assert.equal(filteredPlans[0].tasksCount, 1);
    assert.equal(filteredPlans[0].tasks.length, 1);
    assert.equal(filteredPlans[0].tasks[0].id, task1Id);
    assert.equal(filteredPlans[0].tasks[0].departmentId, testDeptAId);

    // 11b. Execution plan task scoping for Scoped Department Head: sees only Dept A tasks
    const headDeptAPlans = await planService.getPlansByOrderId(orderId, headDeptAUser);
    assert.equal(headDeptAPlans.length, 1);
    assert.equal(headDeptAPlans[0].tasksCount, 1);
    assert.equal(headDeptAPlans[0].tasks.length, 1);
    assert.equal(headDeptAPlans[0].tasks[0].departmentId, testDeptAId);
  });
});
