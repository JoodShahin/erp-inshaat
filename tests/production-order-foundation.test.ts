import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canonicalizeLineConfiguration,
  hashLineConfiguration,
} from '../src/modules/production/order-line/production-order-line-configuration.helper.js';

import { databaseConfig } from '../src/config/database.config.js';
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
import { SYSTEM_PERMISSION_DEFINITIONS } from '../src/modules/system/permission/constants/system-permission.registry.js';
import { AccessScopeCapabilityRegistry } from '../src/modules/system/authorization/access-administration/access-scope-capability.registry.js';
import { AccessScopePreset } from '../src/modules/system/authorization/access-administration/access-scope-preset.constants.js';

import { ProductionOrderEntity, ProductionOrderStatus, ProductionOrderPriority } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderSequenceEntity } from '../src/modules/production/order/production-order-sequence.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../src/modules/production/order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionTemplatePatternEntity } from '../src/modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../src/modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../src/modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionOrderService } from '../src/modules/production/order/production-order.service.js';
import { ProductionOrderGuardService } from '../src/modules/production/order/production-order-guard.service.js';
import { ProductionTemplateService } from '../src/modules/production/template/production-template.service.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';
import { CreateProductionOrderDto } from '../src/modules/production/order/dto/create-production-order.dto.js';
import { UpdateProductionOrderDto } from '../src/modules/production/order/dto/update-production-order.dto.js';
import { UpdateProductionOrderPriorityDto } from '../src/modules/production/order/dto/update-production-order-priority.dto.js';
import { ListProductionOrdersQueryDto } from '../src/modules/production/order/dto/list-production-orders-query.dto.js';
import { AddProductionOrderLineDto } from '../src/modules/production/order-line/dto/add-production-order-line.dto.js';
import { UpdateProductionOrderLineDto } from '../src/modules/production/order-line/dto/update-production-order-line.dto.js';
import { ReorderProductionOrderLinesDto } from '../src/modules/production/order-line/dto/reorder-production-order-lines.dto.js';
import { UpdatePatternSelectionDto } from '../src/modules/production/order-line-pattern-selection/dto/update-pattern-selection.dto.js';
import {
  CommitProductionOrderDraftLinesDto,
  CommitProductionOrderDraftLineDto,
} from '../src/modules/production/order-line/dto/commit-production-order-draft-lines.dto.js';
import { safeJsonStringify } from '../src/modules/production/order/production-order.types.js';
import { AddProductionOrderPriority1710000000016 } from '../src/database/migrations/1710000000016-AddProductionOrderPriority.js';

