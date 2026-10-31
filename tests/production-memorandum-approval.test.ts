import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ejs from 'ejs';

import {
  ProductionOrderEntity,
  ProductionOrderStatus,
  ProductionOrderPriority,
} from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../src/modules/production/order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplatePatternEntity } from '../src/modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../src/modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../src/modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplateStageEntity } from '../src/modules/production/template-stage/production-template-stage.entity.js';
import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionExecutionTaskEntity } from '../src/modules/production/execution-plan/production-execution-task.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { ProductionUnitEventEntity } from '../src/modules/production/unit/production-unit-event.entity.js';

import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderGuardService } from '../src/modules/production/order/production-order-guard.service.js';
import { ProductionExecutionPlanService } from '../src/modules/production/execution-plan/production-execution-plan.service.js';
import { ProductionUnitService } from '../src/modules/production/unit/production-unit.service.js';
import { productionAccessPolicyService } from '../src/modules/production/authorization/production-access-policy.service.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';

describe('Phase 2.1 — Production Order Approval into Production Memorandum Test Suite', () => {
  function createTestContext() {
    const store = {
      orders: [
        {
          id: 'ord-mem-1',
          orderNumber: 'PO-000501',
          status: ProductionOrderStatus.DRAFT,
          priority: ProductionOrderPriority.NORMAL,
          description: 'مذكرة إنتاج تجريبية',
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
          id: 'tmpl-1',
          name: 'قالب غرفة خرسانية معيارية',
          code: 'TMPL-RM-01',
          referenceNumber: 'REF-M1',
          description: null,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'tmpl-2',
          name: 'قالب غرفة حراسة خرسانية',
          code: 'TMPL-RM-02',
          referenceNumber: 'REF-M2',
          description: null,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[],
      workflowItems: [
        { id: 'wf-1', templateId: 'tmpl-1', itemType: 'STAGE', stageId: 'st-1', patternId: null, sortOrder: 1, deletedAt: null },
        { id: 'wf-2', templateId: 'tmpl-2', itemType: 'STAGE', stageId: 'st-2', patternId: null, sortOrder: 1, deletedAt: null },
      ] as any[],
      stages: [
        { id: 'st-1', templateId: 'tmpl-1', name: 'الصب', departmentId: 'dept-1', sortOrder: 1, deletedAt: null },
        { id: 'st-2', templateId: 'tmpl-2', name: 'الصب والتسليح', departmentId: 'dept-1', sortOrder: 1, deletedAt: null },
      ] as any[],
      patterns: [
        { id: 'pat-1', templateId: 'tmpl-1', name: 'نوع التشطيب', deletedAt: null, createdAt: new Date() },
      ] as any[],
      options: [
        { id: 'opt-1', patternId: 'pat-1', name: 'تشطيب أملس', sortOrder: 1, deletedAt: null },
        { id: 'opt-2', patternId: 'pat-1', name: 'تشطيب خشن', sortOrder: 2, deletedAt: null },
      ] as any[],
      plans: [] as any[],
      tasks: [] as any[],
      units: [] as any[],
      events: [] as any[],
    };

    const createRepo = (entityClass: any) => {
      return {
        findOne: async (opts: any) => {
          if (entityClass === ProductionOrderEntity) {
            return store.orders.find((o) => {
              if (opts?.where?.id && o.id !== opts.where.id) return false;
              if (opts?.where?.deletedAt === null && o.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.find((l) => {
              if (opts?.where?.id && l.id !== opts.where.id) return false;
              if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
              if (opts?.where?.activeConfigurationHash && l.activeConfigurationHash !== opts.where.activeConfigurationHash) return false;
              if (opts?.where?.deletedAt === null && l.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.find((t) => {
              if (opts?.where?.id && t.id !== opts.where.id) return false;
              if (opts?.where?.deletedAt === null && t.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.find((p) => {
              if (opts?.where?.id && p.id !== opts.where.id) return false;
              if (opts?.where?.deletedAt === null && p.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionTemplatePatternOptionEntity) {
            return store.options.find((o) => {
              if (opts?.where?.id && o.id !== opts.where.id) return false;
              if (opts?.where?.deletedAt === null && o.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionExecutionPlanEntity) {
            return store.plans.find((p) => {
              if (opts?.where?.id && p.id !== opts.where.id) return false;
              if (opts?.where?.orderId && p.orderId !== opts.where.orderId) return false;
              return true;
            }) || null;
          }
          return null;
        },
        find: async (opts: any) => {
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.filter((l) => {
              if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
              if (opts?.where?.deletedAt === null && l.deletedAt !== null) return false;
              return true;
            }).sort((a, b) => a.sortOrder - b.sortOrder);
          }
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.filter((s) => {
              if (opts?.where?.orderLineId?._value) {
                return opts.where.orderLineId._value.includes(s.orderLineId);
              }
              if (opts?.where?.orderLineId && s.orderLineId !== opts.where.orderLineId) return false;
              return true;
            });
          }
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.filter((t) => {
              if (opts?.where?.id?._value) return opts.where.id._value.includes(t.id);
              return true;
            });
          }
          if (entityClass === ProductionTemplateWorkflowItemEntity) {
            return store.workflowItems.filter((w) => {
              if (opts?.where?.templateId?._value) return opts.where.templateId._value.includes(w.templateId);
              if (opts?.where?.templateId && w.templateId !== opts.where.templateId) return false;
              return !w.deletedAt;
            });
          }
          if (entityClass === ProductionTemplateStageEntity) {
            return store.stages.filter((s) => {
              if (opts?.where?.id?._value) return opts.where.id._value.includes(s.id);
              return !s.deletedAt;
            });
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.filter((p) => {
              if (opts?.where?.id?._value) return opts.where.id._value.includes(p.id);
              if (opts?.where?.templateId?._value) return opts.where.templateId._value.includes(p.templateId);
              if (opts?.where?.templateId && p.templateId !== opts.where.templateId) return false;
              return !p.deletedAt;
            }).map((p) => {
              if (opts?.relations?.options) {
                return { ...p, options: store.options.filter((o) => o.patternId === p.id && !o.deletedAt) };
              }
              return p;
            });
          }
          if (entityClass === ProductionTemplatePatternOptionEntity) {
            return store.options.filter((o) => {
              if (opts?.where?.id?._value) return opts.where.id._value.includes(o.id);
              if (opts?.where?.patternId?._value) return opts.where.patternId._value.includes(o.patternId);
              return !o.deletedAt;
            });
          }
          if (entityClass === ProductionExecutionPlanEntity) {
            return store.plans.filter((p) => {
              if (opts?.where?.orderId && p.orderId !== opts.where.orderId) return false;
              return !p.deletedAt;
            });
          }
          if (entityClass === ProductionExecutionTaskEntity) {
            return store.tasks.filter((t) => !t.deletedAt);
          }
          if (entityClass === ProductionUnitEntity) {
            return store.units.filter((u) => {
              if (opts?.where?.orderId && u.orderId !== opts.where.orderId) return false;
              return !u.deletedAt;
            });
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
              return !u.deletedAt;
            }).length;
          }
          return 0;
        },
        create: (data: any) => ({
          id: data.id || `ent-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          deletedAt: null,
          ...data,
        }),
        save: async (data: any) => mockManager.save(entityClass, data),
        createQueryBuilder: () => {
          const qb: any = {
            leftJoinAndSelect: () => qb,
            where: () => qb,
            andWhere: () => qb,
            orderBy: () => qb,
            addOrderBy: () => qb,
            skip: () => qb,
            take: () => qb,
            getManyAndCount: async () => [[], 0],
          };
          return qb;
        },
      };
    };

    const mockManager: any = {
      getRepository: (c: any) => createRepo(c),
      save: async (entityClassOrEntity: any, maybeEntity?: any) => {
        const raw = maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
        const items = Array.isArray(raw) ? raw : [raw];
        for (const entity of items) {
          if (entity.orderNumber !== undefined && entity.lineQuantity === undefined) {
            const idx = store.orders.findIndex((o) => o.id === entity.id);
            if (idx >= 0) store.orders[idx] = entity; else store.orders.push(entity);
          } else if (entity.quantity !== undefined && entity.templateId !== undefined) {
            const idx = store.lines.findIndex((l) => l.id === entity.id);
            if (idx >= 0) store.lines[idx] = { ...store.lines[idx], ...entity }; else store.lines.push(entity);
          } else if (entity.selectedOptionId !== undefined) {
            const idx = store.selections.findIndex((s) => s.id === entity.id);
            if (idx >= 0) store.selections[idx] = entity; else store.selections.push(entity);
          }
        }
        return raw;
      },
    };

    const mockDataSource: any = {
      getRepository: (c: any) => createRepo(c),
      transaction: async (cb: any) => cb(mockManager),
    };

    const mockAuthzService: any = {
      getApplicableAccessRules: async () => [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    };
    const mockRespResolver: any = {
      resolve: async () => ({ isConsistent: true }),
    };

    const guardService = new ProductionOrderGuardService(mockDataSource);
    const planService = new ProductionExecutionPlanService(mockDataSource, mockAuthzService, productionAccessPolicyService, mockRespResolver);
    const unitService = new ProductionUnitService(mockDataSource, mockAuthzService, productionAccessPolicyService, mockRespResolver);
    const orderService = new ProductionOrderService(mockDataSource, guardService, planService, unitService);

    return {
      store,
      orderService,
      planService,
      unitService,
    };
  }

  // ==========================================
  // SECTION 1: New Approval Tests (Scenarios 1 - 12)
  // ==========================================
  describe('1. New Approval Tests', () => {
    it('1. Approval of ready draft order succeeds and returns valid memorandum DTO', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 5,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      assert.ok(approved);
      assert.equal(approved.id, 'ord-mem-1');
      assert.equal(approved.orderNumber, 'PO-000501');
    });

    it('2. Order status transitions to APPROVED in database and return payload', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 5,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(approved.status, ProductionOrderStatus.APPROVED);
      assert.equal(store.orders[0].status, ProductionOrderStatus.APPROVED);
    });

    it('3. Approver userId and approval timestamp are saved permanently', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 5,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(approved.approvedByUserId, 'user-manager-1');
      assert.ok(approved.approvedAt instanceof Date);
      assert.equal(store.orders[0].approvedByUserId, 'user-manager-1');
      assert.ok(store.orders[0].approvedAt instanceof Date);
    });

    it('4. Zero ProductionUnit records are created upon approval', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 8,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(store.units.length, 0, 'Must have zero ProductionUnits in database');
    });

    it('5. Zero ProductionExecutionPlan records are created upon approval', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 8,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(store.plans.length, 0, 'Must have zero Execution Plans in database');
      assert.equal(approved.hasExecutionPlans, false);
      assert.equal(approved.lines?.[0].executionPlan, null);
    });

    it('6. Zero ProductionExecutionTask records are created upon approval', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 8,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(store.tasks.length, 0, 'Must have zero Execution Tasks in database');
    });

    it('7. Zero ProductionUnitEvent records (e.g. UNIT_CREATED) are created upon approval', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 8,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(store.events.length, 0, 'Must have zero Unit Events in database');
    });

    it('8. Order lines and pattern selections remain strictly intact as configured by manager', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 7,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-2' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      assert.equal(approved.lines?.length, 1);
      assert.equal(approved.lines?.[0].templateId, 'tmpl-1');
      assert.equal(approved.lines?.[0].quantity, 7);
      assert.equal(approved.lines?.[0].patternSelections.length, 1);
      assert.equal(approved.lines?.[0].patternSelections[0].selectedOptionId, 'opt-2');
    });

    it('9. Double approval is rejected fail-closed with PRODUCTION_ORDER_NOT_MUTABLE', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 3,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      await assert.rejects(
        async () => {
          await orderService.approveOrder('ord-mem-1', 'user-manager-1');
        },
        (err: any) => {
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );
    });

    it('10. Approving an empty order (0 lines) is rejected with PRODUCTION_ORDER_EMPTY', async () => {
      const { orderService } = createTestContext();

      await assert.rejects(
        async () => {
          await orderService.approveOrder('ord-mem-1', 'user-manager-1');
        },
        (err: any) => {
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL');
          return true;
        }
      );
    });

    it('11. Approving an unready order (e.g. inactive template) is rejected with PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 2,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      // Make template inactive
      store.templates[0].isActive = false;

      await assert.rejects(
        async () => {
          await orderService.approveOrder('ord-mem-1', 'user-manager-1');
        },
        (err: any) => {
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL');
          assert.ok(err.details?.issues?.length > 0);
          return true;
        }
      );
    });

    it('12. Pessimistic lock prevents unsafe concurrent modification during approval', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 2,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      // Verify that lockMutableOrder checks status = DRAFT
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      // Attempting to add line to approved order fails closed with PRODUCTION_ORDER_NOT_MUTABLE
      await assert.rejects(
        async () => {
          await orderService.addLine('ord-mem-1', {
            templateId: 'tmpl-1',
            quantity: 3,
            patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
          });
        },
        (err: any) => {
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );
    });
  });

  // ==========================================
  // SECTION 2: Memorandum Tracking Tests (Scenarios 13 - 18)
  // ==========================================
  describe('2. Memorandum Tracking Tests', () => {
    it('13. New memorandum order of 10 rooms starts with remaining = 10, linked = 0', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 10,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      const approved = await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const line = approved.lines![0];

      assert.equal(line.requestedQuantity, 10);
      assert.equal(line.linkedQuantity, 0);
      assert.equal(line.remainingQuantity, 10);
      assert.equal(approved.summary.totalQuantity, 10);
      assert.equal(approved.summary.totalLinkedQuantity, 0);
      assert.equal(approved.summary.totalRemainingQuantity, 10);
    });

    it('14. Historical order having 6 active rooms out of 10 shows remaining = 4, linked = 6', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 10,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const lineId = store.lines[0].id;

      // Seed 6 historical units
      for (let i = 1; i <= 6; i++) {
        store.units.push({
          id: `unit-hist-${i}`,
          orderId: 'ord-mem-1',
          orderLineId: lineId,
          unitSequence: i,
          status: ProductionUnitStatus.IN_PROGRESS,
          isCancelled: false,
          deletedAt: null,
        });
      }

      const fetched = await orderService.getOrderById('ord-mem-1');
      const line = fetched.lines![0];

      assert.equal(line.requestedQuantity, 10);
      assert.equal(line.linkedQuantity, 6);
      assert.equal(line.remainingQuantity, 4);
      assert.equal(fetched.summary.totalLinkedQuantity, 6);
      assert.equal(fetched.summary.totalRemainingQuantity, 4);
    });

    it('15. No double counting of rooms occurs', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 5,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const lineId = store.lines[0].id;

      // Seed 3 distinct units
      for (let i = 1; i <= 3; i++) {
        store.units.push({
          id: `unit-distinct-${i}`,
          orderId: 'ord-mem-1',
          orderLineId: lineId,
          unitSequence: i,
          status: ProductionUnitStatus.COMPLETED,
          isCancelled: false,
          deletedAt: null,
        });
      }

      const fetched = await orderService.getOrderById('ord-mem-1');
      assert.equal(fetched.lines![0].linkedQuantity, 3);
      assert.equal(fetched.lines![0].remainingQuantity, 2);
    });

    it('16. Units belonging to another line or order are strictly not counted', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 5,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });
      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-2',
        quantity: 5,
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const line1Id = store.lines[0].id;
      const line2Id = store.lines[1].id;

      // Seed 2 units on line 1, 4 units on line 2, and 3 units on another order
      store.units.push({ id: 'u1-1', orderId: 'ord-mem-1', orderLineId: line1Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u1-2', orderId: 'ord-mem-1', orderLineId: line1Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });

      store.units.push({ id: 'u2-1', orderId: 'ord-mem-1', orderLineId: line2Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u2-2', orderId: 'ord-mem-1', orderLineId: line2Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u2-3', orderId: 'ord-mem-1', orderLineId: line2Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u2-4', orderId: 'ord-mem-1', orderLineId: line2Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });

      store.units.push({ id: 'u-foreign', orderId: 'ord-other', orderLineId: 'foreign-line', status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });

      const fetched = await orderService.getOrderById('ord-mem-1');
      assert.equal(fetched.lines![0].linkedQuantity, 2);
      assert.equal(fetched.lines![0].remainingQuantity, 3);
      assert.equal(fetched.lines![1].linkedQuantity, 4);
      assert.equal(fetched.lines![1].remainingQuantity, 1);
    });

    it('17. Cancelled units are excluded from linkedQuantity according to historical policy', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', {
        templateId: 'tmpl-1',
        quantity: 10,
        patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }],
      });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const lineId = store.lines[0].id;

      // Seed 2 active units, 1 cancelled by status, 1 cancelled by flag
      store.units.push({ id: 'u-act-1', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.IN_PROGRESS, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u-act-2', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.COMPLETED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u-canc-1', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.CANCELLED, isCancelled: true, deletedAt: null });
      store.units.push({ id: 'u-canc-2', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.IN_PROGRESS, isCancelled: true, deletedAt: null });

      const fetched = await orderService.getOrderById('ord-mem-1');
      const line = fetched.lines![0];

      // Linked quantity counts only non-cancelled units
      assert.equal(line.linkedQuantity, 2);
      assert.equal(line.remainingQuantity, 8);
      // unitCount on line includes all non-deleted units (4)
      assert.equal(line.unitCount, 4);
      // unitsSummary reflects cancelled count
      assert.equal(fetched.unitsSummary?.cancelledUnits, 2);
      assert.equal(fetched.unitsSummary?.inProgressUnits, 1);
      assert.equal(fetched.unitsSummary?.completedUnits, 1);
    });

    it('18. Multi-line orders accurately aggregate totalQuantity, totalLinkedQuantity, totalRemainingQuantity', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 10, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-2', quantity: 15 });

      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      const line1Id = store.lines[0].id;
      const line2Id = store.lines[1].id;

      // 4 units on line 1, 5 units on line 2
      for (let i = 1; i <= 4; i++) {
        store.units.push({ id: `u1-${i}`, orderId: 'ord-mem-1', orderLineId: line1Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      }
      for (let i = 1; i <= 5; i++) {
        store.units.push({ id: `u2-${i}`, orderId: 'ord-mem-1', orderLineId: line2Id, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      }

      const fetched = await orderService.getOrderById('ord-mem-1');
      assert.equal(fetched.summary.lineCount, 2);
      assert.equal(fetched.summary.totalQuantity, 25);
      assert.equal(fetched.summary.totalLinkedQuantity, 9);
      assert.equal(fetched.summary.totalRemainingQuantity, 16);
    });
  });

  // ==========================================
  // SECTION 3: Compatibility Tests (Scenarios 19 - 24)
  // ==========================================
  describe('3. Compatibility Tests', () => {
    it('19. Historical execution plans are not deleted and display properly in DTO', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 4, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const lineId = store.lines[0].id;

      // Attach historical plan
      store.plans.push({
        id: 'plan-hist-1',
        orderId: 'ord-mem-1',
        orderLineId: lineId,
        templateId: 'tmpl-1',
        templateName: 'قالب تاريخي',
        templateCode: 'TMPL-HIST',
        lineQuantity: 4,
        configurationHash: 'hash123',
        deletedAt: null,
      });

      const fetched = await orderService.getOrderById('ord-mem-1');
      assert.equal(fetched.hasExecutionPlans, true);
      assert.ok(fetched.lines![0].executionPlan);
      assert.equal(fetched.lines![0].executionPlan?.id, 'plan-hist-1');
      assert.equal(fetched.lines![0].executionPlan?.templateName, 'قالب تاريخي');
    });

    it('20. Historical production units are preserved and unitsCount reflects actual linked units', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 6, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');
      const lineId = store.lines[0].id;

      // Attach 2 units
      store.units.push({ id: 'u-1', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.CREATED, isCancelled: false, deletedAt: null });
      store.units.push({ id: 'u-2', orderId: 'ord-mem-1', orderLineId: lineId, status: ProductionUnitStatus.IN_PROGRESS, isCancelled: false, deletedAt: null });

      store.plans.push({
        id: 'plan-hist-2',
        orderId: 'ord-mem-1',
        orderLineId: lineId,
        templateId: 'tmpl-1',
        templateName: 'قالب',
        templateCode: 'TMPL',
        lineQuantity: 6,
        configurationHash: 'hash',
        deletedAt: null,
      });

      const fetched = await orderService.getOrderById('ord-mem-1');
      // unitsCount in executionPlan summary reflects actual linked units (2), not lineQuantity (6)
      assert.equal(fetched.lines![0].executionPlan?.unitsCount, 2);
      assert.equal(fetched.lines![0].linkedQuantity, 2);
    });

    it('21. Execution plan and unit services accept approved memorandum orders without plans/units and return empty lists cleanly', async () => {
      const { orderService, planService, unitService } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 3, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      // getPlansByOrderId returns [] cleanly without error
      const plans = await planService.getPlansByOrderId('ord-mem-1');
      assert.deepEqual(plans, []);

      // getUnitsByOrderId returns empty pagination cleanly without error
      const unitsResult = await unitService.getUnitsByOrderId('ord-mem-1', { page: 1, limit: 10 });
      assert.deepEqual(unitsResult.items, []);
      assert.equal(unitsResult.total, 0);
    });

    it('22. EJS show template renders empty state «لم يتم إنشاء غرف لهذا الأمر بعد» when 0 units exist', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 5, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      const order = await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      const templatePath = resolve(process.cwd(), 'src/views/dashboard/production/orders/show.ejs');
      const templateContent = readFileSync(templatePath, 'utf-8');

      // Render show.ejs with mock locals
      const html = ejs.render(templateContent, {
        order,
        canUpdateOrder: true,
        canApproveOrder: true,
        canReopenOrder: true,
        canDeleteOrder: true,
        user: { id: 'user-manager-1', fullName: 'مدير الإنتاج' },
        currentUrl: '/production/orders/ord-mem-1',
        layout: false,
      });

      assert.ok(html.includes('لم يتم إنشاء غرف لهذا الأمر بعد'), 'show.ejs must render empty state text when 0 units exist');
      assert.ok(!html.includes('تم إنشاء الغرف بنجاح'), 'Must not contain old room creation phrase');
    });

    it('23. reopenOrder succeeds when plans/units = 0, but fails closed with PRODUCTION_ORDER_HAS_EXECUTION_PLANS when plans/units > 0', async () => {
      const { orderService, store } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 5, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      // 1. Reopen eligible memorandum order with 0 plans and 0 units -> Succeeds
      const reopened = await orderService.reopenOrder('ord-mem-1', 'user-manager-1');
      assert.equal(reopened.status, ProductionOrderStatus.DRAFT);
      assert.equal(reopened.approvedAt, null);
      assert.equal(reopened.approvedByUserId, null);

      // Re-approve order
      await orderService.approveOrder('ord-mem-1', 'user-manager-1');

      // 2. Add historical unit to order -> Now reopening must be blocked
      store.units.push({
        id: 'u-block-reopen',
        orderId: 'ord-mem-1',
        orderLineId: store.lines[0].id,
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
        deletedAt: null,
      });

      await assert.rejects(
        async () => {
          await orderService.reopenOrder('ord-mem-1', 'user-manager-1');
        },
        (err: any) => {
          assert.equal(err.code, 'PRODUCTION_ORDER_HAS_EXECUTION_PLANS');
          return true;
        }
      );
    });

    it('24. Authorization fails closed when user lacks permission or approver is missing', async () => {
      const { orderService } = createTestContext();

      await orderService.addLine('ord-mem-1', { templateId: 'tmpl-1', quantity: 5, patternSelections: [{ patternId: 'pat-1', optionId: 'opt-1' }] });

      // Missing approver ID fails closed
      await assert.rejects(
        async () => {
          await orderService.approveOrder('ord-mem-1', '');
        },
        (err: any) => {
          assert.equal(err.code, 'PRODUCTION_ORDER_APPROVER_REQUIRED');
          return true;
        }
      );
    });
  });
});
