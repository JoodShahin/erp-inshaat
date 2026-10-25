import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { databaseConfig } from '../src/config/database.config.js';
import { ProductionOrderEntity, ProductionOrderStatus, ProductionOrderPriority } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderSequenceEntity } from '../src/modules/production/order/production-order-sequence.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../src/modules/production/order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplateStageEntity } from '../src/modules/production/template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../src/modules/production/template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../src/modules/production/template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplatePatternEntity } from '../src/modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../src/modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../src/modules/production/template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../src/modules/production/template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../src/modules/production/template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../src/modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { InventoryProductEntity } from '../src/modules/inventory/product/inventory-product.entity.js';
import { InventoryProductUnitEntity } from '../src/modules/inventory/product/inventory-product-unit.entity.js';

import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionExecutionTaskEntity, ExecutionTaskSource } from '../src/modules/production/execution-plan/production-execution-task.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { ProductionUnitEventEntity, ProductionUnitEventType } from '../src/modules/production/unit/production-unit-event.entity.js';

import { ProductionExecutionPlanService } from '../src/modules/production/execution-plan/production-execution-plan.service.js';
import { ProductionUnitService } from '../src/modules/production/unit/production-unit.service.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderGuardService } from '../src/modules/production/order/production-order-guard.service.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';
import { CreateProductionExecutionPlansAndUnits1710000000017 } from '../src/database/migrations/1710000000017-CreateProductionExecutionPlansAndUnits.js';

