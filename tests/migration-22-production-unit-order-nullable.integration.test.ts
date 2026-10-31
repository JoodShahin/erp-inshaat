import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { MakeProductionUnitOrderNullable1710000000022 } from '../src/database/migrations/1710000000022-MakeProductionUnitOrderNullable.js';
import { ProductionOrderEntity, ProductionOrderStatus } from '../src/modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../src/modules/production/order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../src/modules/production/template/production-template.entity.js';
import { ProductionExecutionPlanEntity } from '../src/modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../src/modules/production/unit/production-unit.entity.js';
import { UserEntity } from '../src/modules/system/user/user.entity.js';
import { In, IsNull } from 'typeorm';

describe('Real MySQL Integration Tests: Migration 22 & Nullable Order Link Safety', () => {
  let testUserId: string;
  let testTemplateId: string;
  let testOrderId: string;
  let testLineId: string;
  let testPlanId: string;
  let historicalUnitId: string;

  const migration = new MakeProductionUnitOrderNullable1710000000022();
  const createdUnitIds: string[] = [];

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(UserEntity);
    const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);
    const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
    const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
    const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);

    const users = await userRepo.find({ take: 1 });
    if (users.length === 0) {
      throw new Error('No system users found for migration test');
    }
    testUserId = users[0].id;

    // Create persistent test template
    testTemplateId = randomUUID();
    await tmplRepo.save(
      tmplRepo.create({
        id: testTemplateId,
        name: 'قالب اختبار ترحيل الغرف',
        code: `TMPL-MIG-${Date.now().toString().slice(-4)}`,
        referenceNumber: 'REF-MIG',
        isActive: true,
      })
    );

    // Create approved order and line representing historical state
    testOrderId = randomUUID();
    await orderRepo.save(
      orderRepo.create({
        id: testOrderId,
        orderNumber: `PO-MIG-${Date.now().toString().slice(-4)}`,
        status: ProductionOrderStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: testUserId,
        createdByUserId: testUserId,
      })
    );

    testLineId = randomUUID();
    await lineRepo.save(
      lineRepo.create({
        id: testLineId,
        orderId: testOrderId,
        templateId: testTemplateId,
        quantity: 5,
        sortOrder: 1,
      })
    );

    testPlanId = randomUUID();
    await planRepo.save(
      planRepo.create({
        id: testPlanId,
        orderId: testOrderId,
        orderLineId: testLineId,
        templateId: testTemplateId,
        templateName: 'خطة اختبار الترحيل',
        templateCode: 'TMPL-MIG',
        lineQuantity: 5,
      })
    );

    // Historical unit with non-null order_id and order_line_id
    historicalUnitId = randomUUID();
    createdUnitIds.push(historicalUnitId);
    await unitRepo.save(
      unitRepo.create({
        id: historicalUnitId,
        orderId: testOrderId,
        orderLineId: testLineId,
        planId: testPlanId,
        unitSequence: 1,
        unitNumber: 'U-HISTORICAL-1',
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
      })
    );
  });

  after(async () => {
    try {
      if (AppDataSource.isInitialized) {
        const queryRunner = AppDataSource.createQueryRunner();
        // Ensure migration remains applied in DB state for subsequent operations
        await migration.up(queryRunner);
        await queryRunner.release();

        const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
        const planRepo = AppDataSource.getRepository(ProductionExecutionPlanEntity);
        const lineRepo = AppDataSource.getRepository(ProductionOrderLineEntity);
        const orderRepo = AppDataSource.getRepository(ProductionOrderEntity);
        const tmplRepo = AppDataSource.getRepository(ProductionTemplateEntity);

        if (createdUnitIds.length > 0) {
          await unitRepo.delete({ id: In(createdUnitIds) });
        }
        await planRepo.delete({ id: testPlanId });
        await lineRepo.delete({ id: testLineId });
        await orderRepo.delete({ id: testOrderId });
        await tmplRepo.delete({ id: testTemplateId });
      }
    } catch {
      // Ignore cleanup error
    } finally {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    }
  });

  it('1 & 2. Migration UP preserves historical units and relations intact', async () => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
      // Execute UP migration
      await migration.up(queryRunner);

      // Verify columns are nullable in MySQL metadata
      const table = await queryRunner.getTable('production_unit');
      const orderIdCol = table?.findColumnByName('order_id');
      const orderLineIdCol = table?.findColumnByName('order_line_id');
      assert.equal(orderIdCol?.isNullable, true, 'order_id must be nullable in MySQL');
      assert.equal(orderLineIdCol?.isNullable, true, 'order_line_id must be nullable in MySQL');

      // Verify historical record remains completely intact
      const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
      const historicalUnit = await unitRepo.findOne({ where: { id: historicalUnitId } });
      assert.ok(historicalUnit, 'Historical unit must exist');
      assert.equal(historicalUnit.orderId, testOrderId, 'Historical orderId must not change');
      assert.equal(historicalUnit.orderLineId, testLineId, 'Historical orderLineId must not change');
      assert.equal(historicalUnit.planId, testPlanId, 'Historical planId must not change');
    } finally {
      await queryRunner.release();
    }
  });

  it('3. Successfully inserts unallocated production unit with NULL order_id and NULL order_line_id', async () => {
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const unallocatedUnitId = randomUUID();
    createdUnitIds.push(unallocatedUnitId);

    const unit = unitRepo.create({
      id: unallocatedUnitId,
      orderId: null,
      orderLineId: null,
      planId: testPlanId,
      unitSequence: 99,
      unitNumber: 'U-UNALLOCATED-99',
      status: ProductionUnitStatus.CREATED,
      isCancelled: false,
    });

    await unitRepo.save(unit);

    const reloaded = await unitRepo.findOne({ where: { id: unallocatedUnitId } });
    assert.ok(reloaded);
    assert.equal(reloaded.orderId, null, 'orderId must be null');
    assert.equal(reloaded.orderLineId, null, 'orderLineId must be null');
    assert.equal(reloaded.planId, testPlanId, 'planId must remain valid');
  });

  it('4. Rejects inserting production unit with invalid/missing plan_id via database constraint', async () => {
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const invalidPlanUnitId = randomUUID();

    await assert.rejects(
      async () => {
        // Attempt insert with foreign key to non-existent plan
        await unitRepo.save(
          unitRepo.create({
            id: invalidPlanUnitId,
            orderId: null,
            orderLineId: null,
            planId: randomUUID(), // non-existent plan ID
            unitSequence: 100,
            unitNumber: 'U-INVALID-PLAN',
            status: ProductionUnitStatus.CREATED,
            isCancelled: false,
          })
        );
      },
      (err: any) => {
        // MySQL Foreign Key failure: code 1452 or ER_NO_REFERENCED_ROW_2
        assert.ok(err.message.includes('foreign key') || err.message.includes('FK_') || err.code === 'ER_NO_REFERENCED_ROW_2' || err?.driverError?.errno === 1452);
        return true;
      }
    );
  });

  it('5 & 6. Safe Rollback: down() throws protective error when NULL rows exist, and succeeds when none exist', async () => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
      // Currently, an unallocated unit exists with order_id = null and order_line_id = null
      await assert.rejects(
        async () => {
          await migration.down(queryRunner);
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('Cannot revert migration') && err.message.includes('NULL order_id or order_line_id'),
            'Must fail with protective error message'
          );
          return true;
        }
      );

      // Verify NO columns were mutated or corrupted by the aborted rollback
      const tableCheck = await queryRunner.getTable('production_unit');
      assert.equal(tableCheck?.findColumnByName('order_id')?.isNullable, true);
      assert.equal(tableCheck?.findColumnByName('order_line_id')?.isNullable, true);

      // Now clean up unallocated units so only non-null historical units exist
      const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
      const unallocated = await unitRepo.find({ where: { orderLineId: IsNull() } });
      const unallocatedIds = unallocated.filter((u) => u.orderLineId === null || u.orderId === null).map((u) => u.id);
      if (unallocatedIds.length > 0) {
        await unitRepo.delete({ id: In(unallocatedIds) });
      }

      // Now with 0 null rows, down() must succeed cleanly
      await migration.down(queryRunner);

      const tableReverted = await queryRunner.getTable('production_unit');
      assert.equal(tableReverted?.findColumnByName('order_id')?.isNullable, false, 'order_id reverted to NOT NULL');
      assert.equal(tableReverted?.findColumnByName('order_line_id')?.isNullable, false, 'order_line_id reverted to NOT NULL');

      // Re-apply migration UP to restore system to target state
      await migration.up(queryRunner);
      const tableRestored = await queryRunner.getTable('production_unit');
      assert.equal(tableRestored?.findColumnByName('order_id')?.isNullable, true);
      assert.equal(tableRestored?.findColumnByName('order_line_id')?.isNullable, true);
    } finally {
      await queryRunner.release();
    }
  });

  it('7. Zero Data Loss: Historical unit remains intact after safe UP/DOWN/UP cycles', async () => {
    const unitRepo = AppDataSource.getRepository(ProductionUnitEntity);
    const unit = await unitRepo.findOne({ where: { id: historicalUnitId } });
    assert.ok(unit, 'Historical unit must survive intact');
    assert.equal(unit.orderId, testOrderId);
    assert.equal(unit.orderLineId, testLineId);
    assert.equal(unit.planId, testPlanId);
  });
});
