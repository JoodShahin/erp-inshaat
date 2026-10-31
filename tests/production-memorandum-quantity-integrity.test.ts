import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  calculateLineQuantities,
} from '../src/modules/production/order-line/production-order-line-quantity.helper.js';
import {
  ProductionOrderLineAllocationService,
  CandidateUnitLike,
  InternalSystemContext,
} from '../src/modules/production/order-line/production-order-line-allocation.service.js';
import { ProductionOrderStatus } from '../src/modules/production/order/production-order.entity.js';
import { ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { hashLineConfiguration } from '../src/modules/production/order-line/production-order-line-configuration.helper.js';
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
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
      assert.equal(q.requestedQuantity, 0);
      assert.equal(q.linkedQuantity, 0);
      assert.equal(q.remainingQuantity, 0);
      assert.equal(q.excessQuantity, 0);
      assert.equal(q.hasQuantityViolation, false);
    });
  });

  // ==========================================
  // 2. Compatibility Verification (verifyCandidateUnitCompatibility)
  // ==========================================
  describe('2. Compatibility Verification (verifyCandidateUnitCompatibility)', () => {
    const service = new ProductionOrderLineAllocationService({} as any, {} as any, {} as any, {} as any);

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

    const validCandidateUnit: CandidateUnitLike = {
      id: 'unit-valid-1',
      orderLineId: null,
      orderId: null,
      templateId: tmplId,
      isCancelled: false,
      status: ProductionUnitStatus.CREATED,
      plan: {
        templateId: tmplId,
        configurationHash: hashStandard,
        patternSummary: [
          { patternId: patternA, optionId: optSteel },
        ],
        specifications: [
          { name: 'Thickness', value: '25cm', unit: null, sortOrder: 1 },
          { name: 'ConcreteGrade', value: 'C35', unit: null, sortOrder: 2 },
        ],
      },
    };

    it('5. Valid candidate unit matching template, pattern, and specs succeeds', () => {
      assert.doesNotThrow(() => {
        service.verifyCandidateUnitCompatibility(
          mockLine,
          validCandidateUnit,
          mockLine.template.specifications
        );
      });
    });

    it('6. Rejects cancelled or archived room with PRODUCTION_UNIT_CANCELLED', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            { ...validCandidateUnit, isCancelled: true },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_CANCELLED');
          return true;
        }
      );
    });

    it('7. Rejects already linked room to another line with PRODUCTION_UNIT_ALREADY_LINKED', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            { ...validCandidateUnit, orderLineId: 'other-line-99' },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_ALREADY_LINKED');
          return true;
        }
      );
    });

    it('8. Rejects re-linking a room already linked to THIS line with PRODUCTION_UNIT_ALREADY_LINKED', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            { ...validCandidateUnit, orderLineId: mockLine.id },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_ALREADY_LINKED');
          return true;
        }
      );
    });

    it('9. Rejects template mismatch with PRODUCTION_UNIT_TEMPLATE_MISMATCH', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              templateId: 'different-template-id',
              plan: {
                ...validCandidateUnit.plan!,
                templateId: 'different-template-id',
              },
            },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_TEMPLATE_MISMATCH');
          return true;
        }
      );
    });

    it('10. Rejects missing template identity with PRODUCTION_UNIT_TEMPLATE_MISSING', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              templateId: null,
              plan: null,
            },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_TEMPLATE_MISSING');
          return true;
        }
      );
    });

    it('11. Rejects pattern mismatch (wood door instead of steel door) with PRODUCTION_UNIT_PATTERN_MISMATCH', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              plan: {
                ...validCandidateUnit.plan!,
                configurationHash: hashWood,
              },
            },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_PATTERN_MISMATCH');
          return true;
        }
      );
    });

    it('12. Rejects candidate unit missing pattern data when line requires patterns with PRODUCTION_UNIT_PATTERN_DATA_MISSING', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              plan: {
                ...validCandidateUnit.plan!,
                configurationHash: null,
                patternSummary: null,
              },
            },
            mockLine.template.specifications
          );
        },
        (err: any) => {
          assert.ok(err instanceof BusinessRuleError);
          assert.equal(err.code, 'PRODUCTION_UNIT_PATTERN_DATA_MISSING');
          return true;
        }
      );
    });

    it('13. Rejects missing mandatory specifications snapshot with PRODUCTION_UNIT_SPECIFICATION_DATA_MISSING', () => {
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              plan: {
                ...validCandidateUnit.plan!,
                specifications: null,
              },
            },
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
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              plan: {
                ...validCandidateUnit.plan!,
                specifications: [
                  { name: 'Thickness', value: '20cm', unit: null, sortOrder: 1 },
                  { name: 'ConcreteGrade', value: 'C35', unit: null, sortOrder: 2 },
                ],
              },
            },
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
      assert.throws(
        () => {
          service.verifyCandidateUnitCompatibility(
            mockLine,
            {
              ...validCandidateUnit,
              plan: {
                ...validCandidateUnit.plan!,
                specifications: [
                  { name: 'Thickness', value: '25cm', unit: null, sortOrder: 1 },
                  // ConcreteGrade missing
                ],
              },
            },
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
  // 3. Authorization & Access Scoping Invariants
  // ==========================================
  describe('3. Authorization & Access Scoping Invariants', () => {
    function makePrincipal(userId = 'usr-1', roleCode = 'PRODUCTION_MANAGER', perms = [SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS]) {
      return {
        id: userId,
        fullName: 'Test User',
        phone: '123456',
        roleId: 'role-1',
        roleCode,
        permissions: perms,
        sessionId: 'sess-1',
      };
    }

    function createAuthMockService(userRules: any[] = [{ scopeType: 'ALL', effect: 'ALLOW', scope: null }]) {
      const lineId = 'line-auth-1';
      const orderId = 'order-auth-1';
      const tmplId = 'tmpl-auth-1';

      const mockLine: any = {
        id: lineId,
        orderId,
        templateId: tmplId,
        quantity: 10,
        sortOrder: 1,
        activeConfigurationHash: 'hash-auth',
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

      const mockCancelledUnit = {
        id: 'unit-cancel-1',
        orderId,
        orderLineId: lineId,
        templateId: tmplId,
        currentYardId: 'yard-allowed-1',
        status: ProductionUnitStatus.CANCELLED,
        isCancelled: true,
        deletedAt: null,
      };

      const mockDataSource: any = {
        getRepository: (entity: any) => {
          return {
            findOne: async (opts: any) => {
              if (opts?.where?.id === lineId) return mockLine;
              if (opts?.where?.id === orderId) return mockLine.order;
              if (opts?.where?.id === tmplId) return { id: tmplId, specifications: [] };
              if (opts?.where?.id === 'unit-cancel-1') return mockCancelledUnit;
              return null;
            },
            count: async () => 0,
            save: async (u: any) => u,
            create: (e: any) => e,
            find: async (opts: any) => {
              const all = [mockUnit, mockUnitDeniedYard, mockCancelledUnit];
              if (opts?.where?.id) {
                const targetIds = opts.where.id._value || opts.where.id.value || (Array.isArray(opts.where.id) ? opts.where.id : [opts.where.id]);
                return all.filter((u: any) => targetIds.includes(u.id));
              }
              return all;
            },
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
                  if (opts?.where?.id === 'unit-cancel-1') return mockCancelledUnit;
                  const all = [mockUnit, mockUnitDeniedYard, mockCancelledUnit];
                  const found = all.find((u: any) => u.id === opts?.where?.id);
                  if (found) return found;
                  return null;
                },
                count: async () => 0,
                save: async (u: any) => u,
                create: (e: any) => e,
                find: async (opts: any) => {
                  const all = [mockUnit, mockUnitDeniedYard, mockCancelledUnit];
                  if (opts?.where?.id) {
                    const targetIds = opts.where.id._value || opts.where.id.value || (Array.isArray(opts.where.id) ? opts.where.id : [opts.where.id]);
                    return all.filter((u: any) => targetIds.includes(u.id));
                  }
                  return all;
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
        resolvePolicy: (_rules: any, _resp: any, perm: string) => {
          if (perm !== SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS) {
            return { allowAll: false, denyAll: true, hasAnyAccess: false };
          }
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

    it('20. Rejects forged context object with isInternalTrusted: true with AUTHENTICATION_INVALID', async () => {
      const { service, lineId } = createAuthMockService();
      await assert.rejects(
        async () => {
          await service.allocateAndLinkUnits({
            orderLineId: lineId,
            candidateUnitIds: ['unit-auth-1'],
            currentUser: { isInternalTrusted: true, operatorUserId: 'hacker' } as any,
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHENTICATION_INVALID');
          return true;
        }
      );
    });

    it('21. Accepts unforgeable InternalSystemContext.create() for trusted internal operations', async () => {
      const { service, lineId } = createAuthMockService([]);
      const trustedContext = InternalSystemContext.create('Nightly production allocation batch', 'system-scheduler');

      const res = await service.allocateAndLinkUnits({
        orderLineId: lineId,
        candidateUnitIds: ['unit-auth-1'],
        currentUser: trustedContext,
      });

      assert.equal(res.orderLineId, lineId);
      assert.deepEqual(res.linkedUnitIds, ['unit-auth-1']);
    });

    it('22. restoreCancelledUnit without authentication fails closed with AUTHENTICATION_REQUIRED', async () => {
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

    it('23. restoreCancelledUnit with insufficient permission fails closed with AUTHORIZATION_DENIED', async () => {
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

    it('24. restoreCancelledUnit with forged internal context fails with AUTHENTICATION_INVALID', async () => {
      const { service, lineId } = createAuthMockService();
      await assert.rejects(
        async () => {
          await service.restoreCancelledUnit({
            orderLineId: lineId,
            unitId: 'unit-cancel-1',
            currentUser: { isInternalTrusted: true } as any,
          });
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.code, 'AUTHENTICATION_INVALID');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 4. Phantom Path Elimination & Allocation Integrity
  // ==========================================
  describe('4. Phantom Path Elimination & Allocation Integrity', () => {
    function makePrincipal(userId = 'usr-mgr-1') {
      return {
        id: userId,
        fullName: 'Manager User',
        phone: '123456',
        roleId: 'role-mgr',
        roleCode: 'SYSTEM_ADMIN',
        permissions: [SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS],
        sessionId: 'sess-mgr',
      };
    }

    function createServiceWithMockDb(initialActiveCount = 0) {
      const lineId = 'line-int-1';
      const orderId = 'order-int-1';
      const tmplId = 'tmpl-integrity-1';

      const lineRow: any = {
        id: lineId,
        orderId,
        templateId: tmplId,
        quantity: 10,
        sortOrder: 1,
        activeConfigurationHash: 'hash-int',
      };

      const orderRow: any = {
        id: orderId,
        orderNumber: 'PO-INT',
        status: ProductionOrderStatus.APPROVED,
      };

      const unitsInDb: any[] = [];
      for (let i = 1; i <= initialActiveCount; i++) {
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
                const foundUnit = unitsInDb.find((u) => u.id === opts?.where?.id);
                if (foundUnit) return foundUnit;
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
              find: async (opts: any) => {
                if (opts?.where?.id) {
                  const targetIds = opts.where.id._value || opts.where.id.value || (Array.isArray(opts.where.id) ? opts.where.id : [opts.where.id]);
                  return unitsInDb.filter((u: any) => targetIds.includes(u.id));
                }
                return unitsInDb;
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

    it('25. Rejects phantom quantityToReserveOnly with RESERVATION_NOT_SUPPORTED', async () => {
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

    it('26. Rejects unsupported unitsToCreateCount with UNIT_CREATION_NOT_SUPPORTED', async () => {
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

    it('27. Rejects in-memory candidateUnits without real IDs with PRODUCTION_UNITS_REAL_IDS_REQUIRED', async () => {
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

    it('28. Rejects duplicate unit IDs in request with PRODUCTION_UNIT_DUPLICATE_IN_REQUEST', async () => {
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

    it('29. Quota check: rejects adding 4 units when line capacity remaining is only 3', async () => {
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

    it('30. Database Single Source of Truth: returned newLinkedQuantity matches exact database count', async () => {
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