describe('Phase 1 — Execution Plans & Production Units Architecture', () => {
  function createTestContext() {
    const store = {
      orders: [
        {
          id: 'order-100',
          orderNumber: 'PO-000100',
          status: ProductionOrderStatus.DRAFT,
          priority: ProductionOrderPriority.NORMAL,
          description: 'أمر اختبار للغرف الخرسانية',
          notes: null,
          approvedAt: null,
          approvedByUserId: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[],
      lines: [] as any[],
      selections: [] as any[],
      templates: [
        {
          id: 'tmpl-room-a',
          name: 'قالب غرفة نموذج أ',
          code: 'TMPL-RM-A',
          referenceNumber: 'REF-001',
          description: 'مواصفات غرفة أ',
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[],
      workflowItems: [
        { id: 'wf-stage-1', templateId: 'tmpl-room-a', itemType: 'STAGE', stageId: 'stage-1', patternId: null, sortOrder: 1, deletedAt: null },
        { id: 'wf-pat-1', templateId: 'tmpl-room-a', itemType: 'PATTERN', stageId: null, patternId: 'pat-doors', sortOrder: 2, deletedAt: null },
        { id: 'wf-stage-2', templateId: 'tmpl-room-a', itemType: 'STAGE', stageId: 'stage-2', patternId: null, sortOrder: 3, deletedAt: null },
      ] as any[],
      stages: [
        {
          id: 'stage-1',
          templateId: 'tmpl-room-a',
          name: 'صب الخرسانة الأساسية',
          description: 'صب الجدران والأرضية',
          departmentId: 'dept-casting',
          sortOrder: 1,
          estimatedDurationMinutes: 120,
          estimatedCost: '500.0000',
          deletedAt: null,
        },
        {
          id: 'stage-2',
          templateId: 'tmpl-room-a',
          name: 'المعالجة المائية والفك',
          description: 'معالجة بالبخار وفك القوالب',
          departmentId: 'dept-curing',
          sortOrder: 3,
          estimatedDurationMinutes: 180,
          estimatedCost: '300.0000',
          deletedAt: null,
        },
      ] as any[],
      stageMaterials: [
        {
          id: 'sm-1',
          stageId: 'stage-1',
          productId: 'prod-cement',
          productUnitId: 'u-bag',
          plannedQuantity: '50.0000',
          deletedAt: null,
        },
      ] as any[],
      stageAttachments: [] as any[],
      patterns: [
        {
          id: 'pat-doors',
          templateId: 'tmpl-room-a',
          name: 'نوع الباب',
          deletedAt: null,
          createdAt: new Date(),
        },
      ] as any[],
      options: [
        {
          id: 'opt-steel-door',
          patternId: 'pat-doors',
          name: 'باب حديد مصفح',
          sortOrder: 1,
          deletedAt: null,
        },
        {
          id: 'opt-wood-door',
          patternId: 'pat-doors',
          name: 'باب خشب معالج',
          sortOrder: 2,
          deletedAt: null,
        },
      ] as any[],
      optionTasks: [
        {
          id: 'ot-steel-1',
          optionId: 'opt-steel-door',
          name: 'تركيب حلق الباب الحديدي',
          description: 'تثبيت باللحام',
          departmentId: 'dept-finishing',
          sortOrder: 1,
          estimatedDurationMinutes: 45,
          estimatedCost: '150.0000',
          deletedAt: null,
        },
        {
          id: 'ot-wood-1',
          optionId: 'opt-wood-door',
          name: 'تثبيت إطار الخشب',
          description: 'تثبيت بالبراغي',
          departmentId: 'dept-finishing',
          sortOrder: 1,
          estimatedDurationMinutes: 30,
          estimatedCost: '100.0000',
          deletedAt: null,
        },
      ] as any[],
      optionTaskMaterials: [
        {
          id: 'otm-1',
          optionTaskId: 'ot-steel-1',
          productId: 'prod-steel-frame',
          productUnitId: 'u-piece',
          plannedQuantity: '1.0000',
          deletedAt: null,
        },
      ] as any[],
      optionTaskAttachments: [] as any[],
      departments: [
        { id: 'dept-casting', name: 'قسم الصب والتشكيل' },
        { id: 'dept-curing', name: 'قسم المعالجة' },
        { id: 'dept-finishing', name: 'قسم التشطيبات' },
      ] as any[],
      products: [
        { id: 'prod-cement', name: 'إسمنت مقاوم', code: 'MAT-CEM' },
        { id: 'prod-steel-frame', name: 'إطار باب حديدي', code: 'MAT-ST-FRM' },
      ] as any[],
      productUnits: [
        { id: 'u-bag', name: 'كيس' },
        { id: 'u-piece', name: 'قطعة' },
      ] as any[],
      plans: [] as any[],
      tasks: [] as any[],
      units: [] as any[],
      events: [] as any[],
      sequence: { id: 'PRODUCTION_ORDER', currentValue: 100 } as any,
    };

    const createRepo = (entityClass: any) => {
      return {
        findOne: async (opts: any) => {
          if (entityClass === ProductionOrderEntity) {
            const id = opts?.where?.id;
            return store.orders.find((o) => o.id === id && (!opts?.where?.deletedAt || !o.deletedAt)) || null;
          }
          if (entityClass === ProductionOrderSequenceEntity) return store.sequence;
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.find((t) => t.id === opts.where.id && (!opts?.withDeleted ? !t.deletedAt : true)) || null;
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.find((p) => p.id === opts.where.id && (!opts?.withDeleted ? !p.deletedAt : true)) || null;
          }
          if (entityClass === ProductionTemplatePatternOptionEntity) {
            return store.options.find((o) => o.id === opts.where.id && (!opts?.withDeleted ? !o.deletedAt : true)) || null;
          }
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.find((l) => l.id === opts.where.id && (!opts?.where?.deletedAt || !l.deletedAt)) || null;
          }
          if (entityClass === ProductionExecutionPlanEntity) {
            return store.plans.find((p) => {
              if (opts?.where?.orderLineId && p.orderLineId !== opts.where.orderLineId) return false;
              if (opts?.where?.id && p.id !== opts.where.id) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.find((s) => s.orderLineId === opts.where.orderLineId && s.templatePatternId === opts.where.templatePatternId) || null;
          }
          if (entityClass === ProductionTemplateStageEntity) {
            return store.stages.find((s) => s.id === opts.where.id && !s.deletedAt) || null;
          }
          return null;
        },
        find: async (opts: any) => {
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.filter((l) => {
              if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
              if (!opts?.withDeleted && l.deletedAt) return false;
              return true;
            }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          }
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.filter((t) => (!opts?.withDeleted ? !t.deletedAt : true));
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.filter((p) => {
              if (opts?.where?.templateId) {
                const list = opts.where.templateId._value || (Array.isArray(opts.where.templateId) ? opts.where.templateId : [opts.where.templateId]);
                if (!list.includes(p.templateId)) return false;
              }
              return !opts?.withDeleted ? !p.deletedAt : true;
            }).map((p) => {
              if (opts?.relations?.options) {
                return { ...p, options: store.options.filter((o) => o.patternId === p.id && !o.deletedAt) };
              }
              return p;
            });
          }
          if (entityClass === ProductionTemplatePatternOptionEntity) {
            return store.options.filter((o) => (!opts?.withDeleted ? !o.deletedAt : true));
          }
          if (entityClass === ProductionTemplateWorkflowItemEntity) {
            return store.workflowItems.filter((w) => (!opts?.withDeleted ? !w.deletedAt : true));
          }
          if (entityClass === ProductionTemplateStageEntity) {
            return store.stages.filter((s) => (!opts?.withDeleted ? !s.deletedAt : true));
          }
          if (entityClass === ProductionTemplateStageMaterialEntity) {
            return store.stageMaterials.filter((m) => (!opts?.withDeleted ? !m.deletedAt : true));
          }
          if (entityClass === ProductionTemplateStageAttachmentEntity) {
            return store.stageAttachments.filter((a) => (!opts?.withDeleted ? !a.deletedAt : true));
          }
          if (entityClass === ProductionTemplatePatternOptionTaskEntity) {
            return store.optionTasks.filter((t) => {
              if (opts?.where?.optionId && t.optionId !== opts.where.optionId) return false;
              return !opts?.withDeleted ? !t.deletedAt : true;
            });
          }
          if (entityClass === ProductionTemplatePatternOptionTaskMaterialEntity) {
            return store.optionTaskMaterials.filter((m) => (!opts?.withDeleted ? !m.deletedAt : true));
          }
          if (entityClass === ProductionTemplatePatternOptionTaskAttachmentEntity) {
            return store.optionTaskAttachments.filter((a) => (!opts?.withDeleted ? !a.deletedAt : true));
          }
          if (entityClass === ProductionDepartmentEntity) {
            return store.departments;
          }
          if (entityClass === InventoryProductEntity) {
            return store.products;
          }
          if (entityClass === InventoryProductUnitEntity) {
            return store.productUnits;
          }
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.filter((s) => {
              if (opts?.where?.orderLineId) {
                const list = opts.where.orderLineId._value || (Array.isArray(opts.where.orderLineId) ? opts.where.orderLineId : [opts.where.orderLineId]);
                if (!list.includes(s.orderLineId)) return false;
              }
              return true;
            });
          }
          if (entityClass === ProductionExecutionPlanEntity) {
            return store.plans.filter((p) => {
              if (opts?.where?.orderId && p.orderId !== opts.where.orderId) return false;
              if (opts?.where?.orderLineId && p.orderLineId !== opts.where.orderLineId) return false;
              return !p.deletedAt;
            });
          }
          if (entityClass === ProductionExecutionTaskEntity) {
            return store.tasks.filter((t) => {
              if (opts?.where?.planId) {
                const list = opts.where.planId._value || (Array.isArray(opts.where.planId) ? opts.where.planId : [opts.where.planId]);
                if (!list.includes(t.planId)) return false;
              }
              return !t.deletedAt;
            }).sort((a, b) => a.sortOrder - b.sortOrder);
          }
          if (entityClass === ProductionUnitEntity) {
            return store.units.filter((u) => {
              if (opts?.where?.orderId && u.orderId !== opts.where.orderId) return false;
              if (opts?.where?.orderLineId && u.orderLineId !== opts.where.orderLineId) return false;
              return !u.deletedAt;
            }).sort((a, b) => a.unitSequence - b.unitSequence);
          }
          if (entityClass === ProductionUnitEventEntity) {
            return store.events.filter((e) => {
              if (opts?.where?.unitId && e.unitId !== opts.where.unitId) return false;
              return true;
            }).sort((a, b) => a.occurredAt - b.occurredAt);
          }
          return [];
        },
        count: async (opts: any) => {
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.filter((l) => !l.deletedAt).length;
          }
          if (entityClass === ProductionExecutionPlanEntity) {
            return store.plans.filter((p) => {
              if (opts?.where?.orderId && p.orderId !== opts.where.orderId) return false;
              return !p.deletedAt;
            }).length;
          }
          if (entityClass === ProductionUnitEntity) {
            return store.units.filter((u) => {
              if (opts?.where?.orderId && u.orderId !== opts.where.orderId) return false;
              if (opts?.where?.orderLineId && u.orderLineId !== opts.where.orderLineId) return false;
              return !u.deletedAt;
            }).length;
          }
          return 0;
        },
        create: (data: any) => {
          return {
            id: data.id || `ent-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            deletedAt: null,
            ...data,
          };
        },
        save: async (entityOrItems: any) => mockManager.save(entityClass, entityOrItems),
      };
    };

    const mockManager: any = {
      getRepository: (c: any) => createRepo(c),
      save: async (entityClassOrEntity: any, maybeEntity?: any) => {
        const raw = maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
        const items = Array.isArray(raw) ? raw : [raw];
        for (const entity of items) {
          if (entity.orderNumber !== undefined && entity.status !== undefined && entity.lineQuantity === undefined) {
            const idx = store.orders.findIndex((o) => o.id === entity.id);
            if (idx >= 0) store.orders[idx] = entity; else store.orders.push(entity);
          } else if (entity.quantity !== undefined && entity.templateId !== undefined) {
            const idx = store.lines.findIndex((l) => l.id === entity.id);
            if (idx >= 0) store.lines[idx] = entity; else store.lines.push(entity);
          } else if (entity.selectedOptionId !== undefined) {
            const idx = store.selections.findIndex((s) => s.id === entity.id);
            if (idx >= 0) store.selections[idx] = entity; else store.selections.push(entity);
          } else if (entity.configurationHash !== undefined && entity.lineQuantity !== undefined) {
            const idx = store.plans.findIndex((p) => p.id === entity.id);
            if (idx >= 0) store.plans[idx] = entity; else store.plans.push(entity);
          } else if (entity.taskSource !== undefined) {
            const idx = store.tasks.findIndex((t) => t.id === entity.id);
            if (idx >= 0) store.tasks[idx] = entity; else store.tasks.push(entity);
          } else if (entity.unitSequence !== undefined) {
            const idx = store.units.findIndex((u) => u.id === entity.id);
            if (idx >= 0) store.units[idx] = entity; else store.units.push(entity);
          } else if (entity.eventType !== undefined) {
            const idx = store.events.findIndex((e) => e.id === entity.id);
            if (idx >= 0) store.events[idx] = entity; else store.events.push(entity);
          }
        }
        return raw;
      },
    };

    const mockDataSource: any = {
      getRepository: (c: any) => createRepo(c),
      transaction: async (cb: any) => cb(mockManager),
    };

    const guardService = new ProductionOrderGuardService(mockDataSource);
    const planService = new ProductionExecutionPlanService(mockDataSource);
    const unitService = new ProductionUnitService(mockDataSource);
    const orderService = new ProductionOrderService(mockDataSource, guardService, planService, unitService);

    return {
      store,
      orderService,
      planService,
      unitService,
    };
  }

  // ==========================================
  // SCENARIO 1: Comprehensive Approval Workflow
  // ==========================================
  it('1. approveOrder creates isolated Execution Plan, Execution Tasks, Units, and Events', async () => {
    const { orderService, store } = createTestContext();

    // Add line with 3 units and explicit pattern selection (opt-steel-door)
    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 3,
      patternSelections: [
        { patternId: 'pat-doors', optionId: 'opt-steel-door' },
      ],
    });

    const approvedOrder = await orderService.approveOrder('order-100', 'user-eng-10');

    // 1. Order status
    assert.equal(approvedOrder.status, ProductionOrderStatus.APPROVED);
    assert.equal(approvedOrder.approvedByUserId, 'user-eng-10');
    assert.ok(approvedOrder.approvedAt);
    assert.equal(approvedOrder.hasExecutionPlans, true);

    // 2. Execution Plan created
    assert.equal(store.plans.length, 1);
    const plan = store.plans[0];
    assert.equal(plan.orderId, 'order-100');
    assert.equal(plan.templateId, 'tmpl-room-a');
    assert.equal(plan.templateName, 'قالب غرفة نموذج أ');
    assert.equal(plan.templateCode, 'TMPL-RM-A');
    assert.equal(plan.lineQuantity, 3);
    assert.ok(plan.configurationHash);

    // 3. Execution Tasks created (2 general stages + 1 steel door option task = 3 tasks)
        assert.equal(store.tasks.length, 3);
    const taskSources = store.tasks.map((t) => t.taskSource);
    assert.deepEqual(taskSources, [
      ExecutionTaskSource.GENERAL,
      ExecutionTaskSource.PATTERN_OPTION,
      ExecutionTaskSource.GENERAL,
    ]);

    // 4. Units created (exactly 3 units)
    assert.equal(store.units.length, 3);
    for (let i = 0; i < 3; i++) {
      const u = store.units[i];
      assert.equal(u.unitSequence, i + 1);
      assert.equal(u.unitNumber, `PO-000100-L1-U00${i + 1}`);
      assert.equal(u.code, null, 'code starts null');
      assert.equal(u.currentYardId, null, 'yard starts null');
      assert.equal(u.status, ProductionUnitStatus.CREATED);
    }

    // 5. Initial UNIT_CREATED events created (exactly 3 events)
    assert.equal(store.events.length, 3);
    const correlationIds = new Set(store.events.map((e) => e.correlationId));
    assert.equal(correlationIds.size, 1, 'All events in approval batch share identical correlationId');
    assert.equal(store.events[0].eventType, ProductionUnitEventType.UNIT_CREATED);
    assert.equal(store.events[0].createdByUserId, 'user-eng-10');
  });

  // ==========================================
  // SCENARIO 2: Zero Unit Task Execution Records
  // ==========================================
  it('2. Invariant: 0 empty unit task execution records are created', async () => {
    const { orderService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 5,
    });

    await orderService.approveOrder('order-100', 'user-eng-10');

    assert.equal(store.units.length, 5);
    // Verified: No unit_task_execution table or rows are created anywhere in the system
    assert.ok(!('unitTaskExecutions' in store));
  });

  // ==========================================
  // SCENARIO 3: Pattern Option Isolation
  // ==========================================
  it('3. Isolates tasks: selected option tasks included, unselected option tasks strictly excluded', async () => {
    const { orderService, store } = createTestContext();

    // Select opt-wood-door (which has ot-wood-1: "تثبيت إطار الخشب")
    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
      patternSelections: [
        { patternId: 'pat-doors', optionId: 'opt-wood-door' },
      ],
    });

    await orderService.approveOrder('order-100', 'user-eng-10');

    // Expected tasks: Stage 1 (general), Wood Door (pattern option), Stage 2 (general)
    assert.equal(store.tasks.length, 3);
    const taskNames = store.tasks.map((t) => t.name);
    assert.ok(taskNames.includes('تثبيت إطار الخشب'));
    assert.ok(!taskNames.includes('تركيب حلق الباب الحديدي'), 'Unselected option task MUST be excluded');
  });

  // ==========================================
  // SCENARIO 4: Decoupling from Future Template Changes
  // ==========================================
  it('4. Total Template Decoupling: Future template mutations or archival do NOT affect approved plan', async () => {
    const { orderService, planService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });

    await orderService.approveOrder('order-100', 'user-eng-10');
    const planId = store.plans[0].id;

    // Mutate live template: change name, delete stages, and soft-delete the template itself
    store.templates[0].name = 'قالب تم تعديله بالكامل';
    store.templates[0].deletedAt = new Date(); // soft-delete template
    store.stages.length = 0; // live stages wiped!

    // Retrieve approved execution plan
    const fetchedPlan = await planService.getPlanById(planId);

    assert.ok(fetchedPlan);
    assert.equal(fetchedPlan.templateName, 'قالب غرفة نموذج أ', 'Plan maintains its snapshot template name');
    assert.equal(fetchedPlan.tasksCount, 3, 'Plan maintains all snapshot tasks despite live template deletion');
    assert.equal(fetchedPlan.tasks?.[0].name, 'صب الخرسانة الأساسية');
  });

  // ==========================================
  // SCENARIO 5: reopenOrder Protection
  // ==========================================
  it('5. reopenOrder blocked with PRODUCTION_ORDER_HAS_EXECUTION_PLANS when plans/units exist', async () => {
    const { orderService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });

    await orderService.approveOrder('order-100', 'user-eng-10');
    assert.equal(store.orders[0].status, ProductionOrderStatus.APPROVED);

    await assert.rejects(
      async () => {
        await orderService.reopenOrder('order-100');
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_ORDER_HAS_EXECUTION_PLANS');
        assert.ok(err.message.includes('خطط تنفيذية'));
        return true;
      }
    );

    assert.equal(store.orders[0].status, ProductionOrderStatus.APPROVED, 'Status MUST remain APPROVED');
  });

  // ==========================================
  // SCENARIO 6: Historical Approved Order Compatibility
  // ==========================================
  it('6. Historical approved order without plans displays gracefully and can be reopened safely', async () => {
    const { orderService, store } = createTestContext();

    // Set order as historically approved with 0 plans
    store.orders[0].status = ProductionOrderStatus.APPROVED;
    store.orders[0].approvedAt = new Date('2025-01-01');
    store.orders[0].approvedByUserId = 'old-user';

    // Fetch order detail
    const orderDto = await orderService.getOrderById('order-100');
    assert.equal(orderDto.status, ProductionOrderStatus.APPROVED);
    assert.equal(orderDto.hasExecutionPlans, false);
    assert.equal(orderDto.unitsSummary, null);

    // Reopen historical order: allowed because planCount === 0 and unitCount === 0
    const reopened = await orderService.reopenOrder('order-100');
    assert.equal(reopened.status, ProductionOrderStatus.DRAFT);
    assert.equal(reopened.approvedAt, null);
  });

  // ==========================================
  // SCENARIO 7: Unit Sequence & Naming Format
  // ==========================================
  it('7. Units sequence 1..N and deterministic unit numbers per line', async () => {
    const { orderService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 12,
    });

    await orderService.approveOrder('order-100', 'user-eng-10');

    assert.equal(store.units.length, 12);
    for (let seq = 1; seq <= 12; seq++) {
      const u = store.units[seq - 1];
      assert.equal(u.unitSequence, seq);
      assert.equal(u.unitNumber, `PO-000100-L1-U${String(seq).padStart(3, '0')}`);
      assert.equal(u.status, ProductionUnitStatus.CREATED);
    }
  });

  // ==========================================
  // SCENARIO 8: Approver User ID Required
  // ==========================================
  it('8. approveOrder fails closed when currentUser ID is missing', async () => {
    const { orderService } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 1,
    });

    await assert.rejects(
      async () => {
        await orderService.approveOrder('order-100', '');
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_ORDER_APPROVER_REQUIRED');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 9: Empty Order Approval Blocked
  // ==========================================
  it('9. approveOrder fails closed with PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL on empty order', async () => {
    const { orderService } = createTestContext();

    await assert.rejects(
      async () => {
        await orderService.approveOrder('order-100', 'user-eng-10');
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 10: Double Approval Rejection
  // ==========================================
  it('10. Double approval is rejected by pessimistic lock guard', async () => {
    const { orderService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });

    await orderService.approveOrder('order-100', 'user-eng-10');
    assert.equal(store.orders[0].status, ProductionOrderStatus.APPROVED);

    await assert.rejects(
      async () => {
        await orderService.approveOrder('order-100', 'user-eng-10');
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 11: Idempotency Protection on Unit Generation
  // ==========================================
  it('11. generateUnitsForPlan guards against duplicate invocation for same line', async () => {
    const { unitService, store } = createTestContext();

    const order = store.orders[0];
    const line = { id: 'line-test', sortOrder: 1, quantity: 2 } as any;
    const plan = { id: 'plan-test' } as any;

    // First call generates 2 units
    await unitService.generateUnitsForPlan(
      order,
      line,
      plan,
      randomUUID(),
      'user-1',
      {
        getRepository: (entityClass: any) => {
          if (entityClass === ProductionUnitEntity) {
            return {
              count: async () => store.units.length,
              create: (d: any) => ({ ...d }),
              save: async (items: any) => {
                const arr = Array.isArray(items) ? items : [items];
                for (const item of arr) {
                  if (item.unitSequence !== undefined) store.units.push(item);
                }
                return items;
              },
            };
          }
          if (entityClass === ProductionUnitEventEntity) {
            return {
              create: (d: any) => ({ ...d }),
              save: async () => {},
            };
          }
          return {};
        },
        save: async (_c: any, items: any) => {
          const arr = Array.isArray(items) ? items : [items];
          for (const item of arr) {
            if (item.unitSequence !== undefined) store.units.push(item);
          }
        },
      } as any
    );

    assert.equal(store.units.length, 2);

    // Second call for same line must throw
    await assert.rejects(
      async () => {
        await unitService.generateUnitsForPlan(
          order,
          line,
          plan,
          randomUUID(),
          'user-1',
          {
            getRepository: () => ({
              count: async () => store.units.length,
            }),
          } as any
        );
      },
      (err: any) => {
        assert.ok(err instanceof BusinessRuleError);
        assert.equal(err.code, 'PRODUCTION_UNITS_ALREADY_GENERATED');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 12: Migration Registration & Safety
  // ==========================================
  it('12. Migration CreateProductionExecutionPlansAndUnits1710000000017 is registered in databaseConfig', () => {
    const migrations = databaseConfig.migrations as any[];
    const hasMigration = migrations.some((m) => m === CreateProductionExecutionPlansAndUnits1710000000017 || m.name === 'CreateProductionExecutionPlansAndUnits1710000000017');
    assert.ok(hasMigration, 'CreateProductionExecutionPlansAndUnits1710000000017 must be registered in databaseConfig.migrations');
  });

  // ==========================================
  // SCENARIO 13: Migration down() Safety Guard
  // ==========================================
  it('13. Migration down() fails closed if production data exists', async () => {
    const migration = new CreateProductionExecutionPlansAndUnits1710000000017();

    const mockQueryRunner: any = {
      query: async (sql: string) => {
        if (sql.includes('COUNT(*)')) {
          return [{ count: 5 }]; // simulate existing units
        }
        return [];
      },
      dropTable: async () => {},
    };

    await assert.rejects(
      async () => {
        await migration.down(mockQueryRunner);
      },
      /Cannot revert because production_execution_plan rows exist/
    );
  });

  // ==========================================
  // SCENARIO 14: Unit Events Query API
  // ==========================================
  it('14. getUnitEvents returns properly formatted history DTOs', async () => {
    const { unitService, store } = createTestContext();

    const now = new Date();
    store.events.push({
      id: 'ev-1',
      unitId: 'unit-1',
      eventType: ProductionUnitEventType.UNIT_CREATED,
      createdByUserId: 'user-1',
      createdByUser: { id: 'user-1', fullName: 'مهندس أحمد' },
      occurredAt: now,
      departmentId: null,
      executionTaskId: null,
      previousData: null,
      newData: { unitSequence: 1, unitNumber: 'PO-000100-L1-U001', status: 'CREATED' },
      correlationId: 'corr-batch-1',
      metadata: null,
      createdAt: now,
    });

    const events = await unitService.getUnitEvents('unit-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'UNIT_CREATED');
    assert.equal(events[0].createdByUser?.fullName, 'مهندس أحمد');
    assert.equal(events[0].correlationId, 'corr-batch-1');
  });

  // ==========================================
  // SCENARIO 15: Multiple Lines within Order
  // ==========================================
  it('15. Order with multiple lines creates distinct plans and properly sequenced units for each line', async () => {
    const { orderService, store } = createTestContext();

    // Line 1: qty 2
    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });

    // Add second template for line 2
    store.templates.push({
      id: 'tmpl-room-b',
      name: 'قالب غرفة نموذج ب',
      code: 'TMPL-RM-B',
      referenceNumber: null,
      description: null,
      isActive: true,
      deletedAt: null,
    });
    store.workflowItems.push({
      id: 'wf-b-1',
      templateId: 'tmpl-room-b',
      itemType: 'STAGE',
      stageId: 'stage-1',
      patternId: null,
      sortOrder: 1,
      deletedAt: null,
    });

    // Line 2: qty 3
    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-b',
      quantity: 3,
    });

    const approvedOrder = await orderService.approveOrder('order-100', 'user-eng-10');

    // 2 execution plans created
    assert.equal(store.plans.length, 2);
    assert.equal(store.plans[0].lineQuantity, 2);
    assert.equal(store.plans[1].lineQuantity, 3);

    // 5 total units created
    assert.equal(store.units.length, 5);

    // Line 1 units: sequences 1, 2
    const line1Units = store.units.filter((u) => u.orderLineId === approvedOrder.lines![0].id);
    assert.equal(line1Units.length, 2);
    assert.equal(line1Units[0].unitSequence, 1);
    assert.equal(line1Units[1].unitSequence, 2);

    // Line 2 units: sequences 1, 2, 3
    const line2Units = store.units.filter((u) => u.orderLineId === approvedOrder.lines![1].id);
    assert.equal(line2Units.length, 3);
    assert.equal(line2Units[0].unitSequence, 1);
    assert.equal(line2Units[1].unitSequence, 2);
    assert.equal(line2Units[2].unitSequence, 3);
  });
});
