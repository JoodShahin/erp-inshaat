import 'reflect-metadata';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SystemPermission } from '../src/modules/system/permission/constants/system-permission.enum.js';
import { SYSTEM_PERMISSION_DEFINITIONS } from '../src/modules/system/permission/constants/system-permission.registry.js';
import { PERMISSION_SCOPE_CAPABILITIES } from '../src/modules/system/authorization/access-administration/access-scope-capability.registry.js';
import { AssignTemplatesToYardDto } from '../src/modules/production/yard-template/dto/assign-templates-to-yard.dto.js';
import { ProductionYardTemplateService } from '../src/modules/production/yard-template/production-yard-template.service.js';
import { ProductionYardTemplateEntity } from '../src/modules/production/yard-template/production-yard-template.entity.js';
import { ProductionYardEntity } from '../src/modules/production/yard/production-yard.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ResolvedProductionAccessPolicy } from '../src/modules/production/authorization/production-access-policy.types.js';
import { canAccessYard } from '../src/modules/production/authorization/production-access-query.helper.js';
import { databaseConfig } from '../src/config/database.config.js';

// --- In-Memory Mocking Setup ---

interface MockStore {
  yards: Map<string, ProductionYardEntity>;
  templates: Map<string, ProductionTemplateEntity>;
  yardTemplates: Map<string, ProductionYardTemplateEntity>;
}

function createMockStore(): MockStore {
  return {
    yards: new Map(),
    templates: new Map(),
    yardTemplates: new Map(),
  };
}

function buildMockDataSource(store: MockStore) {
  const yardRepo = {
    findOne: async (options: any) => {
      const id = options?.where?.id;
      const yard = store.yards.get(id);
      if (!yard || yard.deletedAt !== null) return null;
      return yard;
    },
  };

  const templateRepo = {
    find: async (options: any) => {
      const ids: string[] = options?.where?.id?._value || options?.where?.id || [];
      const results: ProductionTemplateEntity[] = [];
      for (const id of ids) {
        const tmpl = store.templates.get(id);
        if (tmpl && tmpl.deletedAt === null) {
          results.push(tmpl);
        }
      }
      return results;
    },
    createQueryBuilder: () => {
      let searchTerm: string | null = null;
      const qb: any = {
        where: () => qb,
        andWhere: (condition: string, params?: any) => {
          if (params?.term) {
            searchTerm = params.term.replace(/%/g, '').toLowerCase();
          }
          return qb;
        },
        orderBy: () => qb,
        getMany: async () => {
          const list: ProductionTemplateEntity[] = [];
          for (const tmpl of store.templates.values()) {
            if (tmpl.deletedAt === null && tmpl.isActive) {
              if (
                !searchTerm ||
                tmpl.name.toLowerCase().includes(searchTerm) ||
                tmpl.code.toLowerCase().includes(searchTerm)
              ) {
                list.push(tmpl);
              }
            }
          }
          return list;
        },
      };
      return qb;
    },
  };

  const yardTemplateRepo = {
    find: async (options: any) => {
      const yardId = options?.where?.yardId;
      const templateIds = options?.where?.templateId?._value || options?.where?.templateId;
      const results: ProductionYardTemplateEntity[] = [];

      for (const yt of store.yardTemplates.values()) {
        if (yt.yardId === yardId) {
          if (templateIds && Array.isArray(templateIds)) {
            if (templateIds.includes(yt.templateId)) {
              results.push(yt);
            }
          } else if (templateIds) {
            if (yt.templateId === templateIds) {
              results.push(yt);
            }
          } else {
            results.push(yt);
          }
        }
      }
      return results;
    },
    findOne: async (options: any) => {
      const yardId = options?.where?.yardId;
      const templateId = options?.where?.templateId;
      for (const yt of store.yardTemplates.values()) {
        if (yt.yardId === yardId && yt.templateId === templateId) {
          return yt;
        }
      }
      return null;
    },
    create: (data: Partial<ProductionYardTemplateEntity>) => {
      const entity = new ProductionYardTemplateEntity();
      Object.assign(entity, data);
      entity.id = 'yt-' + Math.random().toString(36).substring(2, 9);
      entity.createdAt = new Date();
      entity.updatedAt = new Date();
      return entity;
    },
    save: async (entities: ProductionYardTemplateEntity[]) => {
      for (const entity of entities) {
        store.yardTemplates.set(entity.id, entity);
      }
      return entities;
    },
    delete: async (criteria: { id: string }) => {
      store.yardTemplates.delete(criteria.id);
      return { raw: [], affected: 1 };
    },
    createQueryBuilder: () => {
      let targetYardId: string | null = null;
      let targetIds: string[] | null = null;

      const qb: any = {
        leftJoinAndSelect: () => qb,
        where: (condition: string, params?: any) => {
          if (params?.yardId) targetYardId = params.yardId;
          if (params?.ids) targetIds = params.ids;
          return qb;
        },
        andWhere: () => qb,
        orderBy: () => qb,
        getMany: async () => {
          const list: ProductionYardTemplateEntity[] = [];
          for (const yt of store.yardTemplates.values()) {
            if (targetYardId && yt.yardId !== targetYardId) continue;
            if (targetIds && !targetIds.includes(yt.id)) continue;
            yt.template = store.templates.get(yt.templateId);
            list.push(yt);
          }
          return list;
        },
      };
      return qb;
    },
  };

  const dataSourceMock: any = {
    getRepository: (entityClass: any) => {
      if (entityClass === ProductionYardEntity) return yardRepo;
      if (entityClass === ProductionTemplateEntity) return templateRepo;
      if (entityClass === ProductionYardTemplateEntity) return yardTemplateRepo;
      throw new Error('Unknown entity class in mock');
    },
    transaction: async (cb: (manager: any) => Promise<any>) => {
      const managerMock = {
        getRepository: (entityClass: any) => dataSourceMock.getRepository(entityClass),
      };
      return await cb(managerMock);
    },
  };

  return { dataSourceMock, yardRepo, templateRepo, yardTemplateRepo };
}

