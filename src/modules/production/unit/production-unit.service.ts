import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionUnitEntity, ProductionUnitStatus } from './production-unit.entity.js';
import { ProductionUnitEventEntity, ProductionUnitEventType } from './production-unit-event.entity.js';
import { ProductionOrderEntity } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionExecutionPlanEntity } from '../execution-plan/production-execution-plan.entity.js';
import {
  ProductionUnitDto,
  ProductionUnitEventDto,
  OrderUnitsSummaryDto,
} from './production-unit.types.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionUnitService {
  private unitRepo: Repository<ProductionUnitEntity>;
  private eventRepo: Repository<ProductionUnitEventEntity>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.unitRepo = this.dataSource.getRepository(ProductionUnitEntity);
    this.eventRepo = this.dataSource.getRepository(ProductionUnitEventEntity);
  }

  /**
   * Generates production units and their initial UNIT_CREATED history events
   * for a given line execution plan within a transaction.
   *
   * Invariants:
   * 1. Generates exactly line.quantity units.
   * 2. Starts with code = null, currentYardId = null, status = 'CREATED'.
   * 3. Sequences are strictly 1..N per order line.
   * 4. An immutable UNIT_CREATED event is saved for each unit in the same transaction.
   * 5. Events share the batch correlationId for audit traceability.
   * 6. Does NOT create empty task execution records.
   */
  async generateUnitsForPlan(
    order: ProductionOrderEntity,
    line: ProductionOrderLineEntity,
    plan: ProductionExecutionPlanEntity,
    correlationId: string,
    userId: string,
    manager: EntityManager
  ): Promise<{ units: ProductionUnitEntity[]; events: ProductionUnitEventEntity[] }> {
    const unitRepo = manager.getRepository(ProductionUnitEntity);
    const eventRepo = manager.getRepository(ProductionUnitEventEntity);

    // 1. Guard against duplicate unit generation for the same line
    const existingUnitCount = await unitRepo.count({
      where: { orderLineId: line.id },
    });
    if (existingUnitCount > 0) {
      throw new BusinessRuleError(
        `تم بالفعل توليد غرف الإنتاج لهذا البند (#${line.sortOrder})`,
        'PRODUCTION_UNITS_ALREADY_GENERATED'
      );
    }

    const units: ProductionUnitEntity[] = [];
    const events: ProductionUnitEventEntity[] = [];
    const now = new Date();

    for (let seq = 1; seq <= line.quantity; seq++) {
      const unitId = randomUUID();
      const unitNumber = `${order.orderNumber}-L${line.sortOrder}-U${String(seq).padStart(3, '0')}`;

      const unit = unitRepo.create({
        id: unitId,
        orderId: order.id,
        orderLineId: line.id,
        planId: plan.id,
        unitSequence: seq,
        unitNumber,
        code: null,
        currentYardId: null,
        status: ProductionUnitStatus.CREATED,
        isCancelled: false,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
      });

      const event = eventRepo.create({
        id: randomUUID(),
        unitId,
        eventType: ProductionUnitEventType.UNIT_CREATED,
        createdByUserId: userId,
        occurredAt: now,
        departmentId: null,
        executionTaskId: null,
        previousData: null,
        newData: {
          unitSequence: seq,
          unitNumber,
          orderLineId: line.id,
          planId: plan.id,
          status: ProductionUnitStatus.CREATED,
        },
        correlationId,
        metadata: {
          orderNumber: order.orderNumber,
          templateCode: plan.templateCode,
          templateName: plan.templateName,
          lineSortOrder: line.sortOrder,
        },
        createdAt: now,
      });

      units.push(unit);
      events.push(event);
    }

    // Atomic bulk save
    await unitRepo.save(units);
    await eventRepo.save(events);

    return { units, events };
  }

  /**
   * Retrieves units belonging to an order.
   */
  async getUnitsByOrderId(
    orderId: string,
    manager?: EntityManager
  ): Promise<ProductionUnitDto[]> {
    const repo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;
    const units = await repo.find({
      where: { orderId, deletedAt: IsNull() },
      order: { orderLineId: 'ASC', unitSequence: 'ASC' },
      relations: { currentYard: true },
    });

    return units.map(this.toUnitDto);
  }

  /**
   * Retrieves units belonging to a specific order line.
   */
  async getUnitsByLineId(
    lineId: string,
    manager?: EntityManager
  ): Promise<ProductionUnitDto[]> {
    const repo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;
    const units = await repo.find({
      where: { orderLineId: lineId, deletedAt: IsNull() },
      order: { unitSequence: 'ASC' },
      relations: { currentYard: true },
    });

    return units.map(this.toUnitDto);
  }

  /**
   * Retrieves summary counts of units for an order.
   */
  async getUnitsSummaryByOrderId(
    orderId: string,
    manager?: EntityManager
  ): Promise<OrderUnitsSummaryDto> {
    const repo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;
    const units = await repo.find({
      where: { orderId, deletedAt: IsNull() },
      select: { id: true, status: true, isCancelled: true },
    });

    const summary: OrderUnitsSummaryDto = {
      totalUnits: units.length,
      createdUnits: 0,
      inProgressUnits: 0,
      completedUnits: 0,
      cancelledUnits: 0,
    };

    for (const u of units) {
      if (u.isCancelled || u.status === ProductionUnitStatus.CANCELLED) {
        summary.cancelledUnits++;
      } else if (u.status === ProductionUnitStatus.COMPLETED) {
        summary.completedUnits++;
      } else if (u.status === ProductionUnitStatus.IN_PROGRESS) {
        summary.inProgressUnits++;
      } else {
        summary.createdUnits++;
      }
    }

    return summary;
  }

  /**
   * Retrieves historical events for a single unit.
   */
  async getUnitEvents(
    unitId: string,
    manager?: EntityManager
  ): Promise<ProductionUnitEventDto[]> {
    const repo = manager ? manager.getRepository(ProductionUnitEventEntity) : this.eventRepo;
    const events = await repo.find({
      where: { unitId },
      order: { occurredAt: 'ASC', createdAt: 'ASC' },
      relations: { createdByUser: true },
    });

    return events.map((e) => ({
      id: e.id,
      unitId: e.unitId,
      eventType: e.eventType,
      createdByUserId: e.createdByUserId,
      createdByUser: e.createdByUser
        ? { id: e.createdByUser.id, fullName: e.createdByUser.fullName }
        : null,
      occurredAt: e.occurredAt,
      departmentId: e.departmentId,
      executionTaskId: e.executionTaskId,
      previousData: e.previousData,
      newData: e.newData,
      correlationId: e.correlationId,
      metadata: e.metadata,
      createdAt: e.createdAt,
    }));
  }

  private toUnitDto(unit: ProductionUnitEntity): ProductionUnitDto {
    return {
      id: unit.id,
      orderId: unit.orderId,
      orderLineId: unit.orderLineId,
      planId: unit.planId,
      unitSequence: unit.unitSequence,
      unitNumber: unit.unitNumber,
      code: unit.code,
      currentYardId: unit.currentYardId,
      currentYardName: unit.currentYard?.name || null,
      status: unit.status,
      isCancelled: unit.isCancelled,
      cancelledAt: unit.cancelledAt,
      cancellationReason: unit.cancellationReason,
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
    };
  }
}

export const productionUnitService = new ProductionUnitService();
