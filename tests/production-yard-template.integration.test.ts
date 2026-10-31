import 'reflect-metadata';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { ProductionYardTemplateEntity } from '../src/modules/production/yard-template/production-yard-template.entity.js';
import { ProductionYardEntity } from '../src/modules/production/yard/production-yard.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionDepartmentEntity } from '../src/modules/production/department/production-department.entity.js';
import { ProductionYardTemplateService } from '../src/modules/production/yard-template/production-yard-template.service.js';
import { ResolvedProductionAccessPolicy } from '../src/modules/production/authorization/production-access-policy.types.js';
import { QueryFailedError } from 'typeorm';

describe('Production Yard Template MySQL Integration Tests', () => {
  let deptId: string;
  let yard1Id: string;
  let yard2Id: string;
  let tmpl1Id: string;
  let tmpl2Id: string;
  let service: ProductionYardTemplateService;

  const fullAccessPolicy: ResolvedProductionAccessPolicy = {
    denyAll: false,
    allowAll: true,
    allowDepartmentIds: [],
    denyDepartmentIds: [],
    allowYardIds: [],
    denyYardIds: [],
    hasAnyAccess: true,
  };

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    service = new ProductionYardTemplateService(AppDataSource);

    const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);
    const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);

    // Create a test department
    const dept = deptRepo.create({
      id: randomUUID(),
      name: `Dept Integration Test ${Date.now()}`,
      code: `DIT-${Math.floor(Math.random() * 90000 + 10000)}`,
      description: 'Department for Yard-Template integration test',
      isActive: true,
    });
    await deptRepo.save(dept);
    deptId = dept.id;

    // Create 2 test yards
    const yard1 = yardRepo.create({
      id: randomUUID(),
      departmentId: deptId,
      name: 'Yard Test 1',
      code: `YT1-${Math.floor(Math.random() * 90000 + 10000)}`,
      capacity: 10,
      isActive: true,
    });
    await yardRepo.save(yard1);
    yard1Id = yard1.id;

    const yard2 = yardRepo.create({
      id: randomUUID(),
      departmentId: deptId,
      name: 'Yard Test 2',
      code: `YT2-${Math.floor(Math.random() * 90000 + 10000)}`,
      capacity: 15,
      isActive: true,
    });
    await yardRepo.save(yard2);
    yard2Id = yard2.id;

    // Create 2 test templates
    const tmpl1 = tmplRepo.create({
      id: randomUUID(),
      name: 'Template Test 1',
      code: `TT1-${Math.floor(Math.random() * 90000 + 10000)}`,
      isActive: true,
    });
    await tmplRepo.save(tmpl1);
    tmpl1Id = tmpl1.id;

    const tmpl2 = tmplRepo.create({
      id: randomUUID(),
      name: 'Template Test 2',
      code: `TT2-${Math.floor(Math.random() * 90000 + 10000)}`,
      isActive: true,
    });
    await tmplRepo.save(tmpl2);
    tmpl2Id = tmpl2.id;
  });

  after(async () => {
    try {
      const ytRepo = AppDataSource.getRepository(ProductionYardTemplateEntity);
      const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
      const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
      const deptRepo = AppDataSource.getRepository(ProductionDepartmentEntity);

      // Clean up junction records
      await ytRepo.delete({ yardId: yard1Id });
      await ytRepo.delete({ yardId: yard2Id });

      // Clean up test yards, templates, department
      await yardRepo.delete({ id: yard1Id });
      await yardRepo.delete({ id: yard2Id });
      await tmplRepo.delete({ id: tmpl1Id });
      await tmplRepo.delete({ id: tmpl2Id });
      await deptRepo.delete({ id: deptId });

      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    } catch {
      // Ignore cleanup error
    }
  });

  it('1. assigns templates to yard in MySQL and verifies persistence', async () => {
    const res = await service.addTemplatesToYard(
      yard1Id,
      [tmpl1Id, tmpl2Id],
      fullAccessPolicy,
      null
    );

    assert.equal(res.length, 2);
    assert.ok(res.some((r) => r.templateId === tmpl1Id));
    assert.ok(res.some((r) => r.templateId === tmpl2Id));

    const list = await service.listYardTemplates(yard1Id, fullAccessPolicy);
    assert.equal(list.length, 2);
  });

  it('2. enforces database unique constraint UQ_production_yard_template_yard_template', async () => {
    // Attempting direct DB insert with same yardId and templateId must fail with MySQL 1062 ER_DUP_ENTRY
    const ytRepo = AppDataSource.getRepository(ProductionYardTemplateEntity);
    const dup = ytRepo.create({
      yardId: yard1Id,
      templateId: tmpl1Id,
    });

    await assert.rejects(
      () => ytRepo.save(dup),
      (err: any) => {
        assert.ok(err instanceof QueryFailedError);
        assert.equal((err as any).driverError?.errno, 1062);
        return true;
      }
    );
  });

  it('3. verifies Many-to-Many by assigning tmpl1 to yard2 as well', async () => {
    const res = await service.addTemplatesToYard(
      yard2Id,
      [tmpl1Id],
      fullAccessPolicy,
      null
    );

    assert.equal(res.length, 1);
    assert.equal(res[0].templateId, tmpl1Id);

    const listYard2 = await service.listYardTemplates(yard2Id, fullAccessPolicy);
    assert.equal(listYard2.length, 1);
    assert.equal(listYard2[0].templateId, tmpl1Id);
  });

  it('4. verifies getAvailableTemplatesForYard queries real MySQL accurately', async () => {
    const available = await service.getAvailableTemplatesForYard(yard1Id, fullAccessPolicy);
    assert.ok(available.length >= 2);

    const opt1 = available.find((o) => o.id === tmpl1Id);
    assert.ok(opt1);
    assert.equal(opt1.isAssigned, true);

    const opt2 = available.find((o) => o.id === tmpl2Id);
    assert.ok(opt2);
    assert.equal(opt2.isAssigned, true);
  });

  it('5. removes a template assignment via hard delete in MySQL', async () => {
    await service.removeTemplateFromYard(yard1Id, tmpl1Id, fullAccessPolicy);

    const list = await service.listYardTemplates(yard1Id, fullAccessPolicy);
    assert.equal(list.length, 1);
    assert.equal(list[0].templateId, tmpl2Id);

    // Verify yard and template are completely unharmed
    const yardRepo = AppDataSource.getRepository(ProductionYardEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);

    const yard = await yardRepo.findOne({ where: { id: yard1Id } });
    const tmpl = await tmplRepo.findOne({ where: { id: tmpl1Id } });

    assert.ok(yard, 'Yard must not be deleted');
    assert.ok(tmpl, 'Template must not be deleted');
  });

  it('6. atomic rollback: invalid batch creates 0 links in MySQL transaction', async () => {
    const nonExistentTemplateId = randomUUID();

    await assert.rejects(
      () =>
        service.addTemplatesToYard(
          yard1Id,
          [tmpl1Id, nonExistentTemplateId],
          fullAccessPolicy,
          null
        ),
      (err: any) => err.code === 'PRODUCTION_TEMPLATE_NOT_FOUND'
    );

    // Verify tmpl1 was NOT re-linked due to rollback
    const list = await service.listYardTemplates(yard1Id, fullAccessPolicy);
    assert.equal(list.length, 1);
    assert.equal(list[0].templateId, tmpl2Id);
  });
});
