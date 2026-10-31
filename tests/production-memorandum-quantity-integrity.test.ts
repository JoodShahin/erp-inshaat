import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  calculateLineQuantities,
} from '../src/modules/production/order-line/production-order-line-quantity.helper.js';
import {
  ProductionOrderLineAllocationService,
  CandidateUnitLike,
} from '../src/modules/production/order-line/production-order-line-allocation.service.js';
import { ProductionOrderStatus } from '../src/modules/production/order/production-order.entity.js';
import { ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';
import { ForbiddenError } from '../src/common/errors/forbidden.error.js';

describe('Production Memorandum Quantity Integrity & Allocation Protection Test Suite', () => {
  // ==========================================
  // 1. Centralized Calculation Tests
  // ==========================================
  describe('1. Centralized Quantity Helper (calculateLineQuantities)', () => {
    it('1. requested: 10, linked: 4 => remaining: 6, excess: 0, hasQuantityViolation: false', () => {
      const q = calculateLineQuantities(10, 4);
      assert.equal(q.requestedQuantity, 10);
      assert.equal(q.linkedQuantity, 4);
      assert.equal(q.remainingQuantity, 6);
      assert.equal(q.excessQuantity, 0);
      assert.equal(q.hasQuantityViolation, false);
    });

    it('2. requested: 10, linked: 10 => remaining: 0, excess: 0, hasQuantityViolation: false', () => {
      const q = calculateLineQuantities(10, 10);
      assert.equal(q.requestedQuantity, 10);
      assert.equal(q.linkedQuantity, 10);
      assert.equal(q.remainingQuantity, 0);
      assert.equal(q.excessQuantity, 0);
      assert.equal(q.hasQuantityViolation, false);
    });

    it('3. requested: 10, linked: 12 => remaining: 0, excess: 2, hasQuantityViolation: true (historical over-allocation)', () => {
      const q = calculateLineQuantities(10, 12);
      assert.equal(q.requestedQuantity, 10);
      assert.equal(q.linkedQuantity, 12);
      assert.equal(q.remainingQuantity, 0);
      assert.equal(q.excessQuantity, 2);
      assert.equal(q.hasQuantityViolation, true);
    });

    it('4. requested: 0, linked: 0 => remaining: 0, excess: 0, hasQuantityViolation: false', () => {
      const q = calculateLineQuantities(0, 0);
      assert.equal(q.remainingQuantity, 0);
      assert.equal(q.excessQuantity, 0);
      assert.equal(q.hasQuantityViolation, false);
    });
  });

  // ==========================================
  // 2. Compatibility Verification Unit Tests
  // ==========================================
  describe('2. Compatibility Verification (verifyCandidateUnitCompatibility)', () => {
    const allocationService = new ProductionOrderLineAllocationService();

    const tmplId = 'tmpl-villa-1';
    const patternA = 'pat-doors';
    const optSteel = 'opt-steel-door';
    const optWood = 'opt-wood-door';

    const hashStandard = hashLineConfiguration(tmplId, [
      { templatePatternId: patternA, selectedOptionId: optSteel },
    ]);
    const hashWood = hashLineConfiguration(tmplId, [
      { templatePatternId: patternA, selectedOptionId: optWood },
    ]);

    const mockLine: any = {
      id: 'line-10',
      orderId: 'order-10',
      templateId: tmplId,
      quantity: 10,
      activeConfigurationHash: hashStandard,
      patternSelections: [
        { templatePatternId: patternA, selectedOptionId: optSteel },
      ],
      template: {
        id: tmplId,
        specifications: [
          { name: 'Thickness', value: '25cm', sortOrder: 1 },
          { name: 'ConcreteGrade', value: 'C35', sortOrder: 2 },
        ],
      },
    };

    it('5. Valid candidate unit matching template, pattern, and specs succeeds', () => {
      const validCandidate: CandidateUnitLike = {
        id: 'unit-001',
        orderLineId: null,
        orderId: null,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: {
          templateId: tmplId,
          configurationHash: hashStandard,
          patternSummary: [{ patternId: patternA, optionId: optSteel }],
          specifications: [
            { name: 'Thickness', value: '25cm', unit: 'cm', sortOrder: 1 },
            { name: 'ConcreteGrade', value: 'C35', unit: null, sortOrder: 2 },
          ],
        },
      };

      assert.doesNotThrow(() => {
        allocationService.verifyCandidateUnitCompatibility(
          mockLine,
          validCandidate,
          mockLine.template.specifications
        );
      });
    });

    it('6. Rejects cancelled or archived room with PRODUCTION_UNIT_CANCELLED', () => {
      const cancelledCandidate: CandidateUnitLike = {
        id: 'unit-002',
        orderLineId: null,
        orderId: null,
        templateId: tmplId,
        isCancelled: true,
        status: ProductionUnitStatus.CANCELLED,
        deletedAt: null,
        plan: { templateId: tmplId, configurationHash: hashStandard },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, cancelledCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_CANCELLED');
          return true;
        }
      );
    });

    it('7. Rejects already linked room (double booking) with PRODUCTION_UNIT_ALREADY_LINKED', () => {
      const doubleBookedCandidate: CandidateUnitLike = {
        id: 'unit-003',
        orderLineId: 'other-line-99',
        orderId: 'other-order-88',
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: { templateId: tmplId, configurationHash: hashStandard },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, doubleBookedCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_ALREADY_LINKED');
          return true;
        }
      );
    });

    it('8. Rejects template mismatch with PRODUCTION_UNIT_TEMPLATE_MISMATCH', () => {
      const wrongTemplateCandidate: CandidateUnitLike = {
        id: 'unit-004',
        orderLineId: null,
        templateId: 'tmpl-another-building',
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: { templateId: 'tmpl-another-building', configurationHash: hashStandard },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, wrongTemplateCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_TEMPLATE_MISMATCH');
          return true;
        }
      );
    });

    it('9. Rejects pattern mismatch (wood door instead of steel door) with PRODUCTION_UNIT_PATTERN_MISMATCH', () => {
      const wrongPatternCandidate: CandidateUnitLike = {
        id: 'unit-005',
        orderLineId: null,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: {
          templateId: tmplId,
          configurationHash: hashWood,
          patternSummary: [{ patternId: patternA, optionId: optWood }],
        },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, wrongPatternCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_PATTERN_MISMATCH');
          return true;
        }
      );
    });

    it('10. Rejects specification mismatch (20cm thickness instead of 25cm) with PRODUCTION_UNIT_SPECIFICATION_MISMATCH', () => {
      const wrongSpecCandidate: CandidateUnitLike = {
        id: 'unit-006',
        orderLineId: null,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: {
          templateId: tmplId,
          configurationHash: hashStandard,
          patternSummary: [{ patternId: patternA, optionId: optSteel }],
          specifications: [
            { name: 'Thickness', value: '20cm', unit: 'cm', sortOrder: 1 },
            { name: 'ConcreteGrade', value: 'C35', unit: null, sortOrder: 2 },
          ],
        },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(
            mockLine,
            wrongSpecCandidate,
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_SPECIFICATION_MISMATCH');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 3. Mock Transactional Allocation & Quantity Guard Tests
  // ==========================================
  describe('3. Transactional Allocation & Limit Enforcement (Table Cases 1-6)', () => {
    function createMockAllocationContext(initialState: {
      lineQuantity: number;
      orderStatus: string;
      activeUnits: number;
      cancelledUnits?: number;
      otherLineUnits?: number;
      isHistoricalOverAllocated?: boolean;
    }) {
      const orderId = 'order-mock-1';
      const lineId = 'line-mock-10';
      const otherLineId = 'line-mock-20';
      const tmplId = 'tmpl-mock-1';

      const lineRow = {
        id: lineId,
        orderId,
        templateId: tmplId,
        quantity: initialState.lineQuantity,
        sortOrder: 1,
        activeConfigurationHash: 'hash-abc',
        deletedAt: null,
        order: { id: orderId, orderNumber: 'PO-TEST', status: initialState.orderStatus },
        patternSelections: [],
        template: { id: tmplId, specifications: [] },
      };

      const unitsInDb: any[] = [];
      // Populate active units for this line
      for (let i = 1; i <= initialState.activeUnits; i++) {
        unitsInDb.push({
          id: `unit-active-${i}`,
          orderId,
          orderLineId: lineId,
          isCancelled: false,
          status: ProductionUnitStatus.CREATED,
          deletedAt: null,
          plan: { templateId: tmplId, configurationHash: 'hash-abc' },
        });
      }
      // Populate cancelled units for this line (should not be counted in linked)
      const cancelledCount = initialState.cancelledUnits || 0;
      for (let i = 1; i <= cancelledCount; i++) {
        unitsInDb.push({
          id: `unit-cancelled-${i}`,
          orderId,
          orderLineId: lineId,
          isCancelled: true,
          status: ProductionUnitStatus.CANCELLED,
          deletedAt: null,
          plan: { templateId: tmplId, configurationHash: 'hash-abc' },
        });
      }
      // Populate units belonging to another line (line isolation)
      const otherLineCount = initialState.otherLineUnits || 0;
      for (let i = 1; i <= otherLineCount; i++) {
        unitsInDb.push({
          id: `unit-other-${i}`,
          orderId,
          orderLineId: otherLineId,
          isCancelled: false,
          status: ProductionUnitStatus.CREATED,
          deletedAt: null,
          plan: { templateId: tmplId, configurationHash: 'hash-abc' },
        });
      }

      const mockUnitRepo: any = {
        createQueryBuilder: () => ({
          where: function () { return this; },
          andWhere: function () { return this; },
          setLock: function () { return this; },
          leftJoinAndSelect: function () { return this; },
          getCount: async () => {
            return unitsInDb.filter(
              (u) => u.orderLineId === lineId && !u.isCancelled && u.status !== ProductionUnitStatus.CANCELLED && !u.deletedAt
            ).length;
          },
          getMany: async () => unitsInDb,
        }),
        count: async (opts: any) => {
          return unitsInDb.filter(
            (u) => u.orderLineId === lineId && !u.isCancelled && u.status !== ProductionUnitStatus.CANCELLED && !u.deletedAt
          ).length;
        },
        findOne: async (opts: any) => {
          const id = opts?.where?.id;
          return unitsInDb.find((u) => u.id === id) || null;
        },
        save: async (u: any) => {
          if (Array.isArray(u)) {
            for (const item of u) {
              const idx = unitsInDb.findIndex((x) => x.id === item.id);
              if (idx >= 0) unitsInDb[idx] = item;
              else unitsInDb.push(item);
            }
          } else {
            const idx = unitsInDb.findIndex((x) => x.id === u.id);
            if (idx >= 0) unitsInDb[idx] = u;
            else unitsInDb.push(u);
          }
          return u;
        },
      };

      const mockLineRepo: any = {
        createQueryBuilder: () => ({
          setLock: function () { return this; },
          leftJoinAndSelect: function () { return this; },
          where: function () { return this; },
          andWhere: function () { return this; },
          getOne: async () => lineRow,
        }),
        findOne: async () => lineRow,
      };

      const mockEventRepo: any = {
        create: (dto: any) => dto,
        save: async () => {},
      };

      const mockDataSource: any = {
        getRepository: (entity: any) => {
          if (entity.name === 'ProductionOrderLineEntity') return mockLineRepo;
          if (entity.name === 'ProductionUnitEntity') return mockUnitRepo;
          if (entity.name === 'ProductionUnitEventEntity') return mockEventRepo;
          return {};
        },
        transaction: async (cb: (em: any) => Promise<any>) => {
          const mockManager: any = {
            getRepository: (entity: any) => {
              if (entity.name === 'ProductionOrderLineEntity') return mockLineRepo;
              if (entity.name === 'ProductionUnitEntity') return mockUnitRepo;
              if (entity.name === 'ProductionUnitEventEntity') return mockEventRepo;
              return {};
            },
          };
          return await cb(mockManager);
        },
      };

      const service = new ProductionOrderLineAllocationService(mockDataSource);
      return { service, lineRow, unitsInDb };
    }

    // Case 1: Requested: 10, Linked: 0, Attempting to add: 10 -> Accept
    it('11. Case 1 (10 requested, 0 linked, adding 10) -> Accepted and fully linked', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 0,
      });

      const candidateUnits: CandidateUnitLike[] = Array.from({ length: 10 }, (_, i) => ({
        id: `cand-${i + 1}`,
        orderLineId: null,
        templateId: 'tmpl-mock-1',
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        plan: { templateId: 'tmpl-mock-1', configurationHash: 'hash-abc' },
      }));

      const result = await service.allocateAndLinkUnits({
        orderLineId: 'line-mock-10',
        candidateUnits,
      });

      assert.equal(result.newLinkedQuantity, 10);
      assert.equal(result.remainingQuantity, 0);
      assert.equal(result.excessQuantity, 0);
      assert.equal(result.hasQuantityViolation, false);
    });

    // Case 2: Requested: 10, Linked: 0, Attempting to add: 11 -> Reject
    it('12. Case 2 (10 requested, 0 linked, adding 11) -> Rejected with PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 0,
      });

      const candidateUnits: CandidateUnitLike[] = Array.from({ length: 11 }, (_, i) => ({
        id: `cand-${i + 1}`,
        orderLineId: null,
        templateId: 'tmpl-mock-1',
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        plan: { templateId: 'tmpl-mock-1', configurationHash: 'hash-abc' },
      }));

      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            candidateUnits,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });

    // Case 3: Requested: 10, Linked: 7, Attempting to add: 3 -> Accept
    it('13. Case 3 (10 requested, 7 linked, adding 3) -> Accepted and reaches 10', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 7,
      });

      const candidateUnits: CandidateUnitLike[] = Array.from({ length: 3 }, (_, i) => ({
        id: `cand-${i + 1}`,
        orderLineId: null,
        templateId: 'tmpl-mock-1',
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        plan: { templateId: 'tmpl-mock-1', configurationHash: 'hash-abc' },
      }));

      const result = await service.allocateAndLinkUnits({
        orderLineId: 'line-mock-10',
        candidateUnits,
      });

      assert.equal(result.previousLinkedQuantity, 7);
      assert.equal(result.newLinkedQuantity, 10);
      assert.equal(result.remainingQuantity, 0);
      assert.equal(result.excessQuantity, 0);
      assert.equal(result.hasQuantityViolation, false);
    });

    // Case 4: Requested: 10, Linked: 7, Attempting to add: 4 -> Reject
    it('14. Case 4 (10 requested, 7 linked, adding 4) -> Rejected with PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 7,
      });

      const candidateUnits: CandidateUnitLike[] = Array.from({ length: 4 }, (_, i) => ({
        id: `cand-${i + 1}`,
        orderLineId: null,
        templateId: 'tmpl-mock-1',
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        plan: { templateId: 'tmpl-mock-1', configurationHash: 'hash-abc' },
      }));

      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            candidateUnits,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });

    // Case 5: Requested: 10, Linked: 10, Attempting to add: 1 -> Reject
    it('15. Case 5 (10 requested, 10 linked, adding 1) -> Rejected because remaining is 0', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 10,
      });

      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            quantityToReserveOnly: 1,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });

    // Case 6: Requested: 10, Linked: 12 historically, Attempting to add: 1 -> Reject with over-allocation detected
    it('16. Case 6 (10 requested, 12 linked historically, adding 1) -> Rejected and detects excess = 2', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 12,
      });

      // Status check detects excess
      const status = await service.getLineAllocationStatus('line-mock-10');
      assert.equal(status.quantities.requestedQuantity, 10);
      assert.equal(status.quantities.linkedQuantity, 12);
      assert.equal(status.quantities.remainingQuantity, 0);
      assert.equal(status.quantities.excessQuantity, 2);
      assert.equal(status.quantities.hasQuantityViolation, true);

      // Attempting to add even 1 unit fails closed
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            quantityToReserveOnly: 1,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });

    it('17. Line Isolation: Units belonging to another line (otherLineUnits) are NOT counted towards this line', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 3,
        otherLineUnits: 5, // Belong to line 20
      });

      const status = await service.getLineAllocationStatus('line-mock-10');
      assert.equal(status.quantities.linkedQuantity, 3, 'Must count only units belonging to line 10');
      assert.equal(status.quantities.remainingQuantity, 7);
    });

    it('18. Cancelled Units Policy: Cancelled units are excluded from active linked quantity', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 4,
        cancelledUnits: 3, // Cancelled units on this line
      });

      const status = await service.getLineAllocationStatus('line-mock-10');
      assert.equal(status.quantities.linkedQuantity, 4, 'Must exclude cancelled units');
      assert.equal(status.quantities.remainingQuantity, 6);
    });

    it('19. Duplicate unit IDs in link request -> Rejected with PRODUCTION_UNIT_DUPLICATE_IN_REQUEST', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 0,
      });

      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            candidateUnitIds: ['dup-1', 'dup-1'],
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_DUPLICATE_IN_REQUEST');
          return true;
        }
      );
    });

    it('20. Order not in APPROVED status -> Rejected with PRODUCTION_ORDER_NOT_APPROVED', async () => {
      const { service } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.DRAFT,
        activeUnits: 0,
      });

      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: 'line-mock-10',
            quantityToReserveOnly: 1,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_NOT_APPROVED');
          return true;
        }
      );
    });

    it('21. restoreCancelledUnit: succeeds when line has vacancy (9/10), but fails closed when line is full (10/10)', async () => {
      const { service, unitsInDb } = createMockAllocationContext({
        lineQuantity: 10,
        orderStatus: ProductionOrderStatus.APPROVED,
        activeUnits: 9,
        cancelledUnits: 2,
      });

      const cancelledUnit1 = unitsInDb.find((u) => u.id === 'unit-cancelled-1')!;
      const cancelledUnit2 = unitsInDb.find((u) => u.id === 'unit-cancelled-2')!;

      // Restore first cancelled unit: 9 active + 1 = 10 -> Allowed
      const res1 = await service.restoreCancelledUnit({
        orderLineId: 'line-mock-10',
        unitId: cancelledUnit1.id,
      });
      assert.equal(res1.isCancelled, false);
      assert.equal(res1.newLinkedQuantity, 10);
      assert.equal(res1.remainingQuantity, 0);

      // Now line has 10 active units. Attempting to restore second cancelled unit -> Must fail closed
      await assert.rejects(
        async () => {
          await service.restoreCancelledUnit({
            orderLineId: 'line-mock-10',
            unitId: cancelledUnit2.id,
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_RESTORE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });
  });
});
