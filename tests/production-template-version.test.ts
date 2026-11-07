import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionTemplateVersionService } from '../src/modules/production/template-version/production-template-version.service.js';
import { ProductionTemplateGuardService } from '../src/modules/production/template/production-template-guard.service.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';
import { NotFoundError } from '../src/common/errors/not-found.error.js';

describe('Production Template Version Service & Guard Tests', () => {
  describe('1. ProductionTemplateVersionService', () => {
    it('getSortedActiveVersions sorts versions numerically descending (1.10 above 1.9)', async () => {
      const mockVersions = [
        { id: 'v1', version: '1.0', createdAt: new Date() },
        { id: 'v2', version: '1.9', createdAt: new Date() },
        { id: 'v3', version: '1.10', createdAt: new Date() },
        { id: 'v4', version: '1.2', createdAt: new Date() },
      ];

      const mockRepo = {
        find: async () => [...mockVersions],
      };

      const mockDs = {
        getRepository: () => mockRepo,
      } as any;

      const service = new ProductionTemplateVersionService(mockDs);
      const sorted = await service.getSortedActiveVersions('tmpl-1');

      assert.strictEqual(sorted.length, 4);
      assert.strictEqual(sorted[0].version, '1.10');
      assert.strictEqual(sorted[1].version, '1.9');
      assert.strictEqual(sorted[2].version, '1.2');
      assert.strictEqual(sorted[3].version, '1.0');
    });

    it('getSortedActiveVersions throws NotFoundError when no versions exist', async () => {
      const mockRepo = {
        find: async () => [],
      };

      const mockDs = {
        getRepository: () => mockRepo,
      } as any;

      const service = new ProductionTemplateVersionService(mockDs);
      await assert.rejects(
        async () => service.getSortedActiveVersions('tmpl-1'),
        (err: any) => {
          assert.strictEqual(err instanceof NotFoundError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_NOT_FOUND');
          return true;
        }
      );
    });

    it('getLatestVersion returns the highest sorted active version', async () => {
      const mockVersions = [
        { id: 'v-old', version: '1.0', createdAt: new Date() },
        { id: 'v-latest', version: '1.1', createdAt: new Date() },
      ];

      const mockRepo = {
        find: async () => [...mockVersions],
      };

      const mockDs = {
        getRepository: () => mockRepo,
      } as any;

      const service = new ProductionTemplateVersionService(mockDs);
      const latest = await service.getLatestVersion('tmpl-1');

      assert.strictEqual(latest.id, 'v-latest');
      assert.strictEqual(latest.version, '1.1');
    });

    it('listVersions maps isLatest correctly', async () => {
      const mockVersions = [
        { id: 'v1', version: '1.0', createdAt: new Date() },
        { id: 'v2', version: '1.1', createdAt: new Date() },
      ];

      const mockRepo = {
        find: async () => [...mockVersions],
      };

      const mockDs = {
        getRepository: () => mockRepo,
      } as any;

      const service = new ProductionTemplateVersionService(mockDs);
      const list = await service.listVersions('tmpl-1');

      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].id, 'v2');
      assert.strictEqual(list[0].isLatest, true);
      assert.strictEqual(list[1].id, 'v1');
      assert.strictEqual(list[1].isLatest, false);
    });

    it('assertIsLatestVersion throws BusinessRuleError when version is not latest', async () => {
      const mockVersions = [
        { id: 'v1', version: '1.0', createdAt: new Date() },
        { id: 'v2', version: '1.1', createdAt: new Date() },
      ];

      const mockRepo = {
        find: async () => [...mockVersions],
      };

      const mockDs = {
        getRepository: () => mockRepo,
      } as any;

      const service = new ProductionTemplateVersionService(mockDs);

      // Latest is v2 ('1.1'). Checking v1 should reject!
      await assert.rejects(
        async () => service.assertIsLatestVersion('tmpl-1', 'v1'),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST');
          return true;
        }
      );

      // Checking v2 should succeed
      const verified = await service.assertIsLatestVersion('tmpl-1', 'v2');
      assert.strictEqual(verified.id, 'v2');
    });

    it('createNextVersion avoids reusing historical or deleted version numbers', async () => {
      const savedEntities: any[] = [];
      const mockManager = {
        getRepository: () => ({
          find: async (opts: any) => {
            if (opts.withDeleted) {
              // Historical deleted 1.1 exists
              return [
                { id: 'v0', version: '1.0' },
                { id: 'v1-deleted', version: '1.1', deletedAt: new Date() },
              ];
            }
            // Active is only 1.0
            return [{ id: 'v0', version: '1.0', deletedAt: null }];
          },
          create: (data: any) => data,
          save: async (data: any) => {
            savedEntities.push(data);
            return { id: 'v-new', ...data };
          },
        }),
      } as any;

      const service = new ProductionTemplateVersionService();
      const nextVer = await service.createNextVersion('tmpl-1', mockManager);

      // Because 1.1 was used historically, next must be 1.2
      assert.strictEqual(nextVer.version, '1.2');
      assert.strictEqual(savedEntities[0].version, '1.2');
    });
  });

  describe('2. Legacy Endpoint Guard Protection', () => {
    it('requireMutableStageBelongsToTemplate rejects mutation when stage belongs to historical version', async () => {
      const mockDs = {
        getRepository: () => ({
          findOne: async (_opts: any) => {
            return { id: 'tmpl-1', deletedAt: null };
          },
        }),
      } as any;

      const mockVersionService = {
        assertIsLatestVersion: async (_tmplId: string, versionId: string) => {
          if (versionId === 'v-old') {
            throw new BusinessRuleError(
              'الإصدار قديم وللقراءة فقط',
              'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST'
            );
          }
          return { id: versionId };
        },
      } as any;

      const guard = new ProductionTemplateGuardService(mockDs, mockVersionService);

      const mockStageRepo = {
        findOne: async () => ({
          id: 'stage-1',
          templateId: 'tmpl-1',
          versionId: 'v-old',
          deletedAt: null,
        }),
      };

      const mockManager = {
        getRepository: () => mockStageRepo,
      } as any;

      await assert.rejects(
        async () => guard.requireMutableStageBelongsToTemplate('tmpl-1', 'stage-1', mockManager),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST');
          return true;
        }
      );
    });

    it('requireMutableOptionBelongsToPattern rejects mutation when pattern belongs to historical version', async () => {
      const mockDs = {
        getRepository: () => ({
          findOne: async () => ({ id: 'tmpl-1', deletedAt: null }),
        }),
      } as any;

      const mockVersionService = {
        assertIsLatestVersion: async (_tmplId: string, versionId: string) => {
          if (versionId === 'v-old') {
            throw new BusinessRuleError(
              'الإصدار قديم وللقراءة فقط',
              'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST'
            );
          }
          return { id: versionId };
        },
      } as any;

      const guard = new ProductionTemplateGuardService(mockDs, mockVersionService);

      const mockManager = {
        getRepository: (entity: any) => {
          if (entity.name === 'ProductionTemplatePatternEntity') {
            return {
              findOne: async () => ({
                id: 'pat-1',
                templateId: 'tmpl-1',
                versionId: 'v-old',
                deletedAt: null,
              }),
            };
          }
          return {
            findOne: async () => ({
              id: 'opt-1',
              patternId: 'pat-1',
              deletedAt: null,
            }),
          };
        },
      } as any;

      await assert.rejects(
        async () => guard.requireMutableOptionBelongsToPattern('tmpl-1', 'pat-1', 'opt-1', mockManager),
        (err: any) => {
          assert.strictEqual(err instanceof BusinessRuleError, true);
          assert.strictEqual(err.code, 'PRODUCTION_TEMPLATE_VERSION_NOT_LATEST');
          return true;
        }
      );
    });
  });
});