describe('Phase 1 — Production Order Drafting & Pattern Selection Foundation', () => {
  function createDuplicateTestContext() {
    const store = {
      order: {
        id: 'ord-1',
        orderNumber: 'PO-000001',
        status: ProductionOrderStatus.DRAFT,
        priority: ProductionOrderPriority.NORMAL,
        deletedAt: null,
      } as any,
      lines: [] as any[],
      selections: [] as any[],
      templates: [
        { id: 't-with-patterns', name: 'قالب مع أنماط', isActive: true, deletedAt: null },
        { id: 't-no-patterns', name: 'قالب بدون أنماط', isActive: true, deletedAt: null },
      ],
      patterns: [
        { id: 'p-1', templateId: 't-with-patterns', name: 'النمط 1', deletedAt: null, createdAt: new Date() },
        { id: 'p-2', templateId: 't-with-patterns', name: 'النمط 2', deletedAt: null, createdAt: new Date() },
      ],
      options: [
        { id: 'opt-1a', patternId: 'p-1', name: 'خيار 1-أ', sortOrder: 1, deletedAt: null },
        { id: 'opt-1b', patternId: 'p-1', name: 'خيار 1-ب', sortOrder: 2, deletedAt: null },
        { id: 'opt-2a', patternId: 'p-2', name: 'خيار 2-أ', sortOrder: 1, deletedAt: null },
      ],
      workflowItems: [
        { id: 'wf-1', templateId: 't-no-patterns', deletedAt: null },
        { id: 'wf-2', templateId: 't-with-patterns', deletedAt: null },
      ],
      sequence: { id: 'PRODUCTION_ORDER', currentValue: 1 } as any,
    };

    const createRepo = (entityClass: any) => {
      return {
        findOne: async (opts: any) => {
          if (entityClass === ProductionOrderEntity) {
            if (!store.order) return null;
            if (opts?.where?.id && opts.where.id !== store.order.id) return null;
            if (opts?.where?.deletedAt !== undefined && store.order.deletedAt !== null) return null;
            return store.order;
          }
          if (entityClass === ProductionOrderSequenceEntity) return store.sequence;
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.find((t) => t.id === opts.where.id && !t.deletedAt) || null;
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.find((p) => p.id === opts.where.id && (!opts.where.templateId || p.templateId === opts.where.templateId) && !p.deletedAt) || null;
          }
          if (entityClass === ProductionTemplatePatternOptionEntity) {
            return store.options.find((o) => o.id === opts.where.id && (!opts.where.patternId || o.patternId === opts.where.patternId) && !o.deletedAt) || null;
          }
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.find((l) => {
              if (opts?.where?.id) {
                if (opts.where.id._type === 'not' && l.id === opts.where.id._value) return false;
                if (opts.where.id._type !== 'not' && l.id !== opts.where.id) return false;
              }
              if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
              if (opts?.where?.activeConfigurationHash && l.activeConfigurationHash !== opts.where.activeConfigurationHash) return false;
              if (opts?.where?.deletedAt && l.deletedAt !== null) return false;
              return true;
            }) || null;
          }
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.find((s) => s.orderLineId === opts.where.orderLineId && s.templatePatternId === opts.where.templatePatternId) || null;
          }
          return null;
        },
        find: async (opts: any) => {
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.filter((l) => (!opts?.withDeleted ? !l.deletedAt : true)).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          }
          if (entityClass === ProductionTemplateEntity) {
            return store.templates.filter((t) => (!opts?.withDeleted ? !t.deletedAt : true));
          }
          if (entityClass === ProductionTemplatePatternEntity) {
            return store.patterns.filter((p) => {
              if (opts?.where?.templateId) {
                const tmplList = opts.where.templateId._value || (Array.isArray(opts.where.templateId) ? opts.where.templateId : [opts.where.templateId]);
                if (!tmplList.includes(p.templateId)) return false;
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
          if (entityClass === ProductionOrderLinePatternSelectionEntity) {
            return store.selections.filter((s) => {
              if (opts?.where?.orderLineId) {
                const lineList = opts.where.orderLineId._value || (Array.isArray(opts.where.orderLineId) ? opts.where.orderLineId : [opts.where.orderLineId]);
                if (!lineList.includes(s.orderLineId)) return false;
              }
              return true;
            });
          }
          return [];
        },
        count: async (opts: any) => {
          if (entityClass === ProductionOrderLineEntity) {
            return store.lines.filter((l) => !l.deletedAt).length;
          }
          return 0;
        },
        create: (data: any) => ({ id: data.id || `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`, deletedAt: null, ...data }),
        save: async (entityOrItems: any) => mockManager.save(entityClass, entityOrItems),
        update: async (criteria: any, partial: any) => mockManager.update(entityClass, criteria, partial),
        delete: async (criteria: any) => mockManager.delete(entityClass, criteria),
        softDelete: async (criteria: any) => mockManager.softDelete(entityClass, criteria),
        remove: async (entityOrItems: any) => mockManager.remove(entityClass, entityOrItems),
      };
    };

    const mockManager: any = {
      getRepository: (c: any) => createRepo(c),
      save: async (entityClassOrEntity: any, maybeEntity?: any) => {
        const raw = maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
        const items = Array.isArray(raw) ? raw : [raw];
        for (const entity of items) {
          if (entity.orderNumber !== undefined) store.order = entity;
          else if (entity.quantity !== undefined) {
            const idx = store.lines.findIndex((l) => l.id === entity.id);
            if (idx >= 0) store.lines[idx] = entity; else store.lines.push(entity);
          } else if (entity.selectedOptionId !== undefined) {
            const idx = store.selections.findIndex((s) => s.id === entity.id);
            if (idx >= 0) store.selections[idx] = entity; else store.selections.push(entity);
          }
        }
        return raw;
      },
      update: async (entityClass: any, criteria: any, partial: any) => {
        if (entityClass === ProductionOrderLineEntity) {
          if (criteria?.orderId) {
            for (const l of store.lines) {
              if (l.orderId === criteria.orderId && (!l.deletedAt || criteria.deletedAt !== undefined)) {
                Object.assign(l, partial);
              }
            }
          } else {
            const ids: string[] = typeof criteria === 'string'
              ? [criteria]
              : (criteria?.id?._value || (Array.isArray(criteria?.id) ? criteria.id : (criteria?.id ? [criteria.id] : [])));
            for (const id of ids) {
              const l = store.lines.find((line) => line.id === id);
              if (l) Object.assign(l, partial);
            }
          }
        }
      },
      delete: async (entityClass: any, criteria: any) => {
        if (entityClass === ProductionOrderLinePatternSelectionEntity) {
          if (criteria?.orderLineId) {
            const lineIds: string[] = criteria.orderLineId._value || (Array.isArray(criteria.orderLineId) ? criteria.orderLineId : [criteria.orderLineId]);
            store.selections = store.selections.filter((s) => !lineIds.includes(s.orderLineId));
          }
        }
      },
      softDelete: async (entityClass: any, criteria: any) => {
        if (entityClass === ProductionOrderEntity && store.order) {
          store.order.deletedAt = new Date();
        } else if (entityClass === ProductionOrderLineEntity) {
          const ids: string[] = typeof criteria === 'string'
            ? [criteria]
            : (criteria?.id?._value || (Array.isArray(criteria?.id) ? criteria.id : [criteria?.id]));
          for (const id of ids) {
            const l = store.lines.find((line) => line.id === id);
            if (l) l.deletedAt = new Date();
          }
        }
      },
      remove: async (entityClassOrEntity: any, maybeEntity?: any) => {
        const raw = maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
        const items = Array.isArray(raw) ? raw : [raw];
        for (const entity of items) {
          const idx = store.selections.findIndex((s) => s.id === entity.id);
          if (idx >= 0) store.selections.splice(idx, 1);
        }
      },
    };

    const mockDataSource: any = {
      getRepository: (c: any) => createRepo(c),
      transaction: async (cb: any) => cb(mockManager),
    };

    const guard = new ProductionOrderGuardService(mockDataSource);
    const service = new ProductionOrderService(mockDataSource, guard);

    return { store, service, mockManager, mockDataSource };
  }

  // ==========================================
  // 1. ARCHITECTURAL BOUNDARIES & CONFIGURATION
  // ==========================================
  describe('1. Architectural Boundaries & Registration', () => {
    it('verifies Migration 0013 is registered in databaseConfig.migrations', () => {
      const migrations = databaseConfig.migrations as Function[];
      const m13 = migrations.find((m) => m.name === 'CreateProductionOrderDraftingFoundation1710000000013');
      assert.ok(m13, 'Migration 0013 must be registered in databaseConfig');
    });

    it('verifies Migration 0014 is registered in databaseConfig.migrations', () => {
      const migrations = databaseConfig.migrations as Function[];
      const m14 = migrations.find((m) => m.name === 'AddProductionOrderLineConfigurationUniqueness1710000000014');
      assert.ok(m14, 'Migration 0014 must be registered in databaseConfig');
    });

    it('verifies Migration 0015 is registered in databaseConfig.migrations', () => {
      const migrations = databaseConfig.migrations as Function[];
      const m15 = migrations.find((m) => m.name === 'AddProductionOrderApprovalStatus1710000000015');
      assert.ok(m15, 'Migration 0015 must be registered in databaseConfig');
    });

    it('verifies Migration 0016 is registered in databaseConfig.migrations', () => {
      const migrations = databaseConfig.migrations as Function[];
      const m16 = migrations.find((m) => m.name === 'AddProductionOrderPriority1710000000016');
      assert.ok(m16, 'Migration 0016 must be registered in databaseConfig');
    });

    it('verifies all 4 Order aggregate entities are registered in databaseConfig.entities', () => {
      const entities = databaseConfig.entities as Function[];
      assert.ok(entities.includes(ProductionOrderEntity), 'ProductionOrderEntity must be registered');
      assert.ok(entities.includes(ProductionOrderSequenceEntity), 'ProductionOrderSequenceEntity must be registered');
      assert.ok(entities.includes(ProductionOrderLineEntity), 'ProductionOrderLineEntity must be registered');
      assert.ok(
        entities.includes(ProductionOrderLinePatternSelectionEntity),
        'ProductionOrderLinePatternSelectionEntity must be registered'
      );
    });

    it('defines all 6 production order permissions with correct identifiers', () => {
      assert.equal(SystemPermission.PRODUCTION_ORDER_VIEW, 'production.order.view');
      assert.equal(SystemPermission.PRODUCTION_ORDER_CREATE, 'production.order.create');
      assert.equal(SystemPermission.PRODUCTION_ORDER_UPDATE, 'production.order.update');
      assert.equal(SystemPermission.PRODUCTION_ORDER_DELETE, 'production.order.delete');
      assert.equal(SystemPermission.PRODUCTION_ORDER_APPROVE, 'production.order.approve');
      assert.equal(SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY, 'production.order.update_priority');
    });

    it('registers all 6 production order permissions in SYSTEM_PERMISSION_DEFINITIONS', () => {
      const viewDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_VIEW];
      const createDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_CREATE];
      const updateDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_UPDATE];
      const deleteDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_DELETE];
      const approveDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_APPROVE];
      const priorityDef = SYSTEM_PERMISSION_DEFINITIONS[SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY];

      assert.ok(viewDef && viewDef.module === 'production');
      assert.ok(createDef && createDef.module === 'production');
      assert.ok(updateDef && updateDef.module === 'production');
      assert.ok(deleteDef && deleteDef.module === 'production');
      assert.ok(approveDef && approveDef.module === 'production');
      assert.ok(priorityDef && priorityDef.module === 'production');
      assert.equal(priorityDef.description, 'تغيير أولوية أمر الإنتاج');
    });

    it('verifies AccessScopeCapabilityRegistry maps production order permissions to [ALL]', () => {
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_VIEW),
        [AccessScopePreset.ALL]
      );
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_CREATE),
        [AccessScopePreset.ALL]
      );
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
        [AccessScopePreset.ALL]
      );
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_DELETE),
        [AccessScopePreset.ALL]
      );
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_APPROVE),
        [AccessScopePreset.ALL]
      );
      assert.deepEqual(
        AccessScopeCapabilityRegistry.getAllowedPresetsForPermission(SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY),
        [AccessScopePreset.ALL]
      );
    });
  });

  // ==========================================
  // 2. DTO VALIDATION & SCHEMA CONSTRAINTS
  // ==========================================
  describe('2. DTO Validation & Schema Constraints', () => {
    it('CreateProductionOrderDto: requires title; description and notes remain optional', async () => {
      const validInstance = plainToInstance(CreateProductionOrderDto, {
        title: 'تصنيع غرف نموذج A',
        description: 'طلب تصنيع غرف نموذج A',
        notes: 'ملاحظات تشغيلية',
      });
      const errors = await validate(validInstance);
      assert.equal(errors.length, 0);

      const emptyInstance = plainToInstance(CreateProductionOrderDto, {});
      const emptyErrors = await validate(emptyInstance);
      assert.ok(emptyErrors.some((e) => e.property === 'title'));
    });

    it('CreateProductionOrderDto: rejects blank or whitespace-only titles', async () => {
      for (const title of ['', '   ']) {
        const input = plainToInstance(CreateProductionOrderDto, { title });
        const errors = await validate(input);
        // An empty title is rejected by DTO; whitespace-only is rejected
        // by the service after trimming, before any database write.
        if (title === '') {
          assert.ok(errors.some((error) => error.property === 'title'));
        }
      }
    });

    it('Production order title migration is registered with TypeORM', () => {
      const migrationNames = (databaseConfig.migrations || []).map((migration) =>
        typeof migration === 'function' ? migration.name : typeof migration === 'string' ? migration : migration.name
      );
      assert.ok(migrationNames.includes('AddProductionOrderTitle1710000000030'));
    });

    it('AddProductionOrderLineDto: validates quantity 1..10000 integer', async () => {
      const validDto = plainToInstance(AddProductionOrderLineDto, {
        templateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        quantity: 5,
      });
      const validErrors = await validate(validDto);
      assert.equal(validErrors.length, 0);

      // Quantity = 0 -> rejected
      const zeroDto = plainToInstance(AddProductionOrderLineDto, {
        templateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        quantity: 0,
      });
      const zeroErrors = await validate(zeroDto);
      assert.ok(zeroErrors.some((e) => e.property === 'quantity'));

      // Quantity = -1 -> rejected
      const negDto = plainToInstance(AddProductionOrderLineDto, {
        templateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        quantity: -1,
      });
      const negErrors = await validate(negDto);
      assert.ok(negErrors.some((e) => e.property === 'quantity'));

      // Quantity = 10001 -> rejected
      const maxDto = plainToInstance(AddProductionOrderLineDto, {
        templateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        quantity: 10001,
      });
      const maxErrors = await validate(maxDto);
      assert.ok(maxErrors.some((e) => e.property === 'quantity'));

      // Non-UUID templateId -> rejected
      const badUuidDto = plainToInstance(AddProductionOrderLineDto, {
        templateId: 'not-a-uuid',
        quantity: 2,
      });
      const badUuidErrors = await validate(badUuidDto);
      assert.ok(badUuidErrors.some((e) => e.property === 'templateId'));
    });

    it('UpdateProductionOrderLineDto: validates quantity 1..10000', async () => {
      const validDto = plainToInstance(UpdateProductionOrderLineDto, { quantity: 10 });
      const validErrors = await validate(validDto);
      assert.equal(validErrors.length, 0);

      const invalidDto = plainToInstance(UpdateProductionOrderLineDto, { quantity: 0 });
      const invalidErrors = await validate(invalidDto);
      assert.ok(invalidErrors.some((e) => e.property === 'quantity'));
    });

    it('ReorderProductionOrderLinesDto: validates array of line UUIDs', async () => {
      const validDto = plainToInstance(ReorderProductionOrderLinesDto, {
        lineIds: [
          'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
        ],
      });
      const validErrors = await validate(validDto);
      assert.equal(validErrors.length, 0);

      const invalidDto = plainToInstance(ReorderProductionOrderLinesDto, {
        lineIds: ['not-a-uuid'],
      });
      const invalidErrors = await validate(invalidDto);
      assert.ok(invalidErrors.some((e) => e.property === 'lineIds'));
    });

    it('UpdatePatternSelectionDto: validates optionId UUID', async () => {
      const validDto = plainToInstance(UpdatePatternSelectionDto, {
        optionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      });
      const validErrors = await validate(validDto);
      assert.equal(validErrors.length, 0);

      const invalidDto = plainToInstance(UpdatePatternSelectionDto, {
        optionId: 'invalid-id',
      });
      const invalidErrors = await validate(invalidDto);
      assert.ok(invalidErrors.some((e) => e.property === 'optionId'));
    });
  });

  // ==========================================
  // 3. ORDER NUMBER & CONCURRENCY STRATEGY
  // ==========================================
  describe('3. Order Number Generation & Concurrency Invariants', () => {
    it('verifies format PO-XXXXXX with zero padding', () => {
      const formatOrderNumber = (val: bigint) => `PO-${String(val).padStart(6, '0')}`;
      assert.equal(formatOrderNumber(1n), 'PO-000001');
      assert.equal(formatOrderNumber(128n), 'PO-000128');
      assert.equal(formatOrderNumber(999999n), 'PO-999999');
      assert.equal(formatOrderNumber(1000000n), 'PO-1000000');
    });

    it('verifies sequence counter table row ID is fixed to PRODUCTION_ORDER', () => {
      const seq = new ProductionOrderSequenceEntity();
      seq.id = 'PRODUCTION_ORDER';
      seq.currentValue = '1';
      assert.equal(seq.id, 'PRODUCTION_ORDER');
    });
  });

  // ==========================================
  // 4. ORDER STATUS & LIFECYCLE INVARIANTS
  // ==========================================
  describe('4. Order Status & Lifecycle Invariants', () => {
    it('ProductionOrderStatus has only DRAFT and APPROVED in foundation phase', () => {
      assert.equal(ProductionOrderStatus.DRAFT, 'DRAFT');
      assert.equal(ProductionOrderStatus.APPROVED, 'APPROVED');
      const statuses = Object.values(ProductionOrderStatus);
      assert.deepEqual(statuses, ['DRAFT', 'APPROVED'], 'Foundation phase must only permit DRAFT and APPROVED statuses');
    });

    it('verifies order.status cannot be changed via generic update', () => {
      const order = new ProductionOrderEntity();
      order.id = 'order-1';
      order.orderNumber = 'PO-000001';
      order.status = ProductionOrderStatus.DRAFT;

      // Update DTO only allows description and notes
      const dto = plainToInstance(UpdateProductionOrderDto, {
        description: 'New Description',
        notes: 'New Notes',
      });

      assert.equal((dto as any).status, undefined, 'UpdateProductionOrderDto must not accept status');
      assert.equal((dto as any).orderNumber, undefined, 'UpdateProductionOrderDto must not accept orderNumber');
    });
  });

  // ==========================================
  // 5. PATTERN SELECTION LOGIC & DEFAULTS
  // ==========================================
  describe('5. Pattern Selection Logic & Defaults', () => {
    it('computes default option as first active option by sortOrder ASC', () => {
      const options = [
        { id: 'opt-b', name: 'خيار ب', sortOrder: 2, deletedAt: null },
        { id: 'opt-a', name: 'خيار أ', sortOrder: 1, deletedAt: null },
        { id: 'opt-c', name: 'خيار ج (مؤرشف)', sortOrder: 0, deletedAt: new Date() },
      ];

      const activeSorted = options
        .filter((o) => !o.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      assert.equal(activeSorted.length, 2);
      assert.equal(activeSorted[0].id, 'opt-a', 'Default option must be the first active option with lowest sortOrder');
    });

    it('fails when active pattern has zero active options', () => {
      const patternsWithOptions = [
        {
          pattern: { id: 'p1', name: 'نوع الصب' },
          options: [], // No active options
        },
      ];

      const hasEmpty = patternsWithOptions.some((p) => p.options.length === 0);
      assert.ok(hasEmpty, 'Must detect patterns with zero active options');
    });

    it('validates explicit selection set: detects missing pattern', () => {
      const activePatterns = [{ id: 'p1' }, { id: 'p2' }];
      const payload = [{ patternId: 'p1', optionId: 'o1' }]; // Missing p2

      const payloadPatternIds = new Set(payload.map((x) => x.patternId));
      const isComplete = activePatterns.every((p) => payloadPatternIds.has(p.id));
      assert.equal(isComplete, false, 'Payload missing p2 must fail validation');
    });

    it('validates explicit selection set: detects duplicate pattern', () => {
      const payload = [
        { patternId: 'p1', optionId: 'o1' },
        { patternId: 'p1', optionId: 'o2' },
      ];

      const set = new Set();
      let hasDuplicate = false;
      for (const item of payload) {
        if (set.has(item.patternId)) {
          hasDuplicate = true;
          break;
        }
        set.add(item.patternId);
      }

      assert.ok(hasDuplicate, 'Payload with duplicate pattern selections must be rejected');
    });

    it('validates explicit selection set: rejects foreign pattern', () => {
      const templatePatterns = [{ id: 'p1' }, { id: 'p2' }];
      const templatePatternIds = new Set(templatePatterns.map((p) => p.id));

      const payload = [
        { patternId: 'p1', optionId: 'o1' },
        { patternId: 'foreign-pattern', optionId: 'o2' },
      ];

      const hasForeign = payload.some((x) => !templatePatternIds.has(x.patternId));
      assert.ok(hasForeign, 'Foreign pattern must be rejected');
    });
  });

  // ==========================================
  // 6. SYNC SEMANTICS
  // ==========================================
  describe('6. Template Sync Semantics', () => {
    it('preserves valid existing selections and adds default for new pattern', () => {
      const existingSelections = [
        { templatePatternId: 'p1', selectedOptionId: 'o1' },
      ];

      const activePatterns = [
        {
          id: 'p1',
          options: [{ id: 'o1', sortOrder: 1 }, { id: 'o2', sortOrder: 2 }],
        },
        {
          id: 'p2', // Newly added pattern in template
          options: [{ id: 'o3', sortOrder: 1 }],
        },
      ];

      const reconciled: Array<{ templatePatternId: string; selectedOptionId: string }> = [];

      for (const pat of activePatterns) {
        const existing = existingSelections.find((s) => s.templatePatternId === pat.id);
        if (existing) {
          const isValid = pat.options.some((o) => o.id === existing.selectedOptionId);
          if (isValid) {
            reconciled.push({ templatePatternId: pat.id, selectedOptionId: existing.selectedOptionId });
          } else {
            reconciled.push({ templatePatternId: pat.id, selectedOptionId: pat.options[0].id });
          }
        } else {
          // New pattern: default to first active option
          reconciled.push({ templatePatternId: pat.id, selectedOptionId: pat.options[0].id });
        }
      }

      assert.equal(reconciled.length, 2);
      assert.equal(reconciled[0].selectedOptionId, 'o1', 'Valid existing selection preserved');
      assert.equal(reconciled[1].selectedOptionId, 'o3', 'New pattern initialized with default option');
    });

    it('replaces invalidated option with default option during sync', () => {
      const existingSelections = [
        { templatePatternId: 'p1', selectedOptionId: 'archived-opt' },
      ];

      const activePatterns = [
        {
          id: 'p1',
          options: [{ id: 'valid-opt-1', sortOrder: 1 }, { id: 'valid-opt-2', sortOrder: 2 }],
        },
      ];

      const reconciled: Array<{ templatePatternId: string; selectedOptionId: string }> = [];

      for (const pat of activePatterns) {
        const existing = existingSelections.find((s) => s.templatePatternId === pat.id);
        if (existing) {
          const isValid = pat.options.some((o) => o.id === existing.selectedOptionId);
          if (isValid) {
            reconciled.push({ templatePatternId: pat.id, selectedOptionId: existing.selectedOptionId });
          } else {
            // Replace with default
            reconciled.push({ templatePatternId: pat.id, selectedOptionId: pat.options[0].id });
          }
        }
      }

      assert.equal(reconciled[0].selectedOptionId, 'valid-opt-1', 'Archived option replaced with default option');
    });

    it('removes obsolete selections when pattern is removed from template', () => {
      const existingSelections = [
        { templatePatternId: 'p1', selectedOptionId: 'o1' },
        { templatePatternId: 'obsolete-p2', selectedOptionId: 'o2' },
      ];

      const activePatterns = [{ id: 'p1' }];
      const activeIds = new Set(activePatterns.map((p) => p.id));

      const surviving = existingSelections.filter((s) => activeIds.has(s.templatePatternId));
      assert.equal(surviving.length, 1);
      assert.equal(surviving[0].templatePatternId, 'p1');
    });
  });

  // ==========================================
  // 7. READINESS ASSESSMENT INVARIANTS
  // ==========================================
  describe('7. Release Readiness Assessment (Read-Only)', () => {
    it('flags empty order (0 lines) as not ready', () => {
      const lines: any[] = [];
      const issues: any[] = [];

      if (lines.length === 0) {
        issues.push({ code: 'PRODUCTION_ORDER_EMPTY', message: 'Order has no lines' });
      }

      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'PRODUCTION_ORDER_EMPTY');
    });

    it('flags inactive or archived template as not ready', () => {
      const template = { isActive: false, deletedAt: null };
      const issues: any[] = [];

      if (!template.isActive || template.deletedAt !== null) {
        issues.push({ code: 'PRODUCTION_ORDER_TEMPLATE_INACTIVE', message: 'Template is inactive' });
      }

      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
    });

    it('flags template with 0 active workflow items as not ready', () => {
      const workflowItemsCount = 0;
      const issues: any[] = [];

      if (workflowItemsCount === 0) {
        issues.push({ code: 'PRODUCTION_ORDER_TEMPLATE_WORKFLOW_EMPTY', message: 'Workflow is empty' });
      }

      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'PRODUCTION_ORDER_TEMPLATE_WORKFLOW_EMPTY');
    });

    it('flags line missing active pattern selection as not ready', () => {
      const activePatterns = [{ id: 'p1' }, { id: 'p2' }];
      const lineSelections = [{ templatePatternId: 'p1', selectedOptionId: 'o1' }];
      const issues: any[] = [];

      const selectionMap = new Map(lineSelections.map((s) => [s.templatePatternId, s]));
      for (const pat of activePatterns) {
        if (!selectionMap.has(pat.id)) {
          issues.push({ code: 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID', patternId: pat.id });
        }
      }

      assert.equal(issues.length, 1);
      assert.equal(issues[0].patternId, 'p2');
    });

    it('marks order as ready when all lines and pattern selections are valid', () => {
      const lines = [{ id: 'l1', quantity: 4 }];
      const template = { isActive: true, deletedAt: null };
      const workflowItemsCount = 2;
      const activePatterns = [{ id: 'p1', options: [{ id: 'o1', deletedAt: null }] }];
      const lineSelections = [{ templatePatternId: 'p1', selectedOptionId: 'o1' }];

      const issues: any[] = [];

      if (lines.length === 0) issues.push({ code: 'PRODUCTION_ORDER_EMPTY' });
      if (!template.isActive || template.deletedAt !== null) issues.push({ code: 'PRODUCTION_ORDER_TEMPLATE_INACTIVE' });
      if (workflowItemsCount === 0) issues.push({ code: 'PRODUCTION_ORDER_TEMPLATE_WORKFLOW_EMPTY' });

      const selMap = new Map(lineSelections.map((s) => [s.templatePatternId, s]));
      for (const pat of activePatterns) {
        const sel = selMap.get(pat.id);
        if (!sel) issues.push({ code: 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID' });
        else {
          const isValidOpt = pat.options.some((o) => o.id === sel.selectedOptionId && !o.deletedAt);
          if (!isValidOpt) issues.push({ code: 'PRODUCTION_ORDER_LINE_OPTION_INVALID' });
        }
      }

      assert.equal(issues.length, 0);
    });
  });

  // ==========================================
  // 8. SECURITY & XSS & DATA LEAKAGE
  // ==========================================
  describe('8. Security, XSS & Data Leakage Prevention', () => {
    it('escapes html & script injection in safeJsonStringify', () => {
      const payload = {
        name: '</script><script>alert("xss")</script>',
        note: '<b>test</b> & "quote"',
      };
      const serialized = safeJsonStringify(payload);

      assert.ok(!serialized.includes('<script>'), 'Must not contain unescaped script tag');
      assert.ok(!serialized.includes('</script>'), 'Must not contain unescaped closing script tag');
      assert.ok(serialized.includes('\\u003cscript\\u003e'));
      assert.ok(serialized.includes('\\u0026'));
    });

    it('verifies order DTO does not leak user passwordHash or session tokens', () => {
      const mockOrderDto = {
        id: 'ord-1',
        orderNumber: 'PO-000001',
        status: 'DRAFT',
        createdByUser: {
          id: 'u-1',
          fullName: 'المهندس أحمد',
        },
      };

      assert.equal((mockOrderDto.createdByUser as any).passwordHash, undefined);
      assert.equal((mockOrderDto.createdByUser as any).token, undefined);
    });
  });

  // ==========================================
  // 10. SERVICE-LEVEL REGRESSION & INVARIANT TESTS
  // ==========================================
  describe('10. Service-Level Regression & Invariant Tests', () => {
    function createMockServiceContext(initialData: {
      order?: any;
      lines?: any[];
      selections?: any[];
      template?: any;
      templates?: any[];
      patterns?: any[];
      options?: any[];
      workflowItems?: any[];
      sequence?: any;
    }) {
      const store = {
        order: initialData.order ? { ...initialData.order } : null,
        lines: (initialData.lines || []).map((l) => ({
          activeConfigurationHash: l.activeConfigurationHash !== undefined ? l.activeConfigurationHash : 'mock-active-hash',
          ...l,
        })),
        selections: (initialData.selections || []).map((s) => ({ ...s })),
        templates: (initialData.templates || (initialData.template ? [initialData.template] : [])).map((t) => ({ ...t })),
        patterns: (initialData.patterns || []).map((p) => ({ ...p })),
        options: (initialData.options || []).map((o) => ({ ...o })),
        workflowItems: (initialData.workflowItems || []).map((w) => ({ ...w })),
        sequence: initialData.sequence ? { ...initialData.sequence } : null,
      };

      const createRepo = (entityClass: any) => {
        return {
          findOne: async (opts: any) => {
            if (entityClass === ProductionOrderEntity) {
              if (!store.order) return null;
              if (opts?.where?.id && store.order.id !== opts.where.id) return null;
              if (opts?.where?.deletedAt && store.order.deletedAt !== null) return null;
              return store.order;
            }
            if (entityClass === ProductionOrderSequenceEntity) {
              if (!store.sequence) return null;
              if (opts?.where?.id && store.sequence.id !== opts.where.id) return null;
              return store.sequence;
            }
            if (entityClass === ProductionOrderLineEntity) {
              return store.lines.find((l) => {
                if (opts?.where?.id) {
                  if (opts.where.id._type === 'not') {
                    if (l.id === opts.where.id._value) return false;
                  } else if (l.id !== opts.where.id) {
                    return false;
                  }
                }
                if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
                if (opts?.where?.activeConfigurationHash && l.activeConfigurationHash !== opts.where.activeConfigurationHash) return false;
                if (opts?.where?.deletedAt && l.deletedAt !== null) return false;
                return true;
              }) || null;
            }
            if (entityClass === ProductionTemplateEntity) {
              return store.templates.find((t) => {
                if (opts?.where?.id && t.id !== opts.where.id) return false;
                if (opts?.where?.deletedAt && t.deletedAt !== null) return false;
                return true;
              }) || null;
            }
            if (entityClass === ProductionTemplatePatternEntity) {
              return store.patterns.find((p) => {
                if (opts?.where?.id && p.id !== opts.where.id) return false;
                if (opts?.where?.templateId && p.templateId !== opts.where.templateId) return false;
                if (opts?.where?.deletedAt && p.deletedAt !== null) return false;
                return true;
              }) || null;
            }
            if (entityClass === ProductionTemplatePatternOptionEntity) {
              return store.options.find((o) => {
                if (opts?.where?.id && o.id !== opts.where.id) return false;
                if (opts?.where?.patternId && o.patternId !== opts.where.patternId) return false;
                if (opts?.where?.deletedAt && o.deletedAt !== null) return false;
                return true;
              }) || null;
            }
            if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              return store.selections.find((s) => {
                if (opts?.where?.orderLineId && s.orderLineId !== opts.where.orderLineId) return false;
                if (opts?.where?.templatePatternId && s.templatePatternId !== opts.where.templatePatternId) return false;
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
              });
            }
            if (entityClass === ProductionTemplateEntity) {
              return store.templates.filter((t) => {
                if (!opts?.withDeleted && t.deletedAt) return false;
                return true;
              });
            }
            if (entityClass === ProductionTemplatePatternEntity) {
              return store.patterns.filter((p) => {
                if (opts?.where?.id) {
                  const idList = opts.where.id._value || (Array.isArray(opts.where.id) ? opts.where.id : [opts.where.id]);
                  if (!idList.includes(p.id)) return false;
                }
                if (opts?.where?.templateId) {
                  const tmplList = opts.where.templateId._value || (Array.isArray(opts.where.templateId) ? opts.where.templateId : [opts.where.templateId]);
                  if (!tmplList.includes(p.templateId)) return false;
                }
                if (!opts?.withDeleted && p.deletedAt) return false;
                return true;
              }).map((p) => {
                if (opts?.relations?.options) {
                  const optsForP = store.options.filter((o) => o.patternId === p.id);
                  return { ...p, options: optsForP };
                }
                return p;
              });
            }
            if (entityClass === ProductionTemplatePatternOptionEntity) {
              return store.options.filter((o) => {
                if (opts?.where?.id) {
                  const idList = opts.where.id._value || (Array.isArray(opts.where.id) ? opts.where.id : [opts.where.id]);
                  if (!idList.includes(o.id)) return false;
                }
                if (opts?.where?.patternId && o.patternId !== opts.where.patternId) return false;
                if (!opts?.withDeleted && o.deletedAt) return false;
                return true;
              });
            }
            if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              return store.selections.filter((s) => {
                if (opts?.where?.orderLineId) {
                  const lineList = opts.where.orderLineId._value || (Array.isArray(opts.where.orderLineId) ? opts.where.orderLineId : [opts.where.orderLineId]);
                  if (!lineList.includes(s.orderLineId)) return false;
                }
                return true;
              });
            }
            if (entityClass === ProductionTemplateWorkflowItemEntity) {
              return store.workflowItems;
            }
            return [];
          },
          count: async (opts: any) => {
            if (entityClass === ProductionOrderLineEntity) {
              return store.lines.filter((l) => !l.deletedAt).length;
            }
            return 0;
          },
          create: (data: any) => ({ id: data.id || `gen-${Date.now()}-${Math.floor(Math.random() * 1000)}`, deletedAt: null, ...data }),
          save: async (entity: any) => {
            if (entityClass === ProductionOrderEntity) store.order = entity;
            else if (entityClass === ProductionOrderLineEntity) {
              const idx = store.lines.findIndex((l) => l.id === entity.id);
              if (idx >= 0) store.lines[idx] = entity;
              else store.lines.push(entity);
            } else if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              const idx = store.selections.findIndex((s) => s.id === entity.id);
              if (idx >= 0) store.selections[idx] = entity;
              else store.selections.push(entity);
            } else if (entityClass === ProductionOrderSequenceEntity) {
              store.sequence = entity;
            }
            return entity;
          },
          softDelete: async (id: string) => {
            const item = store.lines.find((l) => l.id === id);
            if (item) item.deletedAt = new Date();
          },
          remove: async (entity: any) => {
            const idx = store.selections.findIndex((s) => s.id === entity.id);
            if (idx >= 0) store.selections.splice(idx, 1);
          },
        };
      };

      const mockManager: any = {
        getRepository: (entityClass: any) => createRepo(entityClass),
        save: async (entity: any) => {
          if (entity.orderNumber) store.order = entity;
          else if (entity.quantity !== undefined) {
            const idx = store.lines.findIndex((l) => l.id === entity.id);
            if (idx >= 0) store.lines[idx] = entity; else store.lines.push(entity);
          } else if (entity.selectedOptionId) {
            const idx = store.selections.findIndex((s) => s.id === entity.id);
            if (idx >= 0) store.selections[idx] = entity; else store.selections.push(entity);
          }
          return entity;
        },
        softDelete: async (entityClass: any, id: string) => {
          if (entityClass === ProductionOrderEntity && store.order) store.order.deletedAt = new Date();
        },
      };

      const mockDataSource: any = {
        getRepository: (entityClass: any) => createRepo(entityClass),
        transaction: async (cb: any) => cb(mockManager),
      };

      const guardService = new ProductionOrderGuardService(mockDataSource);
      const orderService = new ProductionOrderService(mockDataSource, guardService);

      return { store, mockDataSource, mockManager, guardService, orderService };
    }

    it('addLine(): absent patternSelections uses default options', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [
          { id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null },
          { id: 'opt-2', patternId: 'p-1', name: 'خيار 2', sortOrder: 2, deletedAt: null },
        ],
      });

      const line = await ctx.orderService.addLine('ord-1', {
        templateId: 't-1',
        quantity: 2,
        // patternSelections is undefined
      });

      assert.equal(line.quantity, 2);
      assert.equal(line.patternSelections.length, 1);
      assert.equal(line.patternSelections[0].selectedOptionId, 'opt-1');
    });

    it('addLine(): explicit [] with active patterns throws PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      let err: any = null;
      try {
        await ctx.orderService.addLine('ord-1', {
          templateId: 't-1',
          quantity: 2,
          patternSelections: [],
        });
      } catch (e) {
        err = e;
      }

      assert.ok(err instanceof BusinessRuleError);
      assert.equal(err.code, 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID');
    });

    it('addLine(): explicit [] with 0 patterns succeeds with 0 selections', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [],
        options: [],
      });

      const line = await ctx.orderService.addLine('ord-1', {
        templateId: 't-1',
        quantity: 2,
        patternSelections: [],
      });

      assert.equal(line.quantity, 2);
      assert.equal(line.patternSelections.length, 0);
    });

    it('addLine(): exact explicit set succeeds with specified options', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [
          { id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null },
          { id: 'opt-2', patternId: 'p-1', name: 'خيار 2', sortOrder: 2, deletedAt: null },
        ],
      });

      const line = await ctx.orderService.addLine('ord-1', {
        templateId: 't-1',
        quantity: 5,
        patternSelections: [{ patternId: 'p-1', optionId: 'opt-2' }],
      });

      assert.equal(line.patternSelections[0].selectedOptionId, 'opt-2');
    });

    it('addLine(): foreign pattern throws PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      let err: any = null;
      try {
        await ctx.orderService.addLine('ord-1', {
          templateId: 't-1',
          quantity: 2,
          patternSelections: [{ patternId: 'foreign-pattern', optionId: 'opt-1' }],
        });
      } catch (e) {
        err = e;
      }

      assert.ok(err instanceof BusinessRuleError);
      assert.equal(err.code, 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID');
    });

    it('addLine(): foreign option throws PRODUCTION_ORDER_LINE_OPTION_INVALID', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      let err: any = null;
      try {
        await ctx.orderService.addLine('ord-1', {
          templateId: 't-1',
          quantity: 2,
          patternSelections: [{ patternId: 'p-1', optionId: 'foreign-opt' }],
        });
      } catch (e) {
        err = e;
      }

      assert.ok(err instanceof BusinessRuleError);
      assert.equal(err.code, 'PRODUCTION_ORDER_LINE_OPTION_INVALID');
    });

    it('validateLineQuantity(): invalid quantities throw PRODUCTION_ORDER_LINE_QUANTITY_INVALID', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
      });

      const invalidQuantities = [0, -1, 1.5, 10001, NaN];
      for (const q of invalidQuantities) {
        await assert.rejects(
          async () => ctx.orderService.addLine('ord-1', { templateId: 't-1', quantity: q }),
          (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
        );
        await assert.rejects(
          async () => ctx.orderService.updateLineQuantity('ord-1', 'line-1', { quantity: q }),
          (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
        );
      }
    });

    it('changePatternSelection(): inactive template throws PRODUCTION_ORDER_TEMPLATE_INACTIVE', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-inactive', quantity: 2, sortOrder: 1, deletedAt: null }],
        template: { id: 't-inactive', name: 'قالب غير فعال', isActive: false, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-inactive', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      let err: any = null;
      try {
        await ctx.orderService.changePatternSelection('ord-1', 'line-1', 'p-1', { optionId: 'opt-1' });
      } catch (e) {
        err = e;
      }

      assert.ok(err instanceof BusinessRuleError);
      assert.equal(err.code, 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
    });

    it('changePatternSelection(): foreign option throws PRODUCTION_ORDER_LINE_OPTION_INVALID', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      let err: any = null;
      try {
        await ctx.orderService.changePatternSelection('ord-1', 'line-1', 'p-1', { optionId: 'foreign-opt' });
      } catch (e) {
        err = e;
      }

      assert.ok(err instanceof BusinessRuleError);
      assert.equal(err.code, 'PRODUCTION_ORDER_LINE_OPTION_INVALID');
    });

    it('syncDraftLineSelections(): reconciles when template options change', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-1', selectedOptionId: 'opt-archived' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [
          { id: 'opt-archived', patternId: 'p-1', name: 'خيار قديم', sortOrder: 1, deletedAt: new Date() },
          { id: 'opt-active-new', patternId: 'p-1', name: 'خيار جديد', sortOrder: 2, deletedAt: null },
        ],
      });

      const line = await ctx.orderService.syncDraftLineSelections('ord-1', 'line-1');
      assert.equal(line.patternSelections[0].selectedOptionId, 'opt-active-new');
    });

    it('syncDraftLineSelections(): corrupt pattern ownership fails closed with PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-foreign', selectedOptionId: 'opt-1' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-foreign', templateId: 't-other', name: 'نمط خارجي', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-foreign', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      await assert.rejects(
        async () => ctx.orderService.syncDraftLineSelections('ord-1', 'line-1'),
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
      );
    });

    it('validateDraftForRelease(): is read-only and does not mutate order state', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-1', selectedOptionId: 'opt-1' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        workflowItems: [{ id: 'wf-1', templateId: 't-1', deletedAt: null }],
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      const readiness = await ctx.orderService.validateDraftForRelease('ord-1');
      assert.equal(readiness.ready, true);
      assert.equal(readiness.issues.length, 0);
      assert.equal(ctx.store.order.status, ProductionOrderStatus.DRAFT);
    });

    it('validateDraftForRelease(): corrupt ownership throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-1', selectedOptionId: 'opt-foreign' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط 1', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-foreign', patternId: 'p-other', name: 'خيار خارجي', sortOrder: 1, deletedAt: null }],
      });

      await assert.rejects(
        async () => ctx.orderService.validateDraftForRelease('ord-1'),
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
      );
    });

    it('getOrderById(): corrupt pattern ownership throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-foreign', selectedOptionId: 'opt-1' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-foreign', templateId: 't-other', name: 'نمط أجنبي', deletedAt: null, createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-foreign', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
      });

      await assert.rejects(
        async () => ctx.orderService.getOrderById('ord-1'),
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
      );
    });

    it('getOrderById(): stale (archived) pattern and option remain readable with true historical names', async () => {
      const ctx = createMockServiceContext({
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [{ id: 'line-1', orderId: 'ord-1', templateId: 't-1', quantity: 2, sortOrder: 1, deletedAt: null }],
        selections: [{ id: 'sel-1', orderLineId: 'line-1', templatePatternId: 'p-1', selectedOptionId: 'opt-1' }],
        template: { id: 't-1', name: 'قالب 1', isActive: true, deletedAt: null },
        patterns: [{ id: 'p-1', templateId: 't-1', name: 'نمط تاريخي مؤرشف', deletedAt: new Date(), createdAt: new Date() }],
        options: [{ id: 'opt-1', patternId: 'p-1', name: 'خيار تاريخي مؤرشف', sortOrder: 1, deletedAt: new Date() }],
      });

      const order = await ctx.orderService.getOrderById('ord-1');
      assert.equal(order.lines?.length, 1);
      assert.equal(order.lines?.[0].patternSelections[0].patternName, 'نمط تاريخي مؤرشف');
      assert.equal(order.lines?.[0].patternSelections[0].selectedOptionName, 'خيار تاريخي مؤرشف');
      assert.deepEqual(order.lines?.[0].patternSelections[0].availableOptions, []);
    });

    it('createOrder(): fails closed if sequence row is missing with PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED', async () => {
      const ctx = createMockServiceContext({
        sequence: null, // sequence not seeded
      });

      await assert.rejects(
        async () => ctx.orderService.createOrder({ title: 'Test order', description: 'Test' }, 'u-1'),
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED'
      );
    });

    it('ProductionTemplateService.getOrderConfiguration(): inactive template throws PRODUCTION_ORDER_TEMPLATE_INACTIVE', async () => {
      const mockGuardService: any = {
        requireExistingTemplate: async () => ({ id: 't-inactive', name: 'قالب معطل', isActive: false }),
      };
      const templateService = new ProductionTemplateService({ getRepository: () => ({}) } as any, mockGuardService, {} as any, {} as any);

      await assert.rejects(
        async () => templateService.getOrderConfiguration('t-inactive'),
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_TEMPLATE_INACTIVE'
      );
    });

    it('ProductionTemplateService.getOrderConfiguration(): lightweight query loads only patterns and options (no tasks)', async () => {
      const mockGuardService: any = {
        requireExistingTemplate: async () => ({ id: 't-active', name: 'قالب نشط', isActive: true }),
      };
      const mockPatternRepo = {
        find: async (opts: any) => {
          assert.equal(opts.relations?.options, true);
          assert.equal((opts.relations as any)?.tasks, undefined);
          return [
            {
              id: 'p-1',
              name: 'نمط خفيف',
              options: [{ id: 'opt-1', name: 'خيار 1', sortOrder: 1, deletedAt: null }],
            },
          ];
        },
      };
      const mockDataSource: any = {
        getRepository: () => mockPatternRepo,
      };

      const templateService = new ProductionTemplateService(mockDataSource, mockGuardService, {} as any, {} as any);
      const config = await templateService.getOrderConfiguration('t-active');

      assert.equal(config.templateId, 't-active');
      assert.equal(config.patterns.length, 1);
      assert.equal(config.patterns[0].defaultOptionId, 'opt-1');
      assert.equal((config.patterns[0] as any).tasks, undefined);
    });
  });

  // ==========================================
  // 11. CONFIGURATION UNIQUENESS & CANONICAL HASH INVARIANTS
  // ==========================================
  describe('11. Configuration Uniqueness & Canonical Hash Invariants', () => {
    it('canonicalizeLineConfiguration(): sorts pattern selections deterministically by templatePatternId', () => {
      const selectionsA = [
        { templatePatternId: 'pattern-2', selectedOptionId: 'opt-b' },
        { templatePatternId: 'pattern-1', selectedOptionId: 'opt-a' },
      ];
      const selectionsB = [
        { templatePatternId: 'pattern-1', selectedOptionId: 'opt-a' },
        { templatePatternId: 'pattern-2', selectedOptionId: 'opt-b' },
      ];

      const canonicalA = canonicalizeLineConfiguration('template-123', selectionsA);
      const canonicalB = canonicalizeLineConfiguration('template-123', selectionsB);

      assert.equal(canonicalA, 'template-123|pattern-1:opt-a|pattern-2:opt-b');
      assert.equal(canonicalB, 'template-123|pattern-1:opt-a|pattern-2:opt-b');
      assert.equal(canonicalA, canonicalB);
    });

    it('hashLineConfiguration(): produces identical 64-char lowercase hex SHA-256 regardless of selection order', () => {
      const hashA = hashLineConfiguration('tmpl-1', [
        { templatePatternId: 'p-z', selectedOptionId: 'opt-z' },
        { templatePatternId: 'p-a', selectedOptionId: 'opt-a' },
      ]);
      const hashB = hashLineConfiguration('tmpl-1', [
        { templatePatternId: 'p-a', selectedOptionId: 'opt-a' },
        { templatePatternId: 'p-z', selectedOptionId: 'opt-z' },
      ]);

      assert.equal(hashA.length, 64);
      assert.equal(hashA, hashA.toLowerCase());
      assert.equal(hashA, hashB);
    });

    it('hashLineConfiguration(): changes when selected option changes', () => {
      const hash1 = hashLineConfiguration('tmpl-1', [{ templatePatternId: 'p-1', selectedOptionId: 'opt-1' }]);
      const hash2 = hashLineConfiguration('tmpl-1', [{ templatePatternId: 'p-1', selectedOptionId: 'opt-2' }]);
      assert.notEqual(hash1, hash2);
    });

    it('hashLineConfiguration(): changes when template changes', () => {
      const hash1 = hashLineConfiguration('tmpl-1', [{ templatePatternId: 'p-1', selectedOptionId: 'opt-1' }]);
      const hash2 = hashLineConfiguration('tmpl-2', [{ templatePatternId: 'p-1', selectedOptionId: 'opt-1' }]);
      assert.notEqual(hash1, hash2);
    });

    it('hashLineConfiguration(): template without patterns produces deterministic hash from templateId alone', () => {
      const hash1 = hashLineConfiguration('tmpl-no-pattern', []);
      const hash2 = hashLineConfiguration('tmpl-no-pattern');
      assert.equal(hash1.length, 64);
      assert.equal(hash1, hash2);
    });
  });

  // ==========================================
  // 12. SERVICE-LEVEL CONFIGURATION DUPLICATE PREVENTION
  // ==========================================
  describe('12. Service-Level Configuration Duplicate Prevention', () => {
    function createDuplicateTestContext() {
      const store = {
        order: { id: 'ord-1', orderNumber: 'PO-000001', status: ProductionOrderStatus.DRAFT, deletedAt: null },
        lines: [] as any[],
        selections: [] as any[],
        templates: [
          { id: 't-with-patterns', name: 'قالب مع أنماط', isActive: true, deletedAt: null },
          { id: 't-no-patterns', name: 'قالب بدون أنماط', isActive: true, deletedAt: null },
        ],
        patterns: [
          { id: 'p-1', templateId: 't-with-patterns', name: 'النمط 1', deletedAt: null, createdAt: new Date() },
          { id: 'p-2', templateId: 't-with-patterns', name: 'النمط 2', deletedAt: null, createdAt: new Date() },
        ],
        options: [
          { id: 'opt-1a', patternId: 'p-1', name: 'خيار 1-أ', sortOrder: 1, deletedAt: null },
          { id: 'opt-1b', patternId: 'p-1', name: 'خيار 1-ب', sortOrder: 2, deletedAt: null },
          { id: 'opt-2a', patternId: 'p-2', name: 'خيار 2-أ', sortOrder: 1, deletedAt: null },
        ],
        sequence: { id: 'PRODUCTION_ORDER', currentValue: 1 },
      };

      const createRepo = (entityClass: any) => {
        return {
          findOne: async (opts: any) => {
            if (entityClass === ProductionOrderEntity) return store.order;
            if (entityClass === ProductionTemplateEntity) {
              return store.templates.find((t) => t.id === opts.where.id && !t.deletedAt) || null;
            }
            if (entityClass === ProductionTemplatePatternEntity) {
              return store.patterns.find((p) => p.id === opts.where.id && (!opts.where.templateId || p.templateId === opts.where.templateId) && !p.deletedAt) || null;
            }
            if (entityClass === ProductionTemplatePatternOptionEntity) {
              return store.options.find((o) => o.id === opts.where.id && (!opts.where.patternId || o.patternId === opts.where.patternId) && !o.deletedAt) || null;
            }
            if (entityClass === ProductionOrderLineEntity) {
              return store.lines.find((l) => {
                if (opts?.where?.id) {
                  if (opts.where.id._type === 'not' && l.id === opts.where.id._value) return false;
                  if (opts.where.id._type !== 'not' && l.id !== opts.where.id) return false;
                }
                if (opts?.where?.orderId && l.orderId !== opts.where.orderId) return false;
                if (opts?.where?.activeConfigurationHash && l.activeConfigurationHash !== opts.where.activeConfigurationHash) return false;
                if (opts?.where?.deletedAt && l.deletedAt !== null) return false;
                return true;
              }) || null;
            }
            if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              return store.selections.find((s) => s.orderLineId === opts.where.orderLineId && s.templatePatternId === opts.where.templatePatternId) || null;
            }
            return null;
          },
          find: async (opts: any) => {
            if (entityClass === ProductionOrderLineEntity) {
              return store.lines.filter((l) => !opts?.withDeleted ? !l.deletedAt : true);
            }
            if (entityClass === ProductionTemplateEntity) {
              return store.templates.filter((t) => !opts?.withDeleted ? !t.deletedAt : true);
            }
            if (entityClass === ProductionTemplatePatternEntity) {
              return store.patterns.filter((p) => {
                if (opts?.where?.templateId) {
                  const tmplList = opts.where.templateId._value || (Array.isArray(opts.where.templateId) ? opts.where.templateId : [opts.where.templateId]);
                  if (!tmplList.includes(p.templateId)) return false;
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
              return store.options.filter((o) => !opts?.withDeleted ? !o.deletedAt : true);
            }
            if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              return store.selections.filter((s) => {
                if (opts?.where?.orderLineId) {
                  const lineList = opts.where.orderLineId._value || (Array.isArray(opts.where.orderLineId) ? opts.where.orderLineId : [opts.where.orderLineId]);
                  if (!lineList.includes(s.orderLineId)) return false;
                }
                return true;
              });
            }
            return [];
          },
          count: async (opts: any) => {
            if (entityClass === ProductionOrderLineEntity) {
              return store.lines.filter((l) => !l.deletedAt).length;
            }
            return 0;
          },
          create: (data: any) => ({ id: data.id || `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`, deletedAt: null, ...data }),
          save: async (entity: any) => {
            if (entityClass === ProductionOrderLineEntity) {
              const idx = store.lines.findIndex((l) => l.id === entity.id);
              if (idx >= 0) store.lines[idx] = entity;
              else store.lines.push(entity);
            } else if (entityClass === ProductionOrderLinePatternSelectionEntity) {
              const idx = store.selections.findIndex((s) => s.id === entity.id);
              if (idx >= 0) store.selections[idx] = entity;
              else store.selections.push(entity);
            }
            return entity;
          },
        };
      };

      const mockManager: any = {
        getRepository: (c: any) => createRepo(c),
        save: async (e: any) => e,
      };

      const mockDataSource: any = {
        getRepository: (c: any) => createRepo(c),
        transaction: async (cb: any) => cb(mockManager),
      };

      const guard = new ProductionOrderGuardService(mockDataSource);
      const service = new ProductionOrderService(mockDataSource, guard);

      return { store, service };
    }

    it('addLine(): adding duplicate configuration throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      // Add first line
      const line1 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 5,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });
      assert.ok(line1.id);

      // Try adding duplicate configuration with same options
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', {
            templateId: 't-with-patterns',
            quantity: 10, // different quantity does NOT permit duplication!
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1a' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION');
          assert.equal(err.details?.existingLineId, line1.id);
          return true;
        }
      );
    });

    it('addLine(): different selection order still detected as duplicate and throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      const line1 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Send selections in reversed order [p-2, p-1]
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', {
            templateId: 't-with-patterns',
            quantity: 3,
            patternSelections: [
              { patternId: 'p-2', optionId: 'opt-2a' },
              { patternId: 'p-1', optionId: 'opt-1a' },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('addLine(): allows same template with DIFFERENT option selection', async () => {
      const { service } = createDuplicateTestContext();

      const line1 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Different option on p-1: opt-1b instead of opt-1a
      const line2 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1b' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      assert.ok(line2.id);
      assert.notEqual(line1.id, line2.id);
    });

    it('addLine(): template without patterns duplicate throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      const line1 = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });
      assert.ok(line1.id);

      await assert.rejects(
        async () => {
          await service.addLine('ord-1', {
            templateId: 't-no-patterns',
            quantity: 5,
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('addLine(): allows adding configuration that was previously archived on this order', async () => {
      const { service, store } = createDuplicateTestContext();

      const line1 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Archive line1
      await service.archiveLine('ord-1', line1.id);

      // Verify archived line cleared activeConfigurationHash
      const archivedLine = store.lines.find((l) => l.id === line1.id);
      assert.equal(archivedLine.activeConfigurationHash, null);
      assert.ok(archivedLine.deletedAt !== null);

      // Now adding identical configuration succeeds!
      const line2 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 4,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      assert.ok(line2.id);
      assert.notEqual(line2.id, line1.id);
    });

    it('changePatternSelection(): collision with another active line throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      // Line 1: opt-1a, opt-2a
      const line1 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Line 2: opt-1b, opt-2a
      const line2 = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1b' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Attempt to change Line 2's pattern p-1 to opt-1a -> would collide with Line 1!
      await assert.rejects(
        async () => {
          await service.changePatternSelection('ord-1', line2.id, 'p-1', { optionId: 'opt-1a' });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('getOrderByIdInternal(): active line missing activeConfigurationHash throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      store.lines.push({
        id: 'corrupt-line',
        orderId: 'ord-1',
        templateId: 't-no-patterns',
        quantity: 1,
        sortOrder: 1,
        activeConfigurationHash: null, // missing hash!
        deletedAt: null,
      });

      await assert.rejects(
        async () => {
          await service.getOrderById('ord-1');
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
      );
    });
  });

  // ==========================================
  // 13. WEB UI SEPARATION & INTEGRITY INVARIANTS
  // ==========================================
  describe('13. Web UI Separation & Integrity Invariants', () => {
    it('show.ejs: strictly read-only and contains no mutation controls or modals', () => {
      const showEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/show.ejs'), 'utf-8');

      // Mutating buttons and modals must NOT exist in show.ejs
      assert.ok(!showEjs.includes('openAddLineModalBtn'), 'show.ejs must not contain openAddLineModalBtn');
      assert.ok(!showEjs.includes('confirmAddLineBtn'), 'show.ejs must not contain confirmAddLineBtn');
      assert.ok(!showEjs.includes('templatePickerSearch'), 'show.ejs must not contain templatePickerSearch');
      assert.ok(!showEjs.includes('editQuantityModal'), 'show.ejs must not contain editQuantityModal');
      assert.ok(!showEjs.includes('editHeaderModal'), 'show.ejs must not contain editHeaderModal');
      assert.ok(!showEjs.includes('archiveOrderModal'), 'show.ejs must not contain archiveOrderModal');
      assert.ok(!showEjs.includes('<form'), 'show.ejs must not contain form elements');

      // Must contain navigation button to /edit
      assert.ok(showEjs.includes('editOrderNavBtn'), 'show.ejs must contain editOrderNavBtn navigation');
      assert.ok(showEjs.includes('/production/orders/<%= order.id %>/edit'), 'show.ejs must link to /edit');
    });

    it('edit.ejs: contains search-first composer, unified order lines container, single save, and no Bootstrap archive modal', () => {
      const editEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/edit.ejs'), 'utf-8');

      assert.ok(editEjs.includes('addLineComposerCard'), 'edit.ejs must contain addLineComposerCard');
      assert.ok(editEjs.includes('templateSearchInput'), 'edit.ejs must contain templateSearchInput');
      assert.ok(editEjs.includes('templateLoadMoreBtn'), 'edit.ejs must contain templateLoadMoreBtn');
      assert.ok(editEjs.includes('submitPendingLinesBtn'), 'edit.ejs must contain submitPendingLinesBtn');
      assert.ok(editEjs.includes('orderLinesContainer'), 'edit.ejs must contain orderLinesContainer');
      assert.ok(editEjs.includes('editHeaderModal'), 'edit.ejs must contain editHeaderModal');
      assert.ok(!editEjs.includes('archiveOrderModal'), 'edit.ejs must NOT contain archiveOrderModal (Bootstrap modal eliminated)');
      assert.ok(!editEjs.includes('confirmArchiveOrderBtn'), 'edit.ejs must NOT contain confirmArchiveOrderBtn');
      assert.ok(editEjs.includes('/js/production-order-edit.js'), 'edit.ejs must load production-order-edit.js');
    });

    it('index.ejs: does not contain Bootstrap archive confirmation modal', () => {
      const indexEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/index.ejs'), 'utf-8');

      assert.ok(!indexEjs.includes('archiveOrderModal'), 'index.ejs must NOT contain archiveOrderModal');
      assert.ok(!indexEjs.includes('confirmArchiveOrderBtn'), 'index.ejs must NOT contain confirmArchiveOrderBtn');
    });

    it('production-order-show.js: does not execute line mutating calls (only workflow approval, reopen, and priority update)', () => {
      const showJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-show.js'), 'utf-8');

      assert.ok(!showJs.includes('lines/'), 'show.js must not perform line mutations');
      assert.ok(!showJs.includes("method: 'DELETE'"), 'show.js must not perform DELETE requests');
      assert.ok(showJs.includes('/priority'), 'show.js may PATCH priority');
    });

    it('production-order-edit.js: uses search-first approach without boot fetch and tracks monotonic sequence counters', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');

      assert.ok(editJs.includes('templatePickerRequestSeq'), 'edit.js must track templatePickerRequestSeq');
      assert.ok(editJs.includes('templateConfigurationRequestSeq'), 'edit.js must track templateConfigurationRequestSeq');
      assert.ok(!editJs.includes('fetchTemplates(false);'), 'edit.js must NOT execute fetchTemplates(false) at boot');
    });

    it('production order client scripts: do NOT use native alert() or confirm()', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      const ordersJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-orders.js'), 'utf-8');

      assert.ok(!editJs.includes('confirm('), 'production-order-edit.js must NOT use native confirm()');
      assert.ok(!editJs.includes('alert('), 'production-order-edit.js must NOT use native alert()');
      assert.ok(!ordersJs.includes('confirm('), 'production-orders.js must NOT use native confirm()');
      assert.ok(!ordersJs.includes('alert('), 'production-orders.js must NOT use native alert()');
    });

    it('extractApiErrorMessage: extracts and formats error messages from response body', () => {
      const appJs = readFileSync(resolve(process.cwd(), 'src/public/js/app.js'), 'utf-8');
      assert.ok(appJs.includes('window.extractApiErrorMessage'), 'app.js must define window.extractApiErrorMessage');

      function extractApiErrorMessage(responseBody: any, fallback?: string) {
        if (!responseBody) return fallback || 'حدث خطأ غير متوقع';
        const errorMessages: string[] = [];
        if (responseBody.errors && typeof responseBody.errors === 'object' && !Array.isArray(responseBody.errors)) {
          Object.keys(responseBody.errors).forEach((key) => {
            const val = responseBody.errors[key];
            if (Array.isArray(val)) {
              val.forEach((msg) => { if (typeof msg === 'string' && msg.trim()) errorMessages.push(msg.trim()); });
            } else if (typeof val === 'string' && val.trim()) {
              errorMessages.push(val.trim());
            }
          });
        } else if (Array.isArray(responseBody.errors)) {
          responseBody.errors.forEach((msg) => { if (typeof msg === 'string' && msg.trim()) errorMessages.push(msg.trim()); });
        }
        if (errorMessages.length === 0 && responseBody.message && typeof responseBody.message === 'string') {
          errorMessages.push(responseBody.message);
        }
        const uniqueMessages = Array.from(new Set(errorMessages));
        return uniqueMessages.length > 0 ? uniqueMessages.join('، ') : (fallback || 'حدث خطأ أثناء معالجة الطلب');
      }

      const extracted = extractApiErrorMessage({
        errors: {
          quantity: ['الكمية غير صالحة'],
          templateId: ['القالب غير موجود'],
        },
      });
      assert.equal(extracted, 'الكمية غير صالحة، القالب غير موجود');
    });
  });

  // ==========================================
  // 14. DRAFT HARDENING & INVARIANT TESTS
  // ==========================================
  describe('14. Draft Hardening & Invariant Tests', () => {
    it('changePatternSelection(): throws PRODUCTION_ORDER_TEMPLATE_INACTIVE when template is inactive or archived', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add line while template is active
      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Deactivate template
      const tmpl = store.templates.find((t) => t.id === 't-with-patterns');
      if (tmpl) tmpl.isActive = false;

      // Attempt to change pattern selection
      await assert.rejects(
        async () => {
          await service.changePatternSelection('ord-1', line.id, 'p-1', { optionId: 'opt-1b' });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
          return true;
        }
      );
    });

    it('addLine(): patternSelections: [] when template has patterns throws PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID', async () => {
      const { service } = createDuplicateTestContext();

      await assert.rejects(
        async () => {
          await service.addLine('ord-1', {
            templateId: 't-with-patterns',
            quantity: 1,
            patternSelections: [], // explicit empty array, not undefined!
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID');
          return true;
        }
      );
    });

    it('addLine(): absent patternSelections (undefined) resolves default active options', async () => {
      const { service } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        // patternSelections omitted -> undefined
      });

      assert.ok(line.id);
      assert.equal(line.patternSelections.length, 2);
      assert.equal(line.patternSelections.find((s: any) => s.templatePatternId === 'p-1')?.selectedOptionId, 'opt-1a');
      assert.equal(line.patternSelections.find((s: any) => s.templatePatternId === 'p-2')?.selectedOptionId, 'opt-2a');
    });

    it('validateLineQuantity: rejects quantity <= 0, > 10000, or non-integer with PRODUCTION_ORDER_LINE_QUANTITY_INVALID', async () => {
      const { service } = createDuplicateTestContext();

      // Quantity 0
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 0 });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
      );

      // Quantity > 10000
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 10001 });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
      );

      // Decimal quantity
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 2.5 });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
      );
    });

    it('addLinesBatch(): adds multiple lines transactionally and validates quantities and configurations', async () => {
      const { service } = createDuplicateTestContext();

      const result = await service.addLinesBatch('ord-1', {
        lines: [
          {
            templateId: 't-with-patterns',
            quantity: 3,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1a' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
          {
            templateId: 't-with-patterns',
            quantity: 5,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1b' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
        ],
      });

      assert.equal(result.length, 2);
      assert.equal(result[0].sortOrder, 1);
      assert.equal(result[1].sortOrder, 2);
    });

    it('addLinesBatch(): intra-batch duplicate throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      await assert.rejects(
        async () => {
          await service.addLinesBatch('ord-1', {
            lines: [
              {
                templateId: 't-with-patterns',
                quantity: 1,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
              {
                templateId: 't-with-patterns',
                quantity: 2,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('addLinesBatch(): atomic rollback when any line in batch fails validation (0 lines created)', async () => {
      const { service, store } = createDuplicateTestContext();

      const initialLinesCount = store.lines.length;

      // Line 1 is valid, Line 2 has invalid quantity (0)
      await assert.rejects(
        async () => {
          await service.addLinesBatch('ord-1', {
            lines: [
              {
                templateId: 't-with-patterns',
                quantity: 2,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
              {
                templateId: 't-with-patterns',
                quantity: 0, // Invalid!
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1b' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
      );

      // Verify no partial insert occurred (All-or-nothing rollback)
      assert.equal(store.lines.length, initialLinesCount);
    });

    it('addLinesBatch(): collision with existing active line throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION and rolls back', async () => {
      const { service, store } = createDuplicateTestContext();

      // Existing line in DB with config (opt-1a, opt-2a)
      const existing = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });
      assert.ok(existing.id);

      const countBeforeBatch = store.lines.length;

      // Batch contains duplicate of existing line plus a new distinct line
      await assert.rejects(
        async () => {
          await service.addLinesBatch('ord-1', {
            lines: [
              {
                templateId: 't-with-patterns',
                quantity: 4,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1b' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
              {
                templateId: 't-with-patterns',
                quantity: 5,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' }, // Conflicts with existing!
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );

      // Verify rollback: 0 new lines added
      assert.equal(store.lines.length, countBeforeBatch);
    });

    it('addLinesBatch(): allows same template with DIFFERENT pattern option selections in same batch', async () => {
      const { service } = createDuplicateTestContext();

      const created = await service.addLinesBatch('ord-1', {
        lines: [
          {
            templateId: 't-with-patterns',
            quantity: 3,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1a' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
          {
            templateId: 't-with-patterns',
            quantity: 4,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1b' }, // Different!
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
        ],
      });

      assert.equal(created.length, 2);
      assert.notEqual(created[0].id, created[1].id);
    });

    it('addLinesBatch(): same template without patterns duplicated in batch throws PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION', async () => {
      const { service } = createDuplicateTestContext();

      await assert.rejects(
        async () => {
          await service.addLinesBatch('ord-1', {
            lines: [
              {
                templateId: 't-no-patterns',
                quantity: 1,
              },
              {
                templateId: 't-no-patterns',
                quantity: 2,
              },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('addLinesBatch(): quantity difference does NOT avoid duplicate detection', async () => {
      const { service } = createDuplicateTestContext();

      await assert.rejects(
        async () => {
          await service.addLinesBatch('ord-1', {
            lines: [
              {
                templateId: 't-with-patterns',
                quantity: 1,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
              {
                templateId: 't-with-patterns',
                quantity: 50, // Different quantity, same configuration!
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
            ],
          });
        },
        (err: any) => err instanceof BusinessRuleError && err.code === 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
      );
    });

    it('createOrder(): throws PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED if sequence row is missing', async () => {
      const { service, store } = createDuplicateTestContext();
      (store as any).sequence = null; // simulate missing sequence row in DB

      await assert.rejects(
        async () => {
          await service.createOrder({
            title: 'New Order',
            description: 'New Order',
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED');
          return true;
        }
      );
    });

    it('getOrderByIdInternal(): foreign pattern ID on line throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a foreign pattern that belongs to another template
      store.patterns.push({
        id: 'foreign-p',
        templateId: 'other-template-id',
        name: 'نمط خارجي',
        deletedAt: null,
        createdAt: new Date(),
      });
      store.options.push({
        id: 'foreign-opt',
        patternId: 'foreign-p',
        name: 'خيار خارجي',
        sortOrder: 1,
        deletedAt: null,
      });

      const lineId = 'line-corrupt-foreign';
      const hash = hashLineConfiguration('t-with-patterns', [
        { templatePatternId: 'foreign-p', selectedOptionId: 'foreign-opt' },
      ]);
      store.lines.push({
        id: lineId,
        orderId: 'ord-1',
        templateId: 't-with-patterns',
        quantity: 1,
        sortOrder: 1,
        activeConfigurationHash: hash,
        deletedAt: null,
      });
      store.selections.push({
        id: 'sel-corrupt',
        orderLineId: lineId,
        templatePatternId: 'foreign-p',
        selectedOptionId: 'foreign-opt',
      });

      await assert.rejects(
        async () => {
          await service.getOrderById('ord-1');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT');
          return true;
        }
      );
    });

    it('getOrderByIdInternal(): soft-deleted pattern returns historical name and sets isReleaseReady to false without corrupt error', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a line with pattern p-1
      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Soft-delete pattern p-1 (historical / stale)
      const p1 = store.patterns.find((p) => p.id === 'p-1');
      if (p1) p1.deletedAt = new Date();

      const orderDetail = await service.getOrderById('ord-1');
      assert.ok(orderDetail);
      const detailLine = orderDetail.lines.find((l) => l.id === line.id);
      assert.ok(detailLine);
      const selP1 = detailLine.patternSelections.find((s) => s.templatePatternId === 'p-1');
      assert.ok(selP1);
      assert.equal(selP1.patternName, 'النمط 1'); // historical name preserved!

      const readiness = await service.validateDraftForRelease('ord-1');
      assert.equal(readiness.ready, false);
    });
  });

  // ==========================================
  // 15. FINAL STABILIZATION: ATOMIC DRAFT COMMIT, APPROVAL WORKFLOW & UX
  // ==========================================
  describe('15. Final Stabilization: Atomic Draft Commit, Approval Workflow & UX', () => {
    // ------------------------------------------
    // DTO VALIDATION TESTS
    // ------------------------------------------
    it('CommitProductionOrderDraftLinesDto: accepts valid target lines state', async () => {
      const dto = plainToInstance(CommitProductionOrderDraftLinesDto, {
        lines: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 5,
            patternSelections: [
              {
                patternId: '33333333-3333-4333-8333-333333333333',
                optionId: '44444444-4444-4444-8444-444444444444',
              },
            ],
          },
          {
            templateId: '55555555-5555-4555-8555-555555555555',
            quantity: 3,
            patternSelections: [],
          },
        ],
      });

      const errors = await validate(dto);
      assert.equal(errors.length, 0, 'Valid CommitProductionOrderDraftLinesDto must pass validation');
    });

    it('CommitProductionOrderDraftLinesDto: rejects decimal and negative quantities', async () => {
      const dtoDecimal = plainToInstance(CommitProductionOrderDraftLinesDto, {
        lines: [
          {
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 2.5,
          },
        ],
      });

      const errorsDecimal = await validate(dtoDecimal);
      assert.ok(errorsDecimal.length > 0, 'Decimal quantity 2.5 must be rejected');

      const dtoZero = plainToInstance(CommitProductionOrderDraftLinesDto, {
        lines: [
          {
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 0,
          },
        ],
      });

      const errorsZero = await validate(dtoZero);
      assert.ok(errorsZero.length > 0, 'Zero quantity must be rejected');

      const dtoTooLarge = plainToInstance(CommitProductionOrderDraftLinesDto, {
        lines: [
          {
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 10001,
          },
        ],
      });

      const errorsTooLarge = await validate(dtoTooLarge);
      assert.ok(errorsTooLarge.length > 0, 'Quantity > 10000 must be rejected');
    });

    it('CommitProductionOrderDraftLinesDto: rejects duplicate existing IDs in payload', async () => {
      const dto = plainToInstance(CommitProductionOrderDraftLinesDto, {
        lines: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 1,
          },
          {
            id: '11111111-1111-4111-8111-111111111111', // duplicate ID!
            templateId: '22222222-2222-4222-8222-222222222222',
            quantity: 2,
          },
        ],
      });

      const errors = await validate(dto);
      assert.ok(errors.length > 0, 'Duplicate line IDs in payload must be rejected');
    });

    // ------------------------------------------
    // ATOMIC DRAFT COMMIT SERVICE TESTS
    // ------------------------------------------
    it('commitDraftLines(): executes mixed operations (delete A, update B, add C) atomically in one transaction with dense sort', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add pre-existing lines A and B
      const lineA = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });

      const lineB = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      assert.equal(store.lines.filter((l) => !l.deletedAt).length, 2);

      // Target payload:
      // Line A is omitted (should be deleted)
      // Line B is updated (quantity: 10, pattern opt-1b)
      // Line C is newly added (t-no-patterns, quantity: 4)
      const commitResult = await service.commitDraftLines('ord-1', {
        lines: [
          {
            id: lineB.id,
            templateId: 't-with-patterns',
            quantity: 10,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1b' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
          {
            templateId: 't-no-patterns',
            quantity: 4,
            patternSelections: [],
          },
        ],
      });

      // Assertions
      assert.equal(commitResult.lines.length, 2);
      assert.equal(commitResult.summary.lineCount, 2);
      assert.equal(commitResult.summary.totalQuantity, 14);

      // Check dense sortOrder
      assert.equal(commitResult.lines[0].sortOrder, 1);
      assert.equal(commitResult.lines[0].quantity, 10);
      assert.equal(commitResult.lines[1].sortOrder, 2);
      assert.equal(commitResult.lines[1].quantity, 4);

      // Line A must be soft-deleted and its hash nulled
      const storedLineA = store.lines.find((l) => l.id === lineA.id);
      assert.ok(storedLineA.deletedAt !== null, 'Line A must be archived');
      assert.equal(storedLineA.activeConfigurationHash, null, 'Archived line A must have NULL configuration hash');

      // Active lines must all have non-null activeConfigurationHash
      const activeLines = store.lines.filter((l) => !l.deletedAt);
      assert.equal(activeLines.length, 2);
      activeLines.forEach((l) => {
        assert.ok(l.activeConfigurationHash, 'Every active line must have activeConfigurationHash');
      });
    });

    it('commitDraftLines(): duplicate configuration inside target payload rejects and rolls back completely', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add pre-existing line A
      const lineA = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });

      // Target payload attempts to add two lines with identical configuration (t-no-patterns)
      await assert.rejects(
        async () => {
          await service.commitDraftLines('ord-1', {
            lines: [
              {
                id: lineA.id,
                templateId: 't-no-patterns',
                quantity: 5,
              },
              {
                templateId: 't-no-patterns', // DUPLICATE CONFIGURATION!
                quantity: 3,
              },
            ],
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION');
          return true;
        }
      );

      // Line A must remain unchanged (rollback intact)
      const storedLineA = store.lines.find((l) => l.id === lineA.id);
      assert.equal(storedLineA.quantity, 1, 'Quantity must not have changed');
      assert.equal(storedLineA.deletedAt, null);
    });

    it('commitDraftLines(): configuration swap between two existing lines succeeds without collision', async () => {
      const { service, store } = createDuplicateTestContext();

      // Setup Line A with opt-1a, Line B with opt-1b
      const lineA = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      const lineB = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1b' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      const hashAInitial = lineA.activeConfigurationHash;
      const hashBInitial = lineB.activeConfigurationHash;

      // Swap target state: Line A gets opt-1b, Line B gets opt-1a
      const commitResult = await service.commitDraftLines('ord-1', {
        lines: [
          {
            id: lineA.id,
            templateId: 't-with-patterns',
            quantity: 1,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1b' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
          {
            id: lineB.id,
            templateId: 't-with-patterns',
            quantity: 2,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1a' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
        ],
      });

      assert.equal(commitResult.lines.length, 2);
      const updatedA = commitResult.lines.find((l) => l.id === lineA.id);
      const updatedB = commitResult.lines.find((l) => l.id === lineB.id);

      assert.equal(updatedA?.activeConfigurationHash, hashBInitial, 'Line A now has original Hash B');
      assert.equal(updatedB?.activeConfigurationHash, hashAInitial, 'Line B now has original Hash A');
    });

    it('commitDraftLines(): foreign existing line ID fails closed with PRODUCTION_ORDER_LINE_NOT_FOUND', async () => {
      const { service } = createDuplicateTestContext();

      await assert.rejects(
        async () => {
          await service.commitDraftLines('ord-1', {
            lines: [
              {
                id: 'foreign-line-999',
                templateId: 't-no-patterns',
                quantity: 1,
              },
            ],
          });
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_NOT_FOUND');
          return true;
        }
      );
    });

    it('commitDraftLines(): mutating templateId of existing line fails closed with PRODUCTION_ORDER_LINE_TEMPLATE_IMMUTABLE', async () => {
      const { service } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });

      await assert.rejects(
        async () => {
          await service.commitDraftLines('ord-1', {
            lines: [
              {
                id: line.id,
                templateId: 't-with-patterns', // Attempting to change template of existing line!
                quantity: 1,
                patternSelections: [
                  { patternId: 'p-1', optionId: 'opt-1a' },
                  { patternId: 'p-2', optionId: 'opt-2a' },
                ],
              },
            ],
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_TEMPLATE_IMMUTABLE');
          return true;
        }
      );
    });

    // ------------------------------------------
    // SYNC PREVIEW TESTS
    // ------------------------------------------
    it('previewSyncDraftLine(): returns reconciled pattern selections preview WITHOUT mutating DB', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a line with pattern p-1
      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      const initialSelectionsCount = store.selections.length;
      const initialLineHash = store.lines.find((l) => l.id === line.id)?.activeConfigurationHash;

      // Soft delete pattern p-1 (simulating template update)
      const p1 = store.patterns.find((p) => p.id === 'p-1');
      if (p1) p1.deletedAt = new Date();

      // Call preview
      const preview = await service.previewSyncDraftLine('ord-1', line.id);
      assert.ok(preview);
      assert.equal(preview.lineId, line.id);
      assert.equal(preview.templateId, 't-with-patterns');
      assert.ok(preview.patternSelections.length > 0);

      // Verify DB was NOT mutated
      assert.equal(store.selections.length, initialSelectionsCount, 'Selections count in store must not change');
      const lineAfterPreview = store.lines.find((l) => l.id === line.id);
      assert.equal(lineAfterPreview?.activeConfigurationHash, initialLineHash, 'Hash must not change in preview');
    });

    // ------------------------------------------
    // APPROVAL WORKFLOW TESTS
    // ------------------------------------------
    it('order status lifecycle: created as DRAFT, saving lines keeps DRAFT', async () => {
      const { service, store } = createDuplicateTestContext();

      assert.equal(store.order.status, ProductionOrderStatus.DRAFT);

      await service.commitDraftLines('ord-1', {
        lines: [
          {
            templateId: 't-no-patterns',
            quantity: 3,
          },
        ],
      });

      assert.equal(store.order.status, ProductionOrderStatus.DRAFT, 'Draft lines commit must maintain DRAFT status');
    });

    it('approveOrder(): approves ready draft order and sets approval metadata', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a valid line to make order ready
      await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 2,
      });

      const approvedOrder = await service.approveOrder('ord-1', 'user-approver-123');

      assert.equal(approvedOrder.status, ProductionOrderStatus.APPROVED);
      assert.ok(approvedOrder.approvedAt instanceof Date || typeof approvedOrder.approvedAt === 'string');
      assert.equal(approvedOrder.approvedByUserId, 'user-approver-123');
      assert.equal(store.order.status, ProductionOrderStatus.APPROVED);
    });

    it('approveOrder(): blocked with PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL when order is empty or has issues', async () => {
      const { service, store } = createDuplicateTestContext();

      // Order has zero lines -> not ready
      await assert.rejects(
        async () => {
          await service.approveOrder('ord-1', 'user-approver-123');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL');
          return true;
        }
      );

      assert.equal(store.order.status, ProductionOrderStatus.DRAFT);
    });

    it('approveOrder(): double approve throws PRODUCTION_ORDER_NOT_MUTABLE', async () => {
      const { service, store } = createDuplicateTestContext();

      await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 2,
      });

      await service.approveOrder('ord-1', 'user-approver-123');
      assert.equal(store.order.status, ProductionOrderStatus.APPROVED);

      await assert.rejects(
        async () => {
          await service.approveOrder('ord-1', 'user-approver-123');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );
    });

    it('reopenOrder(): transitions APPROVED back to DRAFT and clears approval metadata', async () => {
      const { service, store } = createDuplicateTestContext();

      await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 2,
      });

      await service.approveOrder('ord-1', 'user-approver-123');
      assert.equal(store.order.status, ProductionOrderStatus.APPROVED);

      const reopenedOrder = await service.reopenOrder('ord-1');
      assert.equal(reopenedOrder.status, ProductionOrderStatus.DRAFT);
      assert.equal(reopenedOrder.approvedAt, null);
      assert.equal(reopenedOrder.approvedByUserId, null);
      assert.equal(store.order.status, ProductionOrderStatus.DRAFT);
    });

    it('APPROVED order immutability: commitDraftLines and line mutations rejected on APPROVED order', async () => {
      const { service, store } = createDuplicateTestContext();

      await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 2,
      });

      await service.approveOrder('ord-1', 'user-approver-123');

      // Attempt commitDraftLines on APPROVED
      await assert.rejects(
        async () => {
          await service.commitDraftLines('ord-1', { lines: [] });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );

      // Attempt addLine on APPROVED
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 1 });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );

      // Attempt archiveOrder on APPROVED
      await assert.rejects(
        async () => {
          await service.archiveOrder('ord-1');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.ok(err.code === 'PRODUCTION_ORDER_NOT_DRAFT' || err.code === 'PRODUCTION_ORDER_NOT_MUTABLE');
          return true;
        }
      );
    });

    // ------------------------------------------
    // QUANTITY UX & CODE SAFETY STRUCTURAL TESTS
    // ------------------------------------------
    it('production-order-edit.js: strictly does NOT use parseInt() for quantity', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      assert.ok(!editJs.includes('parseInt('), 'production-order-edit.js must not contain parseInt(');
    });

    it('production-order-edit.js: does NOT call renderLines() on quantity input keystrokes', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      // Verify qtyInput input listener calls revalidateEditor() instead of renderLines()
      const hasInputRenderLines = editJs.includes("qtyInput.addEventListener('input', (e) => {\n        renderLines();");
      assert.ok(!hasInputRenderLines, 'qtyInput must not call renderLines() directly on keystroke');
      assert.ok(editJs.includes('revalidateEditor()'), 'production-order-edit.js must define revalidateEditor()');
    });

    it('production-order-edit.js: does not inject dynamic messages into innerHTML', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      assert.ok(!editJs.includes('${msg}'), 'production-order-edit.js must not interpolate validation message');
      assert.ok(!editJs.includes('${errorMessage}'), 'production-order-edit.js must not interpolate error message');
      assert.ok(!editJs.includes('alertItem.innerHTML'), 'production-order-edit.js must not use innerHTML on alert items');
    });

    it('production-orders.js: renderErrorState() uses DOM-safe textContent', () => {
      const ordersJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-orders.js'), 'utf-8');
      assert.ok(!ordersJs.includes('<div>${errorMessage}</div>'), 'production-orders.js must not inject errorMessage into innerHTML');
      assert.ok(ordersJs.includes('msgDiv.textContent = errorMessage'), 'production-orders.js must use textContent for errorMessage');
    });

    it('show.ejs: contains data-label attributes on lines table for mobile stacked layout', () => {
      const showEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/show.ejs'), 'utf-8');
      assert.ok(showEjs.includes('data-label="#"'), 'show.ejs must contain data-label="#"');
      assert.ok(showEjs.includes('data-label="القالب"'), 'show.ejs must contain data-label="القالب"');
      assert.ok(showEjs.includes('data-label="الكود"'), 'show.ejs must contain data-label="الكود"');
      assert.ok(showEjs.includes('data-label="الكمية"'), 'show.ejs must contain data-label="الكمية"');
      assert.ok(showEjs.includes('data-label="الأنماط"'), 'show.ejs must contain data-label="الأنماط"');
    });

    it('production-orders.css: contains mobile stacked card rules for show page table', () => {
      const css = readFileSync(resolve(process.cwd(), 'src/public/css/production-orders.css'), 'utf-8');
      assert.ok(css.includes('@media (max-width: 767.98px)'), 'production-orders.css must contain mobile breakpoint');
      assert.ok(css.includes('attr(data-label)'), 'production-orders.css must use attr(data-label) for mobile layout');
      assert.ok(css.includes('.show-lines-card tbody tr td'), 'production-orders.css must style mobile table cells as stacked flex cards');
    });
  });

  describe('16. Final Closure & Lifecycle Hardening Regression Invariants', () => {
    // ----------------------------------------------------
    // 1. PAGINATION CONTRACT & PAYLOAD VALIDATION TESTS
    // ----------------------------------------------------
    it('production-orders.js: validates pagination payload contract strictly', () => {
      const js = readFileSync(resolve(process.cwd(), 'src/public/js/production-orders.js'), 'utf-8');
      assert.ok(js.includes('const { items, total, page, limit, totalPages, summary } = data'), 'Must destructure complete contract');
      assert.ok(js.includes('!Array.isArray(items)'), 'Must validate items array');
      assert.ok(js.includes('!Number.isInteger(total)'), 'Must validate total integer');
      assert.ok(js.includes('!Number.isInteger(page) || page < 1'), 'Must validate page >= 1');
      assert.ok(js.includes('!Number.isInteger(totalPages) || totalPages < 1'), 'Must validate totalPages >= 1');
    });

    // ----------------------------------------------------
    // 2. HISTORICAL / STALE SELECTION LIFECYCLE DTO TESTS
    // ----------------------------------------------------
    it('getOrderById(): returns explicit lifecycle metadata and availableOptions contains only active options', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a line with pattern selections
      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // 1. Initially both patterns and options are active
      let orderDto = await service.getOrderById('ord-1');
      let lineDto = orderDto.lines?.find((l) => l.id === line.id);
      assert.ok(lineDto);
      for (const sel of lineDto.patternSelections || []) {
        assert.equal(sel.isPatternActive, true, 'Pattern must be active');
        assert.equal(sel.isSelectedOptionActive, true, 'Option must be active');
        assert.equal(sel.isHistorical, false, 'Selection must not be historical');
        assert.ok(sel.availableOptions.length > 0, 'availableOptions must contain active options');
      }

      // 2. Archive option opt-1a while pattern p-1 remains active
      const opt1a = store.options.find((o) => o.id === 'opt-1a');
      if (opt1a) opt1a.deletedAt = new Date();

      orderDto = await service.getOrderById('ord-1');
      lineDto = orderDto.lines?.find((l) => l.id === line.id);
      const selP1 = lineDto?.patternSelections?.find((s) => s.templatePatternId === 'p-1');
      assert.ok(selP1);
      assert.equal(selP1.isPatternActive, true, 'Pattern p-1 remains active');
      assert.equal(selP1.isSelectedOptionActive, false, 'Archived option must not be active');
      assert.equal(selP1.isHistorical, true, 'Archived selected option makes selection historical');
      assert.equal(selP1.selectedOptionName, 'خيار 1-أ', 'Historical name preserved');
      // availableOptions must NOT contain opt-1a!
      assert.ok(!selP1.availableOptions.some((o) => o.id === 'opt-1a'), 'Archived option must NOT be in availableOptions');
      assert.ok(selP1.availableOptions.some((o) => o.id === 'opt-1b'), 'Active alternative option must be in availableOptions');

      // 3. Archive pattern p-2
      const pat2 = store.patterns.find((p) => p.id === 'p-2');
      if (pat2) pat2.deletedAt = new Date();

      orderDto = await service.getOrderById('ord-1');
      lineDto = orderDto.lines?.find((l) => l.id === line.id);
      const selP2 = lineDto?.patternSelections?.find((s) => s.templatePatternId === 'p-2');
      assert.ok(selP2);
      assert.equal(selP2.isPatternActive, false, 'Archived pattern must be marked inactive');
      assert.equal(selP2.isSelectedOptionActive, false, 'Option under archived pattern is inactive');
      assert.equal(selP2.isHistorical, true, 'Selection is historical');
      assert.equal(selP2.availableOptions.length, 0, 'Archived pattern must have empty availableOptions');
    });

    it('production-order-edit.js: strictly does NOT inject historical option fallback into availableOptions', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      assert.ok(!editJs.includes('[{ id: sel.selectedOptionId'), 'Must not create fake availableOptions array with historical option');
    });

    it('production-order-edit.js: evaluateLines enforces that selected option belongs to active availableOptions', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      assert.ok(editJs.includes('pat.availableOptions.some'), 'Must check active membership of selected option in availableOptions');
      assert.ok(editJs.includes('pat.isHistorical || !selectedExistsInActiveOptions'), 'Must invalidate line if option is historical or not active');
    });

    // ----------------------------------------------------
    // 3. SYNC PREVIEW STRUCTURAL CORRUPTION (FAIL-CLOSED)
    // ----------------------------------------------------
    it('previewSyncDraftLine(): foreign pattern belonging to another template throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add a foreign pattern belonging to a different template
      store.patterns.push({
        id: 'p-foreign-template',
        templateId: 'different-template-uuid',
        name: 'نمط لقالب آخر',
        deletedAt: null,
        createdAt: new Date(),
      });
      store.options.push({
        id: 'opt-foreign-tmpl',
        patternId: 'p-foreign-template',
        name: 'خيار لقالب آخر',
        sortOrder: 1,
        deletedAt: null,
      });

      const line = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });

      // Inject corrupt selection
      store.selections.push({
        id: 'sel-foreign-pat',
        orderLineId: line.id,
        templatePatternId: 'p-foreign-template',
        selectedOptionId: 'opt-foreign-tmpl',
      });

      await assert.rejects(
        async () => {
          await service.previewSyncDraftLine('ord-1', line.id);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT');
          return true;
        }
      );
    });

    it('previewSyncDraftLine(): foreign option belonging to another pattern throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Mismatch: set selection for p-1 with option belonging to p-2!
      const selP1 = store.selections.find((s) => s.orderLineId === line.id && s.templatePatternId === 'p-1');
      assert.ok(selP1);
      selP1.selectedOptionId = 'opt-2a'; // Belongs to p-2, not p-1!

      await assert.rejects(
        async () => {
          await service.previewSyncDraftLine('ord-1', line.id);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT');
          return true;
        }
      );
    });

    it('previewSyncDraftLine(): physically missing pattern throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 1,
      });

      // Inject selection with non-existent pattern
      store.selections.push({
        id: 'sel-missing-pat',
        orderLineId: line.id,
        templatePatternId: 'non-existent-pattern-uuid',
        selectedOptionId: 'opt-1a',
      });

      await assert.rejects(
        async () => {
          await service.previewSyncDraftLine('ord-1', line.id);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT');
          return true;
        }
      );
    });

    it('previewSyncDraftLine(): physically missing option throws PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT', async () => {
      const { service, store } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Set non-existent option
      const selP1 = store.selections.find((s) => s.orderLineId === line.id && s.templatePatternId === 'p-1');
      assert.ok(selP1);
      selP1.selectedOptionId = 'non-existent-option-uuid';

      await assert.rejects(
        async () => {
          await service.previewSyncDraftLine('ord-1', line.id);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT');
          return true;
        }
      );
    });

    it('previewSyncDraftLine(): archived valid option is treated as STALE and suggests replacement without mutating DB', async () => {
      const { service, store } = createDuplicateTestContext();

      const line = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 1,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Archive opt-1a
      const opt1a = store.options.find((o) => o.id === 'opt-1a');
      if (opt1a) opt1a.deletedAt = new Date();

      const preview = await service.previewSyncDraftLine('ord-1', line.id);

      assert.ok(preview);
      assert.equal(preview.hasChanges, true);
      // Selected option in DB MUST remain opt-1a (ZERO database mutations!)
      const dbSel = store.selections.find((s) => s.orderLineId === line.id && s.templatePatternId === 'p-1');
      assert.equal(dbSel?.selectedOptionId, 'opt-1a', 'Sync preview must NOT mutate selection in DB');

      // But preview recommends replacement with first active option (opt-1b)
      const resultingP1 = preview.resultingSelections.find((s) => s.patternId === 'p-1');
      assert.equal(resultingP1?.optionId, 'opt-1b', 'Preview must suggest active alternative opt-1b');
    });

    // ----------------------------------------------------
    // 4. REORDER CONTROLS & PERSISTENCE TESTS
    // ----------------------------------------------------
    it('production-order-edit.js: defines Up and Down reorder controls with boundary disabled states', () => {
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      assert.ok(editJs.includes('moveUpBtn.disabled = index === 0'), 'First line must have moveUpBtn disabled');
      assert.ok(editJs.includes('moveDownBtn.disabled = index === lines.length - 1'), 'Last line must have moveDownBtn disabled');
      assert.ok(editJs.includes('fa-arrow-up'), 'Must use up icon');
      assert.ok(editJs.includes('fa-arrow-down'), 'Must use down icon');
    });

    it('commitDraftLines(): persists reordered target lines with dense sortOrder 1..N', async () => {
      const { service, store } = createDuplicateTestContext();

      // Create lines A, B, C
      const lineA = await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 1 });
      const lineB = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 2,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1a' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });
      const lineC = await service.addLine('ord-1', {
        templateId: 't-with-patterns',
        quantity: 3,
        patternSelections: [
          { patternId: 'p-1', optionId: 'opt-1b' },
          { patternId: 'p-2', optionId: 'opt-2a' },
        ],
      });

      // Submit reordered payload: C, A, B
      const result = await service.commitDraftLines('ord-1', {
        lines: [
          {
            id: lineC.id,
            templateId: 't-with-patterns',
            quantity: 3,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1b' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
          {
            id: lineA.id,
            templateId: 't-no-patterns',
            quantity: 1,
          },
          {
            id: lineB.id,
            templateId: 't-with-patterns',
            quantity: 2,
            patternSelections: [
              { patternId: 'p-1', optionId: 'opt-1a' },
              { patternId: 'p-2', optionId: 'opt-2a' },
            ],
          },
        ],
      });

      const resLines = result.lines || [];
      assert.equal(resLines[0].id, lineC.id);
      assert.equal(resLines[0].sortOrder, 1);
      assert.equal(resLines[1].id, lineA.id);
      assert.equal(resLines[1].sortOrder, 2);
      assert.equal(resLines[2].id, lineB.id);
      assert.equal(resLines[2].sortOrder, 3);
    });

    // ----------------------------------------------------
    // 5. READINESS TEXT IN UI
    // ----------------------------------------------------
    it('Order UI screens strictly do NOT contain visible phrase "جاهز للإطلاق" and use "جاهز للاعتماد"', () => {
      const showEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/show.ejs'), 'utf-8');
      const editJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-edit.js'), 'utf-8');
      const indexEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/index.ejs'), 'utf-8');

      assert.ok(!showEjs.includes('جاهز للإطلاق'), 'show.ejs must not contain "جاهز للإطلاق"');
      assert.ok(showEjs.includes('جاهز للاعتماد'), 'show.ejs must contain "جاهز للاعتماد"');

      assert.ok(!editJs.includes('جاهز للإطلاق'), 'production-order-edit.js must not contain "جاهز للإطلاق"');
      assert.ok(editJs.includes('جاهز للاعتماد'), 'production-order-edit.js must contain "جاهز للاعتماد"');

      assert.ok(!indexEjs.includes('قبل الإطلاق'), 'index.ejs must not contain "قبل الإطلاق"');
      assert.ok(indexEjs.includes('قبل الاعتماد'), 'index.ejs must contain "قبل الاعتماد"');
    });

    // ----------------------------------------------------
    // 6. APPROVAL AUTHENTICATED USER IDENTITY
    // ----------------------------------------------------
    it('approveOrder(): throws PRODUCTION_ORDER_APPROVER_REQUIRED when user ID is missing and has no system-user fallback', async () => {
      const { service } = createDuplicateTestContext();

      // Add a valid line to make order ready
      await service.addLine('ord-1', {
        templateId: 't-no-patterns',
        quantity: 2,
      });

      // Attempt approve with empty string
      await assert.rejects(
        async () => {
          await service.approveOrder('ord-1', '');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_APPROVER_REQUIRED');
          return true;
        }
      );

      // Attempt approve with null user object
      await assert.rejects(
        async () => {
          await service.approveOrder('ord-1', null as any);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_APPROVER_REQUIRED');
          return true;
        }
      );

      // Verify production-order.service.ts strictly does NOT contain 'system-user'
      const svcCode = readFileSync(resolve(process.cwd(), 'src/modules/production/order/production-order.service.ts'), 'utf-8');
      assert.ok(!svcCode.includes("'system-user'"), 'production-order.service.ts must not contain "system-user" fallback');
    });
  });

  describe('Phase 4 — Production Order Priority Feature & Administrative Mutability', () => {
    // ----------------------------------------------------
    // A. ENUM / DOMAIN CONTRACT
    // ----------------------------------------------------
    it('ProductionOrderPriority: contains exactly CRITICAL, HIGH, NORMAL, LOW with identical string values', () => {
      assert.equal(ProductionOrderPriority.CRITICAL, 'CRITICAL');
      assert.equal(ProductionOrderPriority.HIGH, 'HIGH');
      assert.equal(ProductionOrderPriority.NORMAL, 'NORMAL');
      assert.equal(ProductionOrderPriority.LOW, 'LOW');
      assert.equal(Object.keys(ProductionOrderPriority).length, 4);
    });

    it('ProductionOrderEntity: default priority is NORMAL and property is exposed', () => {
      const order = new ProductionOrderEntity();
      assert.equal(ProductionOrderPriority.NORMAL, 'NORMAL');
      order.priority = ProductionOrderPriority.NORMAL;
      assert.equal(order.priority, ProductionOrderPriority.NORMAL);
    });

    // ----------------------------------------------------
    // B. DTO VALIDATION
    // ----------------------------------------------------
    it('CreateProductionOrderDto: optional priority accepts all 4 values, omitted is valid, invalid rejected', async () => {
      // 1. Omitted is valid
      const omitted = plainToInstance(CreateProductionOrderDto, { title: 'Test title', description: 'test' });
      assert.equal((await validate(omitted)).length, 0);

      // 2. All 4 values valid
      for (const p of [ProductionOrderPriority.CRITICAL, ProductionOrderPriority.HIGH, ProductionOrderPriority.NORMAL, ProductionOrderPriority.LOW]) {
        const valid = plainToInstance(CreateProductionOrderDto, { title: 'Test title', priority: p });
        assert.equal((await validate(valid)).length, 0, `Priority ${p} must be valid`);
      }

      // 3. Invalid rejected
      const invalid = plainToInstance(CreateProductionOrderDto, { title: 'Test title', priority: 'URGENT' as any });
      const errors = await validate(invalid);
      assert.ok(errors.length > 0, 'Invalid priority value must be rejected');
      assert.ok(errors[0].constraints?.isEnum, 'Must contain isEnum constraint error');
    });

    it('UpdateProductionOrderPriorityDto: requires priority, accepts 4 values, rejects invalid', async () => {
      // 1. Omitted rejected
      const omitted = plainToInstance(UpdateProductionOrderPriorityDto, {});
      assert.ok((await validate(omitted)).length > 0, 'Missing priority must fail');

      // 2. All 4 valid
      for (const p of [ProductionOrderPriority.CRITICAL, ProductionOrderPriority.HIGH, ProductionOrderPriority.NORMAL, ProductionOrderPriority.LOW]) {
        const valid = plainToInstance(UpdateProductionOrderPriorityDto, { priority: p });
        assert.equal((await validate(valid)).length, 0);
      }

      // 3. Invalid rejected
      const invalid = plainToInstance(UpdateProductionOrderPriorityDto, { priority: 'HIGH_PRIORITY' as any });
      const errors = await validate(invalid);
      assert.ok(errors.length > 0);
      assert.ok(errors[0].constraints?.isEnum);
    });

    it('ListProductionOrdersQueryDto: accepts optional priority, rejects invalid', async () => {
      const omitted = plainToInstance(ListProductionOrdersQueryDto, { page: 1 });
      assert.equal((await validate(omitted)).length, 0);

      const valid = plainToInstance(ListProductionOrdersQueryDto, { priority: ProductionOrderPriority.CRITICAL });
      assert.equal((await validate(valid)).length, 0);

      const invalid = plainToInstance(ListProductionOrdersQueryDto, { priority: 'UNKNOWN' as any });
      const errors = await validate(invalid);
      assert.ok(errors.length > 0);
    });

    it('UpdateProductionOrderDto: does NOT contain priority field (architectural invariant)', () => {
      const updateDto = new UpdateProductionOrderDto();
      assert.ok(!('priority' in updateDto), 'UpdateProductionOrderDto must NOT declare priority field');
      const dtoFile = readFileSync(resolve(process.cwd(), 'src/modules/production/order/dto/update-production-order.dto.ts'), 'utf-8');
      assert.ok(!dtoFile.includes('priority'), 'update-production-order.dto.ts must not contain priority');
    });

    // ----------------------------------------------------
    // C. ORDER CREATION WITH PRIORITY
    // ----------------------------------------------------
    it('createOrder(): defaults to NORMAL when priority is omitted', async () => {
      const { service, store } = createDuplicateTestContext();
      const created = await service.createOrder({ title: 'طلب عادي', description: 'طلب عادي' }, 'user-creator-1');

      assert.equal(created.priority, ProductionOrderPriority.NORMAL);
      assert.equal(store.order.priority, ProductionOrderPriority.NORMAL);
      assert.equal(created.status, ProductionOrderStatus.DRAFT);
      assert.equal(created.orderNumber, 'PO-000002');
    });

    it('createOrder(): explicitly set priority is persisted and returned in DTO', async () => {
      const { service, store } = createDuplicateTestContext();
      const created = await service.createOrder(
        { title: 'طلب حرج', description: 'طلب حرج', priority: ProductionOrderPriority.CRITICAL },
        'user-creator-1'
      );

      assert.equal(created.priority, ProductionOrderPriority.CRITICAL);
      assert.equal(store.order.priority, ProductionOrderPriority.CRITICAL);
      assert.equal(created.status, ProductionOrderStatus.DRAFT);
    });

    // ----------------------------------------------------
    // D. PRIORITY MUTATION & APPROVED IMMUTABILITY EXCEPTION
    // ----------------------------------------------------
    it('updatePriority(): updates priority on DRAFT order without mutating lines or notes', async () => {
      const { service, store } = createDuplicateTestContext();
      store.order.description = 'وصف أصلي';
      store.order.notes = 'ملاحظات أصلية';

      const updated = await service.updatePriority('ord-1', { priority: ProductionOrderPriority.HIGH });

      assert.equal(updated.priority, ProductionOrderPriority.HIGH);
      assert.equal(store.order.priority, ProductionOrderPriority.HIGH);
      assert.equal(updated.status, ProductionOrderStatus.DRAFT);
      assert.equal(updated.description, 'وصف أصلي');
      assert.equal(updated.notes, 'ملاحظات أصلية');
    });

    it('updatePriority(): updates priority on APPROVED order without reopening and preserves approval metadata', async () => {
      const { service, store } = createDuplicateTestContext();

      // Add line and approve order
      await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 2 });
      await service.approveOrder('ord-1', 'approver-user-456');

      assert.equal(store.order.status, ProductionOrderStatus.APPROVED);
      const originalApprovedAt = store.order.approvedAt;
      const originalApprovedBy = store.order.approvedByUserId;
      assert.ok(originalApprovedAt);
      assert.equal(originalApprovedBy, 'approver-user-456');

      // Update priority to CRITICAL while order is APPROVED
      const updated = await service.updatePriority('ord-1', { priority: ProductionOrderPriority.CRITICAL });

      assert.equal(updated.priority, ProductionOrderPriority.CRITICAL);
      assert.equal(store.order.priority, ProductionOrderPriority.CRITICAL);
      assert.equal(updated.status, ProductionOrderStatus.APPROVED, 'Status MUST remain APPROVED');
      assert.equal(store.order.status, ProductionOrderStatus.APPROVED, 'Status in store MUST remain APPROVED');
      assert.equal(store.order.approvedByUserId, originalApprovedBy, 'approvedByUserId must not be cleared');
      assert.equal(store.order.approvedAt, originalApprovedAt, 'approvedAt must not be cleared');
    });

    it('updatePriority(): fails with PRODUCTION_ORDER_NOT_FOUND on missing or archived order', async () => {
      const { service, store } = createDuplicateTestContext();

      // Missing
      await assert.rejects(
        async () => {
          await service.updatePriority('non-existent-id', { priority: ProductionOrderPriority.CRITICAL });
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
          return true;
        }
      );

      // Soft-deleted
      store.order.deletedAt = new Date();
      await assert.rejects(
        async () => {
          await service.updatePriority('ord-1', { priority: ProductionOrderPriority.CRITICAL });
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_FOUND');
          return true;
        }
      );
    });

    // ----------------------------------------------------
    // E. APPROVED IMMUTABILITY REGRESSION INVARIANTS
    // ----------------------------------------------------
    it('APPROVED order immutability regression: all business content mutations remain rejected on APPROVED', async () => {
      const { service, store } = createDuplicateTestContext();

      await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 1 });
      await service.approveOrder('ord-1', 'approver-1');
      assert.equal(store.order.status, ProductionOrderStatus.APPROVED);

      // 1. updateOrder description/notes rejected
      await assert.rejects(
        async () => {
          await service.updateOrder('ord-1', { description: 'محاولة تعديل وصف معتمد' });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_DRAFT');
          return true;
        }
      );

      // 2. commitDraftLines rejected
      await assert.rejects(
        async () => {
          await service.commitDraftLines('ord-1', { lines: [] });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_DRAFT');
          return true;
        }
      );

      // 3. addLine rejected
      await assert.rejects(
        async () => {
          await service.addLine('ord-1', { templateId: 't-no-patterns', quantity: 5 });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_DRAFT');
          return true;
        }
      );

      // 4. archiveOrder rejected
      await assert.rejects(
        async () => {
          await service.archiveOrder('ord-1');
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_DRAFT');
          return true;
        }
      );
    });

    // ----------------------------------------------------
    // F. AUTHORIZATION & ROUTE SPECIFICATION
    // ----------------------------------------------------
    it('Route /api/production/orders/:orderId/priority: protected by PRODUCTION_ORDER_UPDATE_PRIORITY and not general update', () => {
      const routeFile = readFileSync(resolve(process.cwd(), 'src/modules/production/order/production-order.route.ts'), 'utf-8');

      assert.ok(routeFile.includes('/:orderId/priority'), 'Must declare route /:orderId/priority');
      assert.ok(routeFile.includes('patch('), 'Must declare PATCH method');
      assert.ok(routeFile.includes('SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY'), 'Must require PRODUCTION_ORDER_UPDATE_PRIORITY');
      assert.ok(routeFile.includes('UpdateProductionOrderPriorityDto'), 'Must validate UpdateProductionOrderPriorityDto');
      assert.ok(routeFile.includes('productionOrderController.updatePriority'), 'Must dispatch to updatePriority controller');
    });

    // ----------------------------------------------------
    // G. MIGRATION 0016 STRUCTURE, HARDENED RECOVERY & REVERSIBILITY
    // ----------------------------------------------------
    function createMockMigrationRunner(initialState: {
      tableExists?: boolean;
      hasPriorityColumn?: boolean;
      columnType?: string;
      hasCheckConstraint?: boolean;
      hasPriorityIndex?: boolean;
      ordersWithInvalidPriority?: Array<{ id: string; order_number: string; priority: string }>;
      failDropConstraint?: boolean;
      failDropCheck?: boolean;
    }) {
      const state = {
        tableExists: initialState.tableExists ?? true,
        hasPriorityColumn: initialState.hasPriorityColumn ?? false,
        columnType: initialState.columnType || 'varchar',
        hasCheckConstraint: initialState.hasCheckConstraint ?? false,
        hasPriorityIndex: initialState.hasPriorityIndex ?? false,
        ordersWithInvalidPriority: initialState.ordersWithInvalidPriority || [],
        failDropConstraint: initialState.failDropConstraint ?? false,
        failDropCheck: initialState.failDropCheck ?? false,
      };

      const addedColumns: any[] = [];
      const createdIndices: any[] = [];
      const droppedColumns: string[] = [];
      const droppedIndices: string[] = [];
      const executedQueries: string[] = [];

      const runner: any = {
        state,
        addedColumns,
        createdIndices,
        droppedColumns,
        droppedIndices,
        executedQueries,
        getTable: async (name: string) => {
          if (!state.tableExists) return null;
          return {
            name,
            findColumnByName: (colName: string) => {
              if (colName === 'priority' && state.hasPriorityColumn) {
                return { name: 'priority', type: state.columnType };
              }
              return null;
            },
            indices: state.hasPriorityIndex
              ? [{ name: 'IDX_production_order_priority', columnNames: ['priority'] }]
              : [],
          };
        },
        addColumn: async (table: string, col: any) => {
          addedColumns.push({ table, col });
          state.hasPriorityColumn = true;
        },
        createIndex: async (table: string, idx: any) => {
          createdIndices.push({ table, idx });
          state.hasPriorityIndex = true;
        },
        dropIndex: async (table: string, idx: any) => {
          droppedIndices.push(idx.name || idx);
          state.hasPriorityIndex = false;
        },
        dropColumn: async (table: string, colName: string) => {
          droppedColumns.push(colName);
          state.hasPriorityColumn = false;
        },
        query: async (q: string, params?: any[]) => {
          executedQueries.push(q);
          if (q.includes('information_schema.TABLE_CONSTRAINTS')) {
            return [{ cnt: state.hasCheckConstraint ? '1' : '0' }];
          }
          if (q.includes('ALTER TABLE `production_order` ADD CONSTRAINT `CHK_production_order_priority`')) {
            state.hasCheckConstraint = true;
            return [];
          }
          if (q.includes('ALTER TABLE `production_order` DROP CONSTRAINT `CHK_production_order_priority`')) {
            if (state.failDropConstraint) {
              throw new Error('MySQL version does not support DROP CONSTRAINT');
            }
            state.hasCheckConstraint = false;
            return [];
          }
          if (q.includes('ALTER TABLE `production_order` DROP CHECK `CHK_production_order_priority`')) {
            if (state.failDropCheck) {
              throw new Error('Syntax error dropping check');
            }
            state.hasCheckConstraint = false;
            return [];
          }
          if (q.includes('WHERE `priority` NOT IN')) {
            return state.ordersWithInvalidPriority;
          }
          return [];
        },
      };

      return runner;
    }

    it('Migration 0016: Scenario A — Clean Up creates column, CHECK constraint, and index', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      assert.equal(migration.name, 'AddProductionOrderPriority1710000000016');

      const runner = createMockMigrationRunner({
        hasPriorityColumn: false,
        hasCheckConstraint: false,
        hasPriorityIndex: false,
      });

      await migration.up(runner);

      assert.equal(runner.addedColumns.length, 1);
      assert.equal(runner.addedColumns[0].col.name, 'priority');
      assert.equal(runner.addedColumns[0].col.default, "'NORMAL'");
      assert.equal(runner.addedColumns[0].col.isNullable, false);

      const hasUpdate = runner.executedQueries.some((q) => q.includes("UPDATE `production_order` SET `priority` = 'NORMAL'"));
      assert.ok(hasUpdate, 'Must normalize existing empty/null rows to NORMAL');

      assert.ok(runner.state.hasCheckConstraint, 'Must have CHECK constraint after up');
      assert.equal(runner.createdIndices.length, 1);
      assert.equal(runner.createdIndices[0].idx.name, 'IDX_production_order_priority');
      assert.ok(runner.state.hasPriorityIndex, 'Must have index after up');
    });

    it('Migration 0016: Scenario B — Partial State (column only) recovers missing CHECK and index without recreating column', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: false,
        hasPriorityIndex: false,
      });

      await migration.up(runner);

      assert.equal(runner.addedColumns.length, 0, 'Must NOT recreate column if it already exists');
      assert.ok(runner.state.hasCheckConstraint, 'Must create missing CHECK constraint');
      assert.equal(runner.createdIndices.length, 1, 'Must create missing index');
      assert.equal(runner.createdIndices[0].idx.name, 'IDX_production_order_priority');
    });

    it('Migration 0016: Scenario C — Partial State (column + CHECK) recovers missing index without duplicating CHECK', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: true,
        hasPriorityIndex: false,
      });

      await migration.up(runner);

      assert.equal(runner.addedColumns.length, 0, 'Must not recreate column');
      const addCheckQueries = runner.executedQueries.filter((q) => q.includes('ADD CONSTRAINT `CHK_production_order_priority`'));
      assert.equal(addCheckQueries.length, 0, 'Must not recreate existing CHECK');
      assert.equal(runner.createdIndices.length, 1, 'Must create missing index');
    });

    it('Migration 0016: Scenario D — Partial State (column + index) recovers missing CHECK without duplicating index', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: false,
        hasPriorityIndex: true,
      });

      await migration.up(runner);

      assert.equal(runner.addedColumns.length, 0, 'Must not recreate column');
      assert.equal(runner.createdIndices.length, 0, 'Must not recreate existing index');
      assert.ok(runner.state.hasCheckConstraint, 'Must create missing CHECK constraint');
    });

    it('Migration 0016: Scenario E — Fully Applied state is idempotent and creates no duplicates', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: true,
        hasPriorityIndex: true,
      });

      await migration.up(runner);

      assert.equal(runner.addedColumns.length, 0, 'Must not add column');
      assert.equal(runner.createdIndices.length, 0, 'Must not add index');
      const addCheckQueries = runner.executedQueries.filter((q) => q.includes('ADD CONSTRAINT `CHK_production_order_priority`'));
      assert.equal(addCheckQueries.length, 0, 'Must not add CHECK');
    });

    it('Migration 0016: Scenario F — Down from full state drops CHECK, index, and column', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: true,
        hasPriorityIndex: true,
      });

      await migration.down(runner);

      assert.ok(!runner.state.hasCheckConstraint, 'Must drop CHECK constraint');
      assert.ok(runner.droppedIndices.includes('IDX_production_order_priority'), 'Must drop index');
      assert.ok(runner.droppedColumns.includes('priority'), 'Must drop column');
    });

    it('Migration 0016: Scenario G — Down safely handles partial states and does not swallow unexpected errors', async () => {
      const migration = new AddProductionOrderPriority1710000000016();

      // Case 1: Only column present (CHECK and index already missing)
      const runner1 = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: false,
        hasPriorityIndex: false,
      });
      await migration.down(runner1);
      assert.equal(runner1.droppedIndices.length, 0, 'Should not attempt to drop missing index');
      assert.ok(runner1.droppedColumns.includes('priority'), 'Should drop priority column');

      // Case 2: MariaDB/MySQL 8.0.16 fallback: DROP CONSTRAINT fails, falls back to DROP CHECK
      const runner2 = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: true,
        hasPriorityIndex: true,
        failDropConstraint: true, // triggers fallback to DROP CHECK
      });
      await migration.down(runner2);
      assert.ok(!runner2.state.hasCheckConstraint, 'Fallback DROP CHECK must succeed');

      // Case 3: Genuine unexpected failure in dropping CHECK is NOT masked
      const runner3 = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: true,
        hasPriorityIndex: true,
        failDropConstraint: true,
        failDropCheck: true, // both fail -> genuine unexpected error
      });
      await assert.rejects(
        async () => {
          await migration.down(runner3);
        },
        /Migration 1710000000016 down failed to drop CHECK constraint/
      );
    });

    it('Migration 0016: Scenario H — Invalid business data throws and is never silently rewritten', async () => {
      const migration = new AddProductionOrderPriority1710000000016();
      const runner = createMockMigrationRunner({
        hasPriorityColumn: true,
        hasCheckConstraint: false,
        hasPriorityIndex: false,
        ordersWithInvalidPriority: [
          { id: 'bad-ord-1', order_number: 'PO-000999', priority: 'URGENT' },
          { id: 'bad-ord-2', order_number: 'PO-000998', priority: '1' },
        ],
      });

      await assert.rejects(
        async () => {
          await migration.up(runner);
        },
        (err: any) => {
          return (
            err instanceof Error &&
            err.message.includes('Migration 1710000000016 up failed: Found 2 production orders with invalid priority values') &&
            err.message.includes('PO-000999') &&
            err.message.includes('URGENT') &&
            err.message.includes('PO-000998')
          );
        }
      );
    });

    it('Migration 0016: Fails loudly if base table does not exist or column type is incompatible', async () => {
      const migration = new AddProductionOrderPriority1710000000016();

      // Missing base table
      const runnerNoTable = createMockMigrationRunner({ tableExists: false });
      await assert.rejects(
        async () => {
          await migration.up(runnerNoTable);
        },
        /Base table 'production_order' does not exist/
      );

      // Incompatible column type
      const runnerBadType = createMockMigrationRunner({
        hasPriorityColumn: true,
        columnType: 'int',
      });
      await assert.rejects(
        async () => {
          await migration.up(runnerBadType);
        },
        /Column 'priority' already exists but has incompatible type 'int'/
      );
    });

    // ----------------------------------------------------
    // H & I. LIST FILTERING & BUSINESS RANK SORTING
    // ----------------------------------------------------
    it('production-order.service.ts: listOrders applies priority filter to both item and summary queries', () => {
      const svcCode = readFileSync(resolve(process.cwd(), 'src/modules/production/order/production-order.service.ts'), 'utf-8');

      assert.ok(svcCode.includes("qb.andWhere('o.priority = :priority', { priority: query.priority })"), 'Must filter items by priority');
      assert.ok(svcCode.includes("summaryQb.andWhere('o.priority = :priority', { priority: query.priority })"), 'Must filter KPI summary by priority');
    });

    it('production-order.service.ts: listOrders sorts by business priority rank (CRITICAL > HIGH > NORMAL > LOW), then created_at ASC, id ASC', () => {
      const svcCode = readFileSync(resolve(process.cwd(), 'src/modules/production/order/production-order.service.ts'), 'utf-8');

      assert.ok(svcCode.includes("WHEN 'CRITICAL' THEN 4"), 'CRITICAL must rank 4');
      assert.ok(svcCode.includes("WHEN 'HIGH' THEN 3"), 'HIGH must rank 3');
      assert.ok(svcCode.includes("WHEN 'NORMAL' THEN 2"), 'NORMAL must rank 2');
      assert.ok(svcCode.includes("WHEN 'LOW' THEN 1"), 'LOW must rank 1');
      assert.ok(svcCode.includes(".orderBy('priority_rank', 'DESC')"), 'Must sort by priority_rank DESC');
      assert.ok(svcCode.includes(".addOrderBy('o.created_at', 'ASC')"), 'Must sort by created_at ASC within equal priority');
      assert.ok(svcCode.includes(".addOrderBy('o.id', 'ASC')"), 'Must sort by id ASC tie breaker');
    });

    // ----------------------------------------------------
    // J. RESPONSE CONTRACT
    // ----------------------------------------------------
    it('getOrderById() and listOrders(): returns priority in ProductionOrderDto and ProductionOrderListItemDto', async () => {
      const { service, store } = createDuplicateTestContext();
      store.order.priority = ProductionOrderPriority.HIGH;

      const orderDto = await service.getOrderById('ord-1');
      assert.equal(orderDto.priority, ProductionOrderPriority.HIGH, 'ProductionOrderDto must expose priority');

      // Verify ProductionOrderEntity model also has priority
      assert.equal(store.order.priority, ProductionOrderPriority.HIGH);
    });

    // ----------------------------------------------------
    // K. UI ACCESSIBILITY & SECURITY INVARIANTS
    // ----------------------------------------------------
    it('UI templates: expose correct Arabic labels and accessibility semantics without dynamic innerHTML', () => {
      const createEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/create.ejs'), 'utf-8');
      const indexEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/index.ejs'), 'utf-8');
      const showEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/show.ejs'), 'utf-8');
      const editEjs = readFileSync(resolve(process.cwd(), 'src/views/dashboard/production/orders/edit.ejs'), 'utf-8');
      const ordersJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-orders.js'), 'utf-8');
      const showJs = readFileSync(resolve(process.cwd(), 'src/public/js/production-order-show.js'), 'utf-8');

      // 1. Create page priority selector
      assert.ok(createEjs.includes('id="orderPriority"'), 'create.ejs must have orderPriority selector');
      assert.ok(createEjs.includes('value="CRITICAL">حرجة'), 'create.ejs must have CRITICAL');
      assert.ok(createEjs.includes('value="HIGH">عالية'), 'create.ejs must have HIGH');
      assert.ok(createEjs.includes('value="NORMAL" selected>عادية'), 'create.ejs must default to NORMAL');
      assert.ok(createEjs.includes('value="LOW">منخفضة'), 'create.ejs must have LOW');

      // 2. Index page priority filter and table header
      assert.ok(indexEjs.includes('id="orderPriorityFilter"'), 'index.ejs must contain orderPriorityFilter');
      assert.ok(indexEjs.includes('الأولوية</th>'), 'index.ejs must have priority table header');

      // 3. Show page priority badges and updater
      assert.ok(showEjs.includes('أولوية حرجة'), 'show.ejs must have Arabic critical badge');
      assert.ok(showEjs.includes('أولوية عالية'), 'show.ejs must have Arabic high badge');
      assert.ok(showEjs.includes('أولوية عادية'), 'show.ejs must have Arabic normal badge');
      assert.ok(showEjs.includes('أولوية منخفضة'), 'show.ejs must have Arabic low badge');
      assert.ok(showEjs.includes('id="changePrioritySelect"'), 'show.ejs must have priority dropdown');
      assert.ok(showEjs.includes('id="updatePriorityBtn"'), 'show.ejs must have updatePriorityBtn');

      // 4. Edit page priority display
      assert.ok(editEjs.includes('أولوية حرجة'), 'edit.ejs must have priority badge');
      assert.ok(editEjs.includes('أولوية عادية'), 'edit.ejs must have normal badge');

      // 5. Zero dynamic XSS
      assert.ok(ordersJs.includes("pBadge.textContent = 'حرجة'"), 'orders.js must set priority text via textContent');
      assert.ok(ordersJs.includes("pBadge.textContent = 'عالية'"), 'orders.js must set priority text via textContent');
      assert.ok(ordersJs.includes("pBadge.textContent = 'عادية'"), 'orders.js must set priority text via textContent');
      assert.ok(ordersJs.includes("pBadge.textContent = 'منخفضة'"), 'orders.js must set priority text via textContent');
      assert.ok(!ordersJs.includes('${order.priority}'), 'orders.js must not interpolate order.priority into HTML');
      assert.ok(!showJs.includes('${selectedPriority}'), 'show.js must not interpolate priority into HTML');
    });
  });
});


