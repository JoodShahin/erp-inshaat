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
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
import { AuthPrincipal } from '../src/modules/system/auth/auth.types.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';
import { ForbiddenError } from '../src/common/errors/forbidden.error.js';

describe('Production Memorandum Quantity Integrity & Allocation Protection Test Suite', () => {
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

  // Helper principal creator
  function makePrincipal(id: string = 'user-1'): AuthPrincipal {
    return {
      id,
      sessionId: 'sess-1',
      username: 'eng_test',
      role: {
        id: 'role-1',
        name: 'Production Engineer',
        code: 'PRODUCTION_ENGINEER',
      },
    };
  }

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
  // 2. Compatibility Verification (Fail-Closed)
  // ==========================================
  describe('2. Compatibility Verification (verifyCandidateUnitCompatibility)', () => {
    const allocationService = new ProductionOrderLineAllocationService();

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

    it('7. Rejects already linked room to another line with PRODUCTION_UNIT_ALREADY_LINKED', () => {
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

    it('8. Rejects re-linking a room already linked to THIS line with PRODUCTION_UNIT_ALREADY_LINKED', () => {
      const alreadyLinkedCandidate: CandidateUnitLike = {
        id: 'unit-003-this',
        orderLineId: mockLine.id, // already on this line!
        orderId: mockLine.orderId,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: { templateId: tmplId, configurationHash: hashStandard },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, alreadyLinkedCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_ALREADY_LINKED');
          return true;
        }
      );
    });

    it('9. Rejects template mismatch with PRODUCTION_UNIT_TEMPLATE_MISMATCH', () => {
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

    it('10. Rejects missing template identity with PRODUCTION_UNIT_TEMPLATE_MISSING', () => {
      const missingTemplateCandidate: CandidateUnitLike = {
        id: 'unit-004-missing',
        orderLineId: null,
        templateId: null,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: null,
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, missingTemplateCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_TEMPLATE_MISSING');
          return true;
        }
      );
    });

    it('11. Rejects pattern mismatch (wood door instead of steel door) with PRODUCTION_UNIT_PATTERN_MISMATCH', () => {
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

    it('12. Rejects candidate unit missing pattern data when line requires patterns with PRODUCTION_UNIT_PATTERN_DATA_MISSING', () => {
      const noPatternCandidate: CandidateUnitLike = {
        id: 'unit-005-nodata',
        orderLineId: null,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: {
          templateId: tmplId,
          configurationHash: null,
          patternSummary: null,
        },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(mockLine, noPatternCandidate);
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_PATTERN_DATA_MISSING');
          return true;
        }
      );
    });

    it('13. Rejects missing mandatory specifications snapshot with PRODUCTION_UNIT_SPECIFICATION_DATA_MISSING', () => {
      const noSpecCandidate: CandidateUnitLike = {
        id: 'unit-006-nospec',
        orderLineId: null,
        templateId: tmplId,
        isCancelled: false,
        status: ProductionUnitStatus.CREATED,
        deletedAt: null,
        plan: {
          templateId: tmplId,
          configurationHash: hashStandard,
          specifications: null, // missing snapshot!
        },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(
            mockLine,
            noSpecCandidate,
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_SPECIFICATION_DATA_MISSING');
          return true;
        }
      );
    });

    it('14. Rejects specification mismatch (20cm thickness instead of 25cm) with PRODUCTION_UNIT_SPECIFICATION_MISMATCH', () => {
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

    it('15. Rejects candidate unit missing an individual mandatory specification with PRODUCTION_UNIT_SPECIFICATION_MISMATCH', () => {
      const missingOneSpecCandidate: CandidateUnitLike = {
        id: 'unit-006-missing-one',
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
            { name: 'Thickness', value: '25cm', unit: 'cm', sortOrder: 1 },
            // ConcreteGrade is missing!
          ],
        },
      };

      assert.throws(
        () => {
          allocationService.verifyCandidateUnitCompatibility(
            mockLine,
            missingOneSpecCandidate,
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
  // 3. Authorization & Access Scoping Tests
  // ==========================================
  describe('3. Authorization & Access Scoping Invariants', () => {
    function createAuthMockService(userRules: any[] = [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }]) {
      const lineId = 'line-auth-1';
      const orderId = 'order-auth-1';
      const tmplId = 'tmpl-auth-1';

      const mockLine = {
        id: lineId,
        orderId,
        templateId: tmplId,
        quantity: 10,
        sortOrder: 1,
        activeConfigurationHash: 'hash-auth',
        deletedAt: null,
        order: { id: orderId, orderNumber: 'PO-AUTH', status: ProductionOrderStatus.APPROVED },
      };

      const mockUnit = {
        id: 'unit-auth-1',
        orderId: null,
        orderLineId: null,
        templateId: tmplId,
        currentYardId: 'yard-allowed-1',
        currentYard: { id: 'yard-allowed-1', departmentId: 'dept-allowed-1' },
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
        deletedAt: null,
        plan: { templateId: tmplId, configurationHash: 'hash-auth', specifications: [] },
      };

      const mockUnitDeniedYard = {
        id: 'unit-auth-denied',
        orderId: null,
        orderLineId: null,
        templateId: tmplId,
        currentYardId: 'yard-denied-9',
        currentYard: { id: 'yard-denied-9', departmentId: 'dept-denied-9' },
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
        deletedAt: null,
        plan: { templateId: tmplId, configurationHash: 'hash-auth', specifications: [] },
      };

      const mockDataSource: any = {
        getRepository: (entity: any) => {
          return {
            findOne: async (opts: any) => {
              if (opts?.where?.id === lineId) return mockLine;
              if (opts?.where?.id === orderId) return mockLine.order;
              if (opts?.where?.id === tmplId) return { id: tmplId, specifications: [] };
              return null;
            },
            count: async () => 0,
            save: async (u: any) => u,
            create: (e: any) => e,
          };
        },
        transaction: async (cb: any) => {
          const em: any = {
            getRepository: (entity: any) => {
              return {
                findOne: async (opts: any) => {
                  if (opts?.where?.id === lineId) return mockLine;
                  if (opts?.where?.id === orderId) return mockLine.order;
                  if (opts?.where?.id === tmplId) return { id: tmplId, specifications: [] };
                  return null;
                },
                count: async () => 0,
                save: async (u: any) => u,
                create: (e: any) => e,
                createQueryBuilder: () => {
                  let queriedUnitIds: string[] = [];
                  return {
                    setLock: function () { return this; },
                    leftJoinAndSelect: function () { return this; },
                    where: function (sql: string, params: any) {
                      if (params?.candidateUnitIds) queriedUnitIds = params.candidateUnitIds;
                      else if (params?.unitIds) queriedUnitIds = params.unitIds;
                      return this;
                    },
                    andWhere: function () { return this; },
                    getMany: async () => {
                      const all = [mockUnit, mockUnitDeniedYard];
                      if (queriedUnitIds.length > 0) {
                        return all.filter((u) => queriedUnitIds.includes(u.id));
                      }
                      return all;
                    },
                  };
                },
              };
            },
          };
          return await cb(em);
        },
      };

      const mockAuthz: any = {
        getApplicableAccessRules: async (_user: any, perm: string) => {
          if (perm === SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS) {
            return userRules;
          }
          return [];
        },
      };

      const mockPolicy: any = {
        resolvePolicy: (_rules: any) => {
          const hasAllow = userRules.some((r) => r.effect === 'ALLOW');
          const hasDenyAll = userRules.some((r) => r.effect === 'DENY' && r.scopeType === 'ALL');
          const isScoped = userRules.some((r) => r.scopeType === 'PRODUCTION_YARD');

          return {
            allowAll: hasAllow && !isScoped && !hasDenyAll,
            denyAll: hasDenyAll || !hasAllow,
            hasAnyAccess: hasAllow && !hasDenyAll,
            allowDepartmentIds: ['dept-allowed-1'],
            denyDepartmentIds: [],
            allowYardIds: ['yard-allowed-1'],
            denyYardIds: ['yard-denied-9'],
          };
        },
      };

      const mockResolver: any = {
        resolve: async () => ({ isConsistent: true }),
      };

      const service = new ProductionOrderLineAllocationService(mockDataSource, mockAuthz, mockPolicy, mockResolver);
      return { service, lineId };
    }

    it('16. Rejects unauthenticated allocation call (no currentUser) with AUTHENTICATION_REQUIRED', async () => {
      const { service, lineId } = createAuthMockService();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-auth-1'],
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

    it('17. Rejects user with no write permissions (Default Deny) with AUTHORIZATION_DENIED', async () => {
      const { service, lineId } = createAuthMockService([]); // empty rules
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-auth-1'],
            currentUser: makePrincipal('user-no-perms'),
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHORIZATION_DENIED');
          return true;
        }
      );
    });

    it('18. Rejects user with explicit DENY ALL rule with AUTHORIZATION_DENIED', async () => {
      const { service, lineId } = createAuthMockService([
        { scopeType: 'ALL', effect: 'ALLOW', scope: null },
        { scopeType: 'ALL', effect: 'DENY', scope: null }, // DENY overrides ALLOW
      ]);
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-auth-1'],
            currentUser: makePrincipal('user-denied'),
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHORIZATION_DENIED');
          return true;
        }
      );
    });

    it('19. Rejects linking a candidate unit located in a yard outside the user scope with AUTHORIZATION_DENIED', async () => {
      const { service, lineId } = createAuthMockService([
        { scopeType: 'PRODUCTION_YARD', effect: 'ALLOW', scope: { yardIds: ['yard-allowed-1'] } },
      ]);
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-auth-denied'], // in yard-denied-9
            currentUser: makePrincipal('scoped-eng'),
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHORIZATION_DENIED');
          return true;
        }
      );
    });

    it('20. restoreCancelledUnit without authentication fails closed with AUTHENTICATION_REQUIRED', async () => {
      const { service, lineId } = createAuthMockService();
      await assert.rejects(
        async () => {
          await service.restoreCancelledUnit({
            orderLineId: lineId,
            unitId: 'unit-cancel-1',
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

    it('21. restoreCancelledUnit with insufficient permission fails closed with AUTHORIZATION_DENIED', async () => {
      const { service, lineId } = createAuthMockService([]);
      await assert.rejects(
        async () => {
          await service.restoreCancelledUnit({
            orderLineId: lineId,
            unitId: 'unit-cancel-1',
            currentUser: makePrincipal('unauth-user'),
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHORIZATION_DENIED');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 4. Phantom Paths & Allocation Integrity
  // ==========================================
  describe('4. Phantom Path Elimination & Allocation Integrity', () => {
    function createServiceWithMockDb(initialActiveUnits: number = 0) {
      const lineId = 'line-integrity-1';
      const orderId = 'order-integrity-1';
      const tmplId = 'tmpl-integrity-1';

      const lineRow = {
        id: lineId,
        orderId,
        templateId: tmplId,
        quantity: 10,
        sortOrder: 1,
        activeConfigurationHash: 'hash-int',
        deletedAt: null,
      };

      const orderRow = {
        id: orderId,
        orderNumber: 'PO-INT',
        status: ProductionOrderStatus.APPROVED,
        deletedAt: null,
      };

      const unitsInDb: any[] = [];
      for (let i = 1; i <= initialActiveUnits; i++) {
        unitsInDb.push({
          id: `unit-real-${i}`,
          orderId,
          orderLineId: lineId,
          templateId: tmplId,
          status: ProductionUnitStatus.CREATED,
          isCancelled: false,
          deletedAt: null,
          plan: { templateId: tmplId, configurationHash: 'hash-int', specifications: [] },
        });
      }

      const mockDataSource: any = {
        getRepository: () => ({
          findOne: async (opts: any) => {
            if (opts?.where?.id === lineId) return lineRow;
            return null;
          },
          count: async () => unitsInDb.filter((u) => u.orderLineId === lineId && !u.isCancelled && !u.deletedAt).length,
        }),
        transaction: async (cb: any) => {
          const em: any = {
            getRepository: (entity: any) => ({
              findOne: async (opts: any) => {
                if (opts?.where?.id === lineId) return lineRow;
                if (opts?.where?.id === orderId) return orderRow;
                if (opts?.where?.id === tmplId) return { id: tmplId, specifications: [] };
                return null;
              },
              count: async () => unitsInDb.filter((u) => u.orderLineId === lineId && !u.isCancelled && !u.deletedAt).length,
              save: async (u: any) => {
                const arr = Array.isArray(u) ? u : [u];
                for (const item of arr) {
                  const idx = unitsInDb.findIndex((x) => x.id === item.id);
                  if (idx >= 0) unitsInDb[idx] = item;
                  else unitsInDb.push(item);
                }
                return u;
              },
              create: (e: any) => e,
              createQueryBuilder: () => {
                let queriedUnitIds: string[] = [];
                return {
                  setLock: function () { return this; },
                  leftJoinAndSelect: function () { return this; },
                  where: function (sql: string, params: any) {
                    if (params?.candidateUnitIds) queriedUnitIds = params.candidateUnitIds;
                    else if (params?.unitIds) queriedUnitIds = params.unitIds;
                    return this;
                  },
                  andWhere: function () { return this; },
                  getMany: async () => {
                    if (queriedUnitIds.length > 0) {
                      return unitsInDb.filter((u) => queriedUnitIds.includes(u.id));
                    }
                    return unitsInDb;
                  },
                };
              },
            }),
          };
          return await cb(em);
        },
      };

      const mockAuthz: any = {
        getApplicableAccessRules: async () => [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }],
      };
      const mockPolicy: any = {
        resolvePolicy: () => ({ allowAll: true, denyAll: false, hasAnyAccess: true }),
      };
      const mockResolver: any = { resolve: async () => ({ isConsistent: true }) };

      const service = new ProductionOrderLineAllocationService(mockDataSource, mockAuthz, mockPolicy, mockResolver);
      return { service, lineId, unitsInDb };
    }

    it('22. Rejects phantom quantityToReserveOnly with RESERVATION_NOT_SUPPORTED', async () => {
      const { service, lineId } = createServiceWithMockDb();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-1'],
            quantityToReserveOnly: 2,
            currentUser: makePrincipal(),
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'RESERVATION_NOT_SUPPORTED');
          return true;
        }
      );
    });

    it('23. Rejects unsupported unitsToCreateCount with UNIT_CREATION_NOT_SUPPORTED', async () => {
      const { service, lineId } = createServiceWithMockDb();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-1'],
            unitsToCreateCount: 2,
            currentUser: makePrincipal(),
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'UNIT_CREATION_NOT_SUPPORTED');
          return true;
        }
      );
    });

    it('24. Rejects in-memory candidateUnits without real IDs with PRODUCTION_UNITS_REAL_IDS_REQUIRED', async () => {
      const { service, lineId } = createServiceWithMockDb();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: [],
            candidateUnits: [{ id: 'mock-cand', isCancelled: false, status: 'CREATED' }],
            currentUser: makePrincipal(),
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNITS_REAL_IDS_REQUIRED');
          return true;
        }
      );
    });

    it('25. Rejects duplicate unit IDs in request with PRODUCTION_UNIT_DUPLICATE_IN_REQUEST', async () => {
      const { service, lineId } = createServiceWithMockDb();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-dup-1', 'unit-dup-1'],
            currentUser: makePrincipal(),
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_DUPLICATE_IN_REQUEST');
          return true;
        }
      );
    });

    it('26. Quota check: rejects adding 4 units when line capacity remaining is only 3', async () => {
      const { service, lineId } = createServiceWithMockDb(7); // 7 active units out of 10
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['cand-1', 'cand-2', 'cand-3', 'cand-4'], // 4 > 3
            currentUser: makePrincipal(),
          });
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED');
          return true;
        }
      );
    });

    it('27. Database Single Source of Truth: returned newLinkedQuantity matches exact database count', async () => {
      const { service, lineId, unitsInDb } = createServiceWithMockDb(5);
      const newUnitId = 'unit-candidate-6';
      unitsInDb.push({
        id: newUnitId,
        orderId: null,
        orderLineId: null,
        templateId: 'tmpl-integrity-1',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
        deletedAt: null,
        plan: { templateId: 'tmpl-integrity-1', configurationHash: 'hash-int', specifications: [] },
      });

      const res = await service.allocateAndLinkUnits({
        orderLineId: lineId,
        candidateUnitIds: [newUnitId],
        currentUser: makePrincipal(),
      });

      assert.equal(res.previousLinkedQuantity, 5);
      assert.equal(res.newLinkedQuantity, 6);
      assert.equal(res.remainingQuantity, 4);
      assert.deepEqual(res.linkedUnitIds, [newUnitId]);
    });
  });
});