function createPolicy(overrides: Partial<ResolvedProductionAccessPolicy> = {}): ResolvedProductionAccessPolicy {
  return {
    denyAll: false,
    allowAll: false,
    allowDepartmentIds: [],
    denyDepartmentIds: [],
    allowYardIds: [],
    denyYardIds: [],
    hasAnyAccess: true,
    ...overrides,
  };
}

describe('Yard–Template Management & Fine-Grained Permissions Test Suite', () => {
  let store: MockStore;
  let service: ProductionYardTemplateService;

  beforeEach(() => {
    store = createMockStore();
    const { dataSourceMock, yardTemplateRepo, yardRepo, templateRepo } = buildMockDataSource(store);
    service = new ProductionYardTemplateService(
      dataSourceMock,
      yardTemplateRepo as any,
      yardRepo as any,
      templateRepo as any
    );
  });

  // ==========================================
  // 1. PERMISSION SYSTEM & REGISTRY VERIFICATION
  // ==========================================
  describe('1. Permission Enum, Definitions & Capabilities Registry', () => {
    it('defines all 4 fine-grained yard-template permissions in SystemPermission enum', () => {
      assert.equal(SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW, 'production.yard-templates.view');
      assert.equal(SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD, 'production.yard-templates.add');
      assert.equal(SystemPermission.PRODUCTION_YARD_TEMPLATE_UPDATE, 'production.yard-templates.update');
      assert.equal(SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE, 'production.yard-templates.remove');
    });

    it('registers all 4 permissions in SYSTEM_PERMISSION_DEFINITIONS', () => {
      const perms = [
        SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_UPDATE,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE,
      ];

      for (const perm of perms) {
        const def = SYSTEM_PERMISSION_DEFINITIONS[perm];
        assert.ok(def, `Permission ${perm} should have a definition`);
        assert.equal(def.name, perm);
        assert.equal(def.module, 'production');
        assert.ok(def.description.length > 0);
      }
    });

    it('registers presets capability in PERMISSION_SCOPE_CAPABILITIES for all 4 permissions', () => {
      const perms = [
        SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_UPDATE,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE,
      ];

      for (const perm of perms) {
        const presets = PERMISSION_SCOPE_CAPABILITIES[perm];
        assert.ok(Array.isArray(presets), `Permission ${perm} should be registered in PERMISSION_SCOPE_CAPABILITIES`);
        assert.ok(presets.includes('ALL' as any));
        assert.ok(presets.includes('CURRENT_PRODUCTION_DEPARTMENT' as any));
        assert.ok(presets.includes('CURRENT_PRODUCTION_YARDS' as any));
        assert.ok(presets.includes('SPECIFIC_PRODUCTION_DEPARTMENTS' as any));
        assert.ok(presets.includes('SPECIFIC_PRODUCTION_YARDS' as any));
      }
    });

    it('ensures migration 21 is registered in databaseConfig.migrations', () => {
      const migrationNames = databaseConfig.migrations.map((m: any) =>
        typeof m === 'function' ? m.name : m
      );
      assert.ok(
        migrationNames.includes('CreateProductionYardTemplate1710000000021'),
        'CreateProductionYardTemplate1710000000021 should be in databaseConfig.migrations'
      );
    });
  });

  // ==========================================
  // 2. DTO VALIDATION
  // ==========================================
  describe('2. AssignTemplatesToYardDto Validation Contracts', () => {
    it('accepts single valid UUID in templateId', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {
        templateId: 'c061212f-4094-4af2-877a-fa0829e53da5',
      });
      const errors = await validate(dto);
      assert.equal(errors.length, 0);
    });

    it('accepts array of valid UUIDs in templateIds', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {
        templateIds: [
          'c061212f-4094-4af2-877a-fa0829e53da5',
          'd061212f-4094-4af2-877a-fa0829e53da6',
        ],
      });
      const errors = await validate(dto);
      assert.equal(errors.length, 0);
    });

    it('rejects empty payload when neither templateId nor templateIds is provided', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {});
      const errors = await validate(dto);
      assert.ok(errors.length > 0);
    });

    it('rejects invalid UUID in templateId', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {
        templateId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'templateId'));
    });

    it('rejects non-UUID items inside templateIds array', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {
        templateIds: ['c061212f-4094-4af2-877a-fa0829e53da5', 'invalid-uuid'],
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'templateIds'));
    });

    it('rejects empty array for templateIds', async () => {
      const dto = plainToInstance(AssignTemplatesToYardDto, {
        templateIds: [],
      });
      const errors = await validate(dto);
      assert.ok(errors.length > 0);
    });
  });

  // ==========================================
  // 3. ROW-LEVEL ACCESS SCOPE HELPER EVALUATION
  // ==========================================
  describe('3. canAccessYard Access Helper Scoping & IDOR Defense', () => {
    const yardA = { id: 'yard-a', departmentId: 'dept-1' };
    const yardB = { id: 'yard-b', departmentId: 'dept-2' };

    it('Default Deny: rejects when policy has denyAll = true', () => {
      const policy = createPolicy({ denyAll: true, allowAll: true });
      assert.equal(canAccessYard(policy, yardA), false);
    });

    it('ALLOW ALL: grants access when allowAll = true without department/yard denies', () => {
      const policy = createPolicy({ allowAll: true });
      assert.equal(canAccessYard(policy, yardA), true);
      assert.equal(canAccessYard(policy, yardB), true);
    });

    it('Department Scoping: grants access only to yards in allowed department', () => {
      const policy = createPolicy({ allowDepartmentIds: ['dept-1'] });
      assert.equal(canAccessYard(policy, yardA), true);
      assert.equal(canAccessYard(policy, yardB), false); // IDOR prevented
    });

    it('Yard Scoping: grants access specifically to allowed yard', () => {
      const policy = createPolicy({ allowYardIds: ['yard-a'] });
      assert.equal(canAccessYard(policy, yardA), true);
      assert.equal(canAccessYard(policy, yardB), false);
    });

    it('DENY overrides ALLOW: explicit yard deny blocks access even with allowAll', () => {
      const policy = createPolicy({ allowAll: true, denyYardIds: ['yard-a'] });
      assert.equal(canAccessYard(policy, yardA), false);
      assert.equal(canAccessYard(policy, yardB), true);
    });

    it('DENY overrides ALLOW: explicit department deny blocks all yards in that department', () => {
      const policy = createPolicy({ allowAll: true, denyDepartmentIds: ['dept-1'] });
      assert.equal(canAccessYard(policy, yardA), false);
      assert.equal(canAccessYard(policy, yardB), true);
    });
  });

  // ==========================================
  // 4. SERVICE OPERATIONS & BUSINESS INVARIANTS
  // ==========================================
  describe('4. ProductionYardTemplateService Business Invariants', () => {
    beforeEach(() => {
      // Seed yard A (active) and yard B (inactive)
      const yardA = new ProductionYardEntity();
      yardA.id = 'yard-1';
      yardA.name = 'ساحة الصب الأولى';
      yardA.code = 'YARD-01';
      yardA.departmentId = 'dept-casting';
      yardA.capacity = 20;
      yardA.isActive = true;
      yardA.deletedAt = null;
      store.yards.set(yardA.id, yardA);

      const yardInactive = new ProductionYardEntity();
      yardInactive.id = 'yard-inactive';
      yardInactive.name = 'ساحة معطلة';
      yardInactive.code = 'YARD-INACT';
      yardInactive.departmentId = 'dept-casting';
      yardInactive.capacity = 10;
      yardInactive.isActive = false;
      yardInactive.deletedAt = null;
      store.yards.set(yardInactive.id, yardInactive);

      // Seed templates: tmpl1 (active), tmpl2 (active), tmplInactive (inactive)
      const tmpl1 = new ProductionTemplateEntity();
      tmpl1.id = 'tmpl-1';
      tmpl1.name = 'قالب عمود 40x40';
      tmpl1.code = 'TMPL-COL-40';
      tmpl1.isActive = true;
      tmpl1.deletedAt = null;
      store.templates.set(tmpl1.id, tmpl1);

      const tmpl2 = new ProductionTemplateEntity();
      tmpl2.id = 'tmpl-2';
      tmpl2.name = 'قالب كمرة خرسانية';
      tmpl2.code = 'TMPL-BEAM-01';
      tmpl2.isActive = true;
      tmpl2.deletedAt = null;
      store.templates.set(tmpl2.id, tmpl2);

      const tmplInactive = new ProductionTemplateEntity();
      tmplInactive.id = 'tmpl-inact';
      tmplInactive.name = 'قالب قديم معطل';
      tmplInactive.code = 'TMPL-OLD-01';
      tmplInactive.isActive = false;
      tmplInactive.deletedAt = null;
      store.templates.set(tmplInactive.id, tmplInactive);
    });

    it('Scenario 1: Many-to-Many - assigns multiple templates to a yard and single template to multiple yards', async () => {
      const yard2 = new ProductionYardEntity();
      yard2.id = 'yard-2';
      yard2.name = 'ساحة التخزين';
      yard2.code = 'YARD-02';
      yard2.departmentId = 'dept-casting';
      yard2.capacity = 15;
      yard2.isActive = true;
      yard2.deletedAt = null;
      store.yards.set(yard2.id, yard2);

      const policy = createPolicy({ allowAll: true });

      // Link tmpl-1 and tmpl-2 to yard-1
      const res1 = await service.addTemplatesToYard('yard-1', ['tmpl-1', 'tmpl-2'], policy, 'user-admin');
      assert.equal(res1.length, 2);

      // Link tmpl-1 to yard-2 as well (Many-to-Many verified!)
      const res2 = await service.addTemplatesToYard('yard-2', ['tmpl-1'], policy, 'user-admin');
      assert.equal(res2.length, 1);
      assert.equal(res2[0].templateId, 'tmpl-1');

      // Verify yard-1 has 2 templates
      const yard1Templates = await service.listYardTemplates('yard-1', policy);
      assert.equal(yard1Templates.length, 2);

      // Verify yard-2 has 1 template
      const yard2Templates = await service.listYardTemplates('yard-2', policy);
      assert.equal(yard2Templates.length, 1);
    });

    it('Scenario 2 & 3: listYardTemplates enforces access scope (IDOR rejection with ACCESS_SCOPE_DENIED)', async () => {
      const allowedPolicy = createPolicy({ allowYardIds: ['yard-1'] });
      const deniedPolicy = createPolicy({ allowYardIds: ['other-yard'] });

      // Allowed viewer can access
      const list = await service.listYardTemplates('yard-1', allowedPolicy);
      assert.equal(Array.isArray(list), true);

      // Out-of-scope viewer is rejected with ForbiddenError
      await assert.rejects(
        () => service.listYardTemplates('yard-1', deniedPolicy),
        (err: any) => err.code === 'ACCESS_SCOPE_DENIED'
      );
    });

    it('Scenario 4 & 5: addTemplatesToYard enforces access scope', async () => {
      const deniedPolicy = createPolicy({ allowYardIds: ['other-yard'] });

      await assert.rejects(
        () => service.addTemplatesToYard('yard-1', ['tmpl-1'], deniedPolicy),
        (err: any) => err.code === 'ACCESS_SCOPE_DENIED'
      );
    });

    it('Scenario 6 & 7: removeTemplateFromYard enforces access scope', async () => {
      const allowedPolicy = createPolicy({ allowAll: true });
      await service.addTemplatesToYard('yard-1', ['tmpl-1'], allowedPolicy);

      const deniedPolicy = createPolicy({ allowYardIds: ['other-yard'] });
      await assert.rejects(
        () => service.removeTemplateFromYard('yard-1', 'tmpl-1', deniedPolicy),
        (err: any) => err.code === 'ACCESS_SCOPE_DENIED'
      );
    });

    it('Scenario 8: rejects duplicate template assignment with ConflictError', async () => {
      const policy = createPolicy({ allowAll: true });
      await service.addTemplatesToYard('yard-1', ['tmpl-1'], policy);

      // Attempt to link tmpl-1 again to yard-1
      await assert.rejects(
        () => service.addTemplatesToYard('yard-1', ['tmpl-1'], policy),
        (err: any) => err.code === 'PRODUCTION_YARD_TEMPLATE_ALREADY_EXISTS'
      );
    });

    it('Scenario 9: rejects linking templates to an inactive yard', async () => {
      const policy = createPolicy({ allowAll: true });

      await assert.rejects(
        () => service.addTemplatesToYard('yard-inactive', ['tmpl-1'], policy),
        (err: any) => err.code === 'PRODUCTION_YARD_INACTIVE'
      );
    });

    it('Scenario 10: rejects linking inactive templates to a yard', async () => {
      const policy = createPolicy({ allowAll: true });

      await assert.rejects(
        () => service.addTemplatesToYard('yard-1', ['tmpl-inact'], policy),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_INACTIVE'
      );
    });

    it('Scenario 11: rejects linking non-existent or soft-deleted templates', async () => {
      const policy = createPolicy({ allowAll: true });

      await assert.rejects(
        () => service.addTemplatesToYard('yard-1', ['non-existent-id'], policy),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_NOT_FOUND'
      );
    });

    it('Scenario 12: Atomic Transaction - if any template in batch is invalid, all fail with 0 created', async () => {
      const policy = createPolicy({ allowAll: true });

      // Batch with 1 valid template and 1 inactive template
      await assert.rejects(
        () => service.addTemplatesToYard('yard-1', ['tmpl-1', 'tmpl-inact'], policy),
        (err: any) => err.code === 'PRODUCTION_TEMPLATE_INACTIVE'
      );

      // Verify tmpl-1 was NOT created partially
      const currentList = await service.listYardTemplates('yard-1', policy);
      assert.equal(currentList.length, 0);
    });

    it('Scenario 13: removeTemplateFromYard performs hard delete and preserves yard and template', async () => {
      const policy = createPolicy({ allowAll: true });
      await service.addTemplatesToYard('yard-1', ['tmpl-1'], policy);

      assert.equal(store.yardTemplates.size, 1);

      await service.removeTemplateFromYard('yard-1', 'tmpl-1', policy);

      // Hard deleted from junction table
      assert.equal(store.yardTemplates.size, 0);

      // Yard and Template remain intact
      assert.ok(store.yards.get('yard-1'));
      assert.ok(store.templates.get('tmpl-1'));
    });

    it('Scenario 14: getAvailableTemplatesForYard flags isAssigned correctly and filters by search', async () => {
      const policy = createPolicy({ allowAll: true });
      await service.addTemplatesToYard('yard-1', ['tmpl-1'], policy);

      const available = await service.getAvailableTemplatesForYard('yard-1', policy);
      assert.equal(available.length, 2); // tmpl1 and tmpl2 (tmplInactive excluded)

      const tmpl1Opt = available.find((a) => a.id === 'tmpl-1');
      assert.ok(tmpl1Opt);
      assert.equal(tmpl1Opt.isAssigned, true);

      const tmpl2Opt = available.find((a) => a.id === 'tmpl-2');
      assert.ok(tmpl2Opt);
      assert.equal(tmpl2Opt.isAssigned, false);

      // Search filter
      const searchRes = await service.getAvailableTemplatesForYard('yard-1', policy, 'عمود');
      assert.equal(searchRes.length, 1);
      assert.equal(searchRes[0].id, 'tmpl-1');
    });

    it('Scenario 15: addTemplateToYard single wrapper works seamlessly', async () => {
      const policy = createPolicy({ allowAll: true });
      const result = await service.addTemplateToYard('yard-1', 'tmpl-2', policy, 'user-admin');
      assert.equal(result.templateId, 'tmpl-2');
      assert.equal(result.yardId, 'yard-1');
    });
  });
});
