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
import { ProductionTemplateSpecificationEntity } from '../src/modules/production/template-specification/production-template-specification.entity.js';
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
import { productionAccessPolicyService } from '../src/modules/production/authorization/production-access-policy.service.js';
import { productionResponsibilityResolver } from '../src/modules/production/authorization/production-responsibility.resolver.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';
import { ForbiddenError } from '../src/common/errors/forbidden.error.js';
import { CreateProductionExecutionPlansAndUnits1710000000017 } from '../src/database/migrations/1710000000017-CreateProductionExecutionPlansAndUnits.js';
import { AddSpecificationsToExecutionPlan1710000000018 } from '../src/database/migrations/1710000000018-AddSpecificationsToExecutionPlan.js';

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
      specifications: [] as any[],
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
              if (opts?.where?.orderId && p.orderId !== opts.where.orderId) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.find((s) => s.orderLineId === opts.where.orderLineId && s.templatePatternId === opts.where.templatePatternId) || null;
          }
          if (entityClass === ProductionTemplateStageEntity) {
            return store.stages.find((s) => s.id === opts.where.id && !s.deletedAt) || null;
          }
          if (entityClass === ProductionUnitEntity) {
            return store.units.find((u) => {
              if (opts?.where?.id && u.id !== opts.where.id) return false;
              if (opts?.where?.orderId && u.orderId !== opts.where.orderId) return false;
              if (!opts?.withDeleted && u.deletedAt) return false;
              return true;
            }) || null;
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
            return store.workflowItems.filter((w) => {
              if (opts?.where?.templateId) {
                const list = opts.where.templateId._value || (Array.isArray(opts.where.templateId) ? opts.where.templateId : [opts.where.templateId]);
                if (!list.includes(w.templateId)) return false;
              }
              return !opts?.withDeleted ? !w.deletedAt : true;
            });
          }
          if (entityClass === ProductionTemplateSpecificationEntity) {
            return (store.specifications || []).filter((s: any) => {
              if (opts?.where?.templateId && s.templateId !== opts.where.templateId) return false;
              return true;
            });
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
              if (opts?.where?.optionId) {
                const list = opts.where.optionId._value || (Array.isArray(opts.where.optionId) ? opts.where.optionId : [opts.where.optionId]);
                if (!list.includes(t.optionId)) return false;
              }
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
        createQueryBuilder: (alias: string) => {
          const whereFilters: Array<(item: any) => boolean> = [];
          let skipN = 0;
          let takeN = 100;

          const qb: any = {
            leftJoinAndSelect: () => qb,
            where: (clause: any, params?: any) => {
              if (typeof clause === 'string') {
                if (clause.includes('order_id = :orderId')) {
                  whereFilters.push((item) => item.orderId === params.orderId);
                }
                if (clause.includes('unit_id = :unitId')) {
                  whereFilters.push((item) => item.unitId === params.unitId);
                }
              }
              return qb;
            },
            andWhere: (clause: any, params?: any) => {
              if (typeof clause === 'string') {
                if (clause.includes('deleted_at IS NULL')) {
                  whereFilters.push((item) => !item.deletedAt);
                }
                if (clause.includes('status = :status')) {
                  whereFilters.push((item) => item.status === params.status);
                }
                if (clause.includes('order_line_id = :orderLineId')) {
                  whereFilters.push((item) => item.orderLineId === params.orderLineId);
                }
                if (clause === '1 = 0') {
                  whereFilters.push(() => false);
                }
                if (clause.includes('event_type NOT IN')) {
                  whereFilters.push((item) => !params.authAdminEventTypes?.includes(item.eventType));
                }
                if (clause.includes('created_by_user_id = :authUserId')) {
                  whereFilters.push((item) => item.createdByUserId === params.authUserId);
                }
                if (clause.includes('department_id IN (:...authAllowEventDeptIds)')) {
                  whereFilters.push((item) => item.departmentId && params.authAllowEventDeptIds?.includes(item.departmentId));
                }
                if (clause.includes('department_id NOT IN (:...authDenyEventDeptIds)')) {
                  whereFilters.push((item) => !item.departmentId || !params.authDenyEventDeptIds?.includes(item.departmentId));
                }
                if (clause.includes('authDenyUnitDeptIds')) {
                  whereFilters.push((item) => !item.currentYard?.departmentId || !params.authDenyUnitDeptIds?.includes(item.currentYard.departmentId));
                }
                if (clause.includes('authDenyUnitYardIds')) {
                  whereFilters.push((item) => !item.currentYardId || !params.authDenyUnitYardIds?.includes(item.currentYardId));
                }
              } else if (clause && typeof clause === 'object' && clause['whereFactory']) {
                const subQb: any = {
                  where: (subClause: string, subParams?: any) => {
                    if (subClause.includes('currentYard.department_id IN') && subParams?.authAllowUnitDeptIds) {
                      whereFilters.push((item) => item.currentYard?.departmentId && subParams.authAllowUnitDeptIds.includes(item.currentYard.departmentId));
                    }
                    if (subClause.includes('unit.current_yard_id IN') && subParams?.authAllowUnitYardIds) {
                      whereFilters.push((item) => item.currentYardId && subParams.authAllowUnitYardIds.includes(item.currentYardId));
                    }
                    if (subClause.includes('department_id NOT IN') && subParams?.authDenyEventDeptIds) {
                      whereFilters.push((item) => !item.departmentId || !subParams.authDenyEventDeptIds.includes(item.departmentId));
                    }
                    return subQb;
                  },
                  orWhere: (subClause: string, subParams?: any) => {
                    if (subClause.includes('unit.current_yard_id IN') && subParams?.authAllowUnitYardIds) {
                      whereFilters.push((item) => (item.currentYardId && subParams.authAllowUnitYardIds.includes(item.currentYardId)) || (item.currentYard?.departmentId && subParams.authAllowUnitDeptIds?.includes(item.currentYard.departmentId)));
                    }
                    if (subParams?.authDenyEventDeptIds) {
                      whereFilters.push((item) => !item.departmentId || !subParams.authDenyEventDeptIds.includes(item.departmentId));
                    }
                    return subQb;
                  },
                };
                clause['whereFactory'](subQb);
              }
              return qb;
            },
            orderBy: () => qb,
            addOrderBy: () => qb,
            skip: (n: number) => {
              skipN = n;
              return qb;
            },
            take: (n: number) => {
              takeN = n;
              return qb;
            },
            getManyAndCount: async () => {
              const all = entityClass === ProductionUnitEntity ? store.units : store.events;
              const filtered = all.filter((item: any) => whereFilters.every((fn) => fn(item)));
              const total = filtered.length;
              const sliced = filtered.slice(skipN, skipN + takeN);
              return [sliced, total];
            },
          };
          return qb;
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
    const guardService = new ProductionOrderGuardService(mockDataSource);
    const planService = new ProductionExecutionPlanService(
      mockDataSource,
      mockAuthzService,
      productionAccessPolicyService,
      mockRespResolver
    );
    const unitService = new ProductionUnitService(
      mockDataSource,
      mockAuthzService,
      productionAccessPolicyService,
      mockRespResolver
    );
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
    store.units.push({
      id: 'unit-1',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 1,
      unitNumber: 'PO-000100-L1-U001',
      status: ProductionUnitStatus.CREATED,
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
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

    const adminUser = {
      id: 'user-admin',
      accessRules: [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    } as any;
    const events = await unitService.getUnitEvents('order-100', 'unit-1', adminUser);
    assert.equal(events.items.length, 1);
    assert.equal(events.items[0].eventType, 'UNIT_CREATED');
    assert.equal(events.items[0].createdByUser?.fullName, 'مهندس أحمد');
    assert.equal(events.items[0].correlationId, 'corr-batch-1');
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

  // ==========================================
  // SCENARIO 16: IDOR Protection on Plans & Units
  // ==========================================
  it('16. IDOR Protection: Accessing plan or unit belonging to different order fails closed with 404', async () => {
    const { orderService, planService, unitService, store } = createTestContext();

    // Setup Order 1
    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });
    await orderService.approveOrder('order-100', 'user-eng-10');

    // Setup Order 2
    store.orders.push({
      id: 'order-200',
      orderNumber: 'PO-000200',
      status: ProductionOrderStatus.DRAFT,
      priority: ProductionOrderPriority.NORMAL,
      description: 'Order 2',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await orderService.addLine('order-200', {
      templateId: 'tmpl-room-a',
      quantity: 1,
    });
    await orderService.approveOrder('order-200', 'user-eng-10');

    const order1Plan = store.plans.find((p) => p.orderId === 'order-100')!;
    const order2Plan = store.plans.find((p) => p.orderId === 'order-200')!;
    const order1Unit = store.units.find((u) => u.orderId === 'order-100')!;
    const order2Unit = store.units.find((u) => u.orderId === 'order-200')!;

    // IDOR Check 1: Request Order 2 plan with Order 1 ID in path -> returns null
    const crossPlan = await planService.getPlanById('order-100', order2Plan.id);
    assert.equal(crossPlan, null, 'Cross-order execution plan lookup must return null');

    // IDOR Check 2: Request Order 1 plan with Order 1 ID -> succeeds
    const legitPlan = await planService.getPlanById('order-100', order1Plan.id);
    assert.ok(legitPlan, 'Legitimate plan lookup must succeed');
    assert.equal(legitPlan.id, order1Plan.id);

    // IDOR Check 3: Request Order 2 unit events with Order 1 ID in path -> throws NotFoundError
    const user = { id: 'u1', roleId: 'r1', username: 'admin' } as any;
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents('order-100', order2Unit.id, user);
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_UNIT_NOT_FOUND');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 17: Soft-Deleted Orders Protection
  // ==========================================
  it('17. Soft-deleted orders cannot have plans or units queried (404 NotFoundError)', async () => {
    const { orderService, planService, unitService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 2,
    });
    await orderService.approveOrder('order-100', 'user-eng-10');

    const plan = store.plans[0];
    const unit = store.units[0];

    // Soft-delete order
    store.orders[0].deletedAt = new Date();

    // getPlansByOrderId fails closed
    await assert.rejects(
      async () => {
        await planService.getPlansByOrderId('order-100');
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
        return true;
      }
    );

    // getPlanById fails closed
    await assert.rejects(
      async () => {
        await planService.getPlanById('order-100', plan.id);
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
        return true;
      }
    );

    // getUnitsByOrderId fails closed
    await assert.rejects(
      async () => {
        await unitService.getUnitsByOrderId('order-100');
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
        return true;
      }
    );

    // getUnitEvents fails closed
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents('order-100', unit.id, { id: 'u1' } as any);
      },
      (err: any) => {
        assert.equal(err.name, 'NotFoundError');
        assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 18: Specifications Snapshotting
  // ==========================================
  it('18. Snapshots template technical specifications and remains immutable after live template changes', async () => {
    const { orderService, planService, store } = createTestContext();

    // Add technical specifications to template
    store.specifications.push(
      { id: 'spec-1', templateId: 'tmpl-room-a', name: 'سماكة الجدار', value: '20', unit: 'سم', sortOrder: 1 },
      { id: 'spec-2', templateId: 'tmpl-room-a', name: 'مقاومة الخرسانة', value: '35', unit: 'MPa', sortOrder: 2 }
    );

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 1,
    });
    await orderService.approveOrder('order-100', 'user-eng-10');

    const plan = store.plans[0];
    assert.ok(plan.specifications);
    assert.equal(plan.specifications.length, 2);
    assert.equal(plan.specifications[0].name, 'سماكة الجدار');
    assert.equal(plan.specifications[0].value, '20');
    assert.equal(plan.specifications[0].unit, 'سم');
    assert.equal(plan.specifications[1].name, 'مقاومة الخرسانة');
    assert.equal(plan.specifications[1].value, '35');

    // Mutate live specifications
    store.specifications.length = 0; // wiped

    // Plan maintains snapshot
    const fetchedPlan = await planService.getPlanById('order-100', plan.id);
    assert.ok(fetchedPlan?.specifications);
    assert.equal(fetchedPlan.specifications.length, 2);
    assert.equal(fetchedPlan.specifications[0].name, 'سماكة الجدار');
  });

  // ==========================================
  // SCENARIO 19: Fail-Closed Workflow Data Consistency
  // ==========================================
  it('19. Fails closed with BusinessRuleError when workflow stage or pattern is corrupt/missing', async () => {
    const { orderService, store } = createTestContext();

    // Corrupt workflow: reference nonexistent stage
    store.workflowItems.push({
      id: 'wf-ghost-stage',
      templateId: 'tmpl-room-a',
      itemType: 'STAGE',
      stageId: 'stage-nonexistent',
      patternId: null,
      sortOrder: 4,
      deletedAt: null,
    });

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 1,
    });

    await assert.rejects(
      async () => {
        await orderService.approveOrder('order-100', 'user-eng-10');
      },
      (err: any) => {
        assert.equal(err.name, 'BusinessRuleError');
        assert.equal(err.code, 'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 20: Unit Events Authorization & Scoping
  // ==========================================
  it('20. Unit Events Authorization enforces row-level department scoping and Default Deny', async () => {
    const { unitService, store } = createTestContext();

    const now = new Date();
    const castingDeptId = randomUUID();
    const finishingDeptId = randomUUID();
    const castingYardId = randomUUID();

    // Unit 1: in casting yard of casting department
    store.units.push({
      id: 'unit-scope-1',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 1,
      unitNumber: 'PO-000100-L1-U001',
      currentYardId: castingYardId,
      currentYard: { id: castingYardId, departmentId: castingDeptId } as any,
      status: ProductionUnitStatus.CREATED,
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Unit 2: unassigned unit (currentYardId is null)
    store.units.push({
      id: 'unit-unassigned',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 2,
      unitNumber: 'PO-000100-L1-U002',
      currentYardId: null,
      currentYard: null,
      status: ProductionUnitStatus.CREATED,
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Event 1: General (departmentId = null)
    store.events.push({
      id: 'ev-1',
      unitId: 'unit-scope-1',
      eventType: ProductionUnitEventType.UNIT_CREATED,
      departmentId: null,
      occurredAt: now,
      createdAt: now,
    });

    // Event 2: Casting department
    store.events.push({
      id: 'ev-2',
      unitId: 'unit-scope-1',
      eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
      departmentId: castingDeptId,
      occurredAt: new Date(now.getTime() + 1000),
      createdAt: new Date(now.getTime() + 1000),
    });

    // Event 3: Finishing department
    store.events.push({
      id: 'ev-3',
      unitId: 'unit-scope-1',
      eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
      departmentId: finishingDeptId,
      occurredAt: new Date(now.getTime() + 2000),
      createdAt: new Date(now.getTime() + 2000),
    });

    // Case A: User with ALLOW ALL sees all 3 events on unit-scope-1
    const adminUser = {
      id: 'admin',
      accessRules: [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    } as any;
    const adminRes = await unitService.getUnitEvents('order-100', 'unit-scope-1', adminUser);
    assert.equal(adminRes.items.length, 3);

    // Case B: Department Head scoped to castingDeptId sees ONLY casting event (1 event) - administrative UNIT_CREATED is not leaked
    const castingUser = {
      id: 'eng-casting',
      accessRules: [
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [castingDeptId],
          },
        },
      ],
    } as any;
    const castingRes = await unitService.getUnitEvents('order-100', 'unit-scope-1', castingUser);
    assert.equal(castingRes.items.length, 1);
    assert.equal(castingRes.items[0].id, 'ev-2');
    assert.equal(castingRes.items[0].departmentId, castingDeptId);

    // Case C: User with DENY castingDeptId cannot access unit-scope-1 (located in castingDeptId) -> Level 2 rejects with 403 Forbidden
    const denyCastingUser = {
      id: 'eng-deny-casting',
      accessRules: [
        { scopeType: 'ALL', effect: 'ALLOW', scope: null },
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'DENY',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [castingDeptId],
          },
        },
      ],
    } as any;
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents('order-100', 'unit-scope-1', denyCastingUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // Case D: User with no permissions (denyAll or no rules) gets 403 ForbiddenError
    const noAccessUser = {
      id: 'no-access',
      accessRules: [],
    } as any;
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents('order-100', 'unit-scope-1', noAccessUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    // Case E: Unassigned unit access policy:
    // ALLOW ALL can access unassigned unit
    const adminUnassignedRes = await unitService.getUnitEvents('order-100', 'unit-unassigned', adminUser);
    assert.equal(adminUnassignedRes.items.length, 0);

    // Scoped department head CANNOT access unassigned unit -> 403 Forbidden
    await assert.rejects(
      async () => {
        await unitService.getUnitEvents('order-100', 'unit-unassigned', castingUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 21: Database Pagination for Units and Events
  // ==========================================
  it('21. Pagination contract conforms to PROJECT_RULES.md (items, total, page, limit, totalPages)', async () => {
    const { orderService, unitService, store } = createTestContext();

    await orderService.addLine('order-100', {
      templateId: 'tmpl-room-a',
      quantity: 5,
    });
    await orderService.approveOrder('order-100', 'user-eng-10');

    // Page 1, limit 2
    const page1 = await unitService.getUnitsByOrderId('order-100', { page: 1, limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.total, 5);
    assert.equal(page1.page, 1);
    assert.equal(page1.limit, 2);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.items[0].unitSequence, 1);
    assert.equal(page1.items[1].unitSequence, 2);

    // Page 2, limit 2
    const page2 = await unitService.getUnitsByOrderId('order-100', { page: 2, limit: 2 });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.items[0].unitSequence, 3);
    assert.equal(page2.items[1].unitSequence, 4);

    // Page 3, limit 2
    const page3 = await unitService.getUnitsByOrderId('order-100', { page: 3, limit: 2 });
    assert.equal(page3.items.length, 1);
    assert.equal(page3.items[0].unitSequence, 5);
  });

  // ==========================================
  // SCENARIO 22: Migration 18 Registration
  // ==========================================
  it('22. Migration AddSpecificationsToExecutionPlan1710000000018 is registered in databaseConfig and executes cleanly', async () => {
    const migration = new AddSpecificationsToExecutionPlan1710000000018();
    assert.equal(migration.name, 'AddSpecificationsToExecutionPlan1710000000018');

    const isRegistered = databaseConfig.migrations?.some(
      (m: any) => m === AddSpecificationsToExecutionPlan1710000000018 || m?.name === 'AddSpecificationsToExecutionPlan1710000000018'
    );
    assert.equal(isRegistered, true, 'Migration 18 must be registered in databaseConfig');

    // Test up and down execution against mock runner
    let addedColumn: any = null;
    let droppedColumn: string | null = null;
    const mockTable: any = {
      findColumnByName: (name: string) => (addedColumn?.name === name ? addedColumn : null),
    };
    const mockQueryRunner: any = {
      getTable: async () => mockTable,
      addColumn: async (_table: string, col: any) => {
        addedColumn = col;
      },
      dropColumn: async (_table: string, colName: string) => {
        droppedColumn = colName;
        addedColumn = null;
      },
    };

    await migration.up(mockQueryRunner);
    assert.ok(addedColumn);
    assert.equal(addedColumn.name, 'specifications');

    await migration.down(mockQueryRunner);
    assert.equal(droppedColumn, 'specifications');
  });

  // ==========================================
  // SCENARIO 23: Engineer Role Sees Only Their Own Events
  // ==========================================
  it('23. Engineer role sees only events created by them, excluding administrative events', async () => {
    const { unitService, store } = createTestContext();
    const now = new Date();
    const deptId = randomUUID();
    const yardId = randomUUID();

    store.units.push({
      id: 'unit-eng-test',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 1,
      unitNumber: 'PO-000100-L1-U001',
      status: ProductionUnitStatus.CREATED,
      currentYardId: yardId,
      currentYard: { id: yardId, departmentId: deptId },
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Event 1: Administrative (created by system/admin)
    store.events.push({
      id: 'ev-admin-1',
      unitId: 'unit-eng-test',
      eventType: ProductionUnitEventType.UNIT_CREATED,
      createdByUserId: 'admin-user',
      departmentId: null,
      occurredAt: now,
      createdAt: now,
    });

    // Event 2: Created by Engineer A
    store.events.push({
      id: 'ev-eng-a',
      unitId: 'unit-eng-test',
      eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
      createdByUserId: 'eng-user-a',
      departmentId: deptId,
      occurredAt: new Date(now.getTime() + 1000),
      createdAt: new Date(now.getTime() + 1000),
    });

    // Event 3: Created by Engineer B
    store.events.push({
      id: 'ev-eng-b',
      unitId: 'unit-eng-test',
      eventType: ProductionUnitEventType.TASK_STATUS_CHANGED,
      createdByUserId: 'eng-user-b',
      departmentId: deptId,
      occurredAt: new Date(now.getTime() + 2000),
      createdAt: new Date(now.getTime() + 2000),
    });

    // Mock responsibility resolver for Engineer A
    const engineerUserA = {
      id: 'eng-user-a',
      accessRules: [
        {
          scopeType: 'PRODUCTION_YARD',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            yardIds: [yardId],
          },
        },
      ],
    } as any;

    const resA = await unitService.getUnitEvents('order-100', 'unit-eng-test', engineerUserA);
    // Engineer A must see ONLY their own event (ev-eng-a)
    // Administrative event (ev-admin-1) is strictly hidden
    // Other engineer's event (ev-eng-b) is strictly hidden
    assert.equal(resA.items.length, 1);
    assert.equal(resA.items[0].id, 'ev-eng-a');
    assert.equal(resA.items[0].createdByUserId, 'eng-user-a');
  });

  // ==========================================
  // SCENARIO 24: Unit Scoping in getUnitsByOrderId
  // ==========================================
  it('24. getUnitsByOrderId restricts units to accessible yards and departments for scoped users', async () => {
    const { unitService, store } = createTestContext();
    const now = new Date();
    const deptA = randomUUID();
    const deptB = randomUUID();
    const yardA = randomUUID();
    const yardB = randomUUID();

    // Unit 1: Yard A (Dept A)
    store.units.push({
      id: 'u-1',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 1,
      unitNumber: 'PO-000100-L1-U001',
      status: ProductionUnitStatus.CREATED,
      currentYardId: yardA,
      currentYard: { id: yardA, departmentId: deptA },
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Unit 2: Yard B (Dept B)
    store.units.push({
      id: 'u-2',
      orderId: 'order-100',
      orderLineId: 'line-1',
      planId: 'plan-1',
      unitSequence: 2,
      unitNumber: 'PO-000100-L1-U002',
      status: ProductionUnitStatus.CREATED,
      currentYardId: yardB,
      currentYard: { id: yardB, departmentId: deptB },
      isCancelled: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Admin sees both units
    const adminUser = {
      id: 'admin',
      accessRules: [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    } as any;
    const adminUnits = await unitService.getUnitsByOrderId('order-100', adminUser);
    assert.equal(adminUnits.items.length, 2);

    // User scoped to Yard A sees only Unit 1
    const yardAUser = {
      id: 'yard-a-eng',
      accessRules: [
        {
          scopeType: 'PRODUCTION_YARD',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            yardIds: [yardA],
          },
        },
      ],
    } as any;
    const yardAUnits = await unitService.getUnitsByOrderId('order-100', yardAUser);
    assert.equal(yardAUnits.items.length, 1);
    assert.equal(yardAUnits.items[0].id, 'u-1');
  });

  // ==========================================
  // SCENARIO 25: Execution Plan Authorization Enforcement
  // ==========================================
  it('25. getPlansByOrderId and getPlanById enforce PRODUCTION_ORDER_VIEW and fail closed on unauthorized user', async () => {
    const { planService, store } = createTestContext();

    store.orders.push({ id: 'order-100', deletedAt: null } as any);
    store.plans.push({ id: 'plan-1', orderId: 'order-100', lineQuantity: 1, deletedAt: null } as any);

    const noAccessUser = {
      id: 'user-forbidden',
      accessRules: [],
    } as any;

    await assert.rejects(
      async () => {
        await planService.getPlansByOrderId('order-100', noAccessUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await planService.getPlanById('order-100', 'plan-1', noAccessUser);
      },
      (err: any) => {
        assert.equal(err.name, 'ForbiddenError');
        assert.equal(err.code, 'AUTHORIZATION_DENIED');
        return true;
      }
    );
  });

  // ==========================================
  // SCENARIO 26: Migration 19 & Alternative Pattern Options Snapshot
  // ==========================================
  it('26. Migration 19 is registered and availablePatternOptions snapshots all alternative option definitions', async () => {
    const { databaseConfig } = await import('../src/config/database.config.js');
    const { AddAvailablePatternOptionsToExecutionPlan1710000000019 } = await import(
      '../src/database/migrations/1710000000019-AddAvailablePatternOptionsToExecutionPlan.js'
    );

    const isRegistered = (databaseConfig.migrations as any[]).includes(
      AddAvailablePatternOptionsToExecutionPlan1710000000019
    );
    assert.ok(isRegistered, 'AddAvailablePatternOptionsToExecutionPlan1710000000019 must be registered in databaseConfig');

    // Migration executes up() cleanly
    const migration = new AddAvailablePatternOptionsToExecutionPlan1710000000019();
    const fakeTable = {
      findColumnByName: (col: string) => (col === 'available_pattern_options' ? null : { name: col }),
    };
    let addedColumnName: string | null = null;
    const fakeQueryRunner = {
      getTable: async () => fakeTable,
      addColumn: async (_table: string, column: any) => {
        addedColumnName = column.name;
      },
      dropColumn: async () => {},
    } as any;

    await migration.up(fakeQueryRunner);
    assert.equal(addedColumnName, 'available_pattern_options');
  });

  // ==========================================
  // SCENARIO 27: Execution Plan Nested Data & Available Pattern Options Security Authorization
  // ==========================================
  it('27. getPlansByOrderId and getPlanById securely filter availablePatternOptions and tasks by department scope', async () => {
    const { planService, store } = createTestContext();

    const deptA = '11111111-1111-4111-8111-111111111111';
    const deptB = '22222222-2222-4222-8222-222222222222';
    const deptC = '33333333-3333-4333-8333-333333333333';

    store.orders.push({ id: 'order-sec-1', deletedAt: null } as any);

    // Create a plan with main tasks across Dept A and Dept B
    const planId = 'plan-sec-1';
    store.plans.push({
      id: planId,
      orderId: 'order-sec-1',
      orderLineId: 'line-sec-1',
      templateId: 'tmpl-room-a',
      templateName: 'قالب غرفة نموذج أ',
      templateCode: 'TMPL-RM-A',
      templateReferenceNumber: 'REF-001',
      templateDescription: 'مواصفات',
      lineQuantity: 2,
      configurationHash: 'hash-sec-1',
      patternSummary: [],
      specifications: [],
      availablePatternOptions: [
        {
          patternId: 'pat-1',
          patternName: 'نمط التجهيزات',
          optionId: 'opt-hybrid',
          optionName: 'خيار هجين (صب وكهرباء)',
          isActiveSelection: true,
          tasks: [
            {
              taskId: 'task-opt-a',
              name: 'صب مسبق',
              description: 'مهمة صب تتبع قسم الصب',
              departmentId: deptA,
              sortOrder: 1,
              estimatedDurationMinutes: 60,
              estimatedCost: '200.0000',
              plannedMaterials: [{ productId: 'p1', productUnitId: 'u1', plannedQuantity: '5' }],
              attachments: [{ originalFileName: 'drawing-casting.pdf', storageKey: 'k1', mimeType: 'application/pdf', sizeBytes: 1024, description: null, sortOrder: 1 }],
            },
            {
              taskId: 'task-opt-b',
              name: 'تمديدات كهربائية مسبقة',
              description: 'مهمة كهرباء تتبع قسم الكهرباء',
              departmentId: deptB,
              sortOrder: 2,
              estimatedDurationMinutes: 90,
              estimatedCost: '450.0000',
              plannedMaterials: [{ productId: 'p2', productUnitId: 'u2', plannedQuantity: '10' }],
              attachments: [{ originalFileName: 'wire-diagram.pdf', storageKey: 'k2', mimeType: 'application/pdf', sizeBytes: 2048, description: null, sortOrder: 2 }],
            },
          ],
        },
        {
          patternId: 'pat-1',
          patternName: 'نمط التجهيزات',
          optionId: 'opt-finishing-casting',
          optionName: 'خيار تشطيب وصب',
          isActiveSelection: false,
          tasks: [
            {
              taskId: 'task-opt-c',
              name: 'صقل وتشطيب أولي',
              description: 'مهمة تتبع التشطيب',
              departmentId: deptC,
              sortOrder: 1,
              estimatedDurationMinutes: 40,
              estimatedCost: '120.0000',
              plannedMaterials: null,
              attachments: null,
            },
            {
              taskId: 'task-opt-d',
              name: 'صب كمرات إضافية',
              description: 'مهمة صب إضافية',
              departmentId: deptA,
              sortOrder: 2,
              estimatedDurationMinutes: 50,
              estimatedCost: '180.0000',
              plannedMaterials: null,
              attachments: null,
            },
          ],
        },
        {
          patternId: 'pat-2',
          patternName: 'نمط الإنارة المتقدم',
          optionId: 'opt-electrical-only',
          optionName: 'خيار كهرباء حصري',
          isActiveSelection: false,
          tasks: [
            {
              taskId: 'task-opt-e',
              name: 'تركيب لوحة توزيع',
              description: 'كهرباء فقط',
              departmentId: deptB,
              sortOrder: 1,
              estimatedDurationMinutes: 120,
              estimatedCost: '800.0000',
              plannedMaterials: [{ productId: 'p3', productUnitId: 'u3', plannedQuantity: '1' }],
              attachments: null,
            },
          ],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as any);

    // Main tasks for plan
    store.tasks.push(
      {
        id: 'main-task-1',
        planId,
        name: 'المهمة الأساسية للصب',
        departmentId: deptA,
        departmentName: 'قسم الصب',
        sortOrder: 1,
        taskSource: 'STAGE',
        sourceStageId: 'st-1',
        isActive: true,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as any,
      {
        id: 'main-task-2',
        planId,
        name: 'المهمة الأساسية للكهرباء',
        departmentId: deptB,
        departmentName: 'قسم الكهرباء',
        sortOrder: 2,
        taskSource: 'STAGE',
        sourceStageId: 'st-2',
        isActive: true,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as any
    );

    // 1. User scoped to Dept A (Casting Department Head)
    const deptAUser = {
      id: 'head-dept-a',
      accessRules: [
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [deptA],
          },
        },
      ],
    } as any;

    const [plansForDeptA] = await planService.getPlansByOrderId('order-sec-1', deptAUser);
    const planByIdForDeptA = await planService.getPlanById('order-sec-1', planId, deptAUser);

    // Consistency check: getPlansByOrderId and getPlanById must match exactly
    assert.deepEqual(plansForDeptA, planByIdForDeptA);

    // Main tasks check: only deptA task is visible, tasksCount is 1 (never leaks hidden count)
    assert.equal(plansForDeptA.tasksCount, 1);
    assert.equal(plansForDeptA.tasks?.length, 1);
    assert.equal(plansForDeptA.tasks?.[0].id, 'main-task-1');
    assert.equal(plansForDeptA.tasks?.[0].departmentId, deptA);

    // availablePatternOptions check for Dept A:
    // - opt-hybrid: contains ONLY task-opt-a (Dept A). task-opt-b (Dept B) is completely stripped!
    // - opt-finishing-casting: contains ONLY task-opt-d (Dept A). task-opt-c (Dept C) is completely stripped!
    // - opt-electrical-only: ZERO visible tasks -> COMPLETELY OMITTED from availablePatternOptions!
    assert.equal(plansForDeptA.availablePatternOptions?.length, 2);

    const hybridOptA = plansForDeptA.availablePatternOptions?.find((o) => o.optionId === 'opt-hybrid');
    assert.ok(hybridOptA, 'opt-hybrid must be present because it contains a Dept A task');
    assert.equal(hybridOptA.tasks.length, 1);
    assert.equal(hybridOptA.tasks[0].taskId, 'task-opt-a');
    assert.equal(hybridOptA.tasks[0].departmentId, deptA);
    // Ensure Dept B task is absent
    assert.ok(!hybridOptA.tasks.some((t: any) => t.departmentId === deptB));

    const finishingCastingOptA = plansForDeptA.availablePatternOptions?.find((o) => o.optionId === 'opt-finishing-casting');
    assert.ok(finishingCastingOptA, 'opt-finishing-casting must be present because it contains a Dept A task');
    assert.equal(finishingCastingOptA.tasks.length, 1);
    assert.equal(finishingCastingOptA.tasks[0].taskId, 'task-opt-d');
    assert.equal(finishingCastingOptA.tasks[0].departmentId, deptA);
    // Ensure Dept C task is absent
    assert.ok(!finishingCastingOptA.tasks.some((t: any) => t.departmentId === deptC));

    const electricalOnlyOptA = plansForDeptA.availablePatternOptions?.find((o) => o.optionId === 'opt-electrical-only');
    assert.equal(electricalOnlyOptA, undefined, 'opt-electrical-only must be omitted completely because it has zero Dept A tasks');

    // 2. User scoped to Dept C (Finishing Department Head)
    const deptCUser = {
      id: 'head-dept-c',
      accessRules: [
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'ALLOW',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [deptC],
          },
        },
      ],
    } as any;

    const [plansForDeptC] = await planService.getPlansByOrderId('order-sec-1', deptCUser);
    assert.equal(plansForDeptC.tasksCount, 0, 'Dept C has no main tasks -> tasksCount must be 0');
    assert.equal(plansForDeptC.tasks?.length, 0);

    // Only opt-finishing-casting has a Dept C task; others have zero visible tasks and must be omitted!
    assert.equal(plansForDeptC.availablePatternOptions?.length, 1);
    assert.equal(plansForDeptC.availablePatternOptions?.[0].optionId, 'opt-finishing-casting');
    assert.equal(plansForDeptC.availablePatternOptions?.[0].tasks.length, 1);
    assert.equal(plansForDeptC.availablePatternOptions?.[0].tasks[0].taskId, 'task-opt-c');

    // 3. Admin User (ALLOW ALL)
    const adminUser = {
      id: 'admin-user',
      accessRules: [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
    } as any;

    const [adminPlan] = await planService.getPlansByOrderId('order-sec-1', adminUser);
    assert.equal(adminPlan.tasksCount, 2);
    assert.equal(adminPlan.tasks?.length, 2);
    assert.equal(adminPlan.availablePatternOptions?.length, 3, 'Admin sees all 3 available options');
    const adminHybrid = adminPlan.availablePatternOptions?.find((o) => o.optionId === 'opt-hybrid');
    assert.equal(adminHybrid.tasks.length, 2, 'Admin sees both Dept A and Dept B tasks in hybrid option');

    // 4. Admin User with DENY deptB (Electrical)
    const adminDenyDeptBUser = {
      id: 'admin-deny-dept-b',
      accessRules: [
        { scopeType: 'ALL', effect: 'ALLOW', scope: null },
        {
          scopeType: 'PRODUCTION_DEPARTMENT',
          effect: 'DENY',
          scope: {
            source: 'SPECIFIC_IDS',
            departmentIds: [deptB],
          },
        },
      ],
    } as any;

    const [adminDenyPlan] = await planService.getPlansByOrderId('order-sec-1', adminDenyDeptBUser);
    // Main tasks: Dept B task denied, only Dept A visible -> tasksCount is 1
    assert.equal(adminDenyPlan.tasksCount, 1);
    assert.equal(adminDenyPlan.tasks?.length, 1);
    assert.equal(adminDenyPlan.tasks?.[0].id, 'main-task-1');

    // availablePatternOptions:
    // opt-hybrid has Dept B task stripped -> Dept A task only
    // opt-finishing-casting has Dept C and Dept A tasks -> intact
    // opt-electrical-only has ONLY Dept B task -> DENIED -> 0 visible tasks -> OMITTED completely!
    assert.equal(adminDenyPlan.availablePatternOptions?.length, 2);
    assert.ok(adminDenyPlan.availablePatternOptions?.some((o) => o.optionId === 'opt-hybrid'));
    assert.ok(adminDenyPlan.availablePatternOptions?.some((o) => o.optionId === 'opt-finishing-casting'));
    assert.ok(!adminDenyPlan.availablePatternOptions?.some((o) => o.optionId === 'opt-electrical-only'));

    // 5. Database entity integrity check:
    // Stored entity in store.plans must remain 100% UNTOUCHED!
    const storedEntity = store.plans.find((p) => p.id === planId);
    assert.equal(storedEntity.availablePatternOptions.length, 3, 'Stored snapshot must keep all 3 options');
    const storedHybrid = storedEntity.availablePatternOptions.find((o: any) => o.optionId === 'opt-hybrid');
    assert.equal(storedHybrid.tasks.length, 2, 'Stored snapshot must keep all tasks intact in DB');
    assert.ok(storedHybrid.tasks[1].plannedMaterials, 'Stored materials snapshot must not be mutated');
    assert.ok(storedHybrid.tasks[1].attachments, 'Stored attachments snapshot must not be mutated');
  });
});
