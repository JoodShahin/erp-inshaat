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
  PaginatedProductionUnitsResult,
  PaginatedProductionUnitEventsResult,
} from './production-unit.types.js';
import { ListProductionUnitsQueryDto } from './dto/list-production-units-query.dto.js';
import { ListProductionUnitEventsQueryDto } from './dto/list-production-unit-events-query.dto.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import {
  authorizationService,
  AuthorizationService,
} from '../../system/authorization/authorization.service.js';
import {
  productionAccessPolicyService,
  ProductionAccessPolicyService,
} from '../authorization/production-access-policy.service.js';
import {
  productionResponsibilityResolver,
  ProductionResponsibilityResolver,
} from '../authorization/production-responsibility.resolver.js';
import { applyUnitEventAccessScope } from '../authorization/production-access-query.helper.js';
import { ProductionResponsibility } from '../authorization/production-access-policy.types.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { ForbiddenError } from '../../../common/errors/forbidden.error.js';

export class ProductionUnitService {
  private orderRepo: Repository<ProductionOrderEntity>;
  private unitRepo: Repository<ProductionUnitEntity>;
  private eventRepo: Repository<ProductionUnitEventEntity>;

  constructor(
    private dataSource: DataSource = AppDataSource,
    private authzService: AuthorizationService = authorizationService,
    private policyService: ProductionAccessPolicyService = productionAccessPolicyService,
    private respResolver: ProductionResponsibilityResolver = productionResponsibilityResolver
  ) {
    this.orderRepo = this.dataSource.getRepository(ProductionOrderEntity);
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
   * Retrieves paginated units belonging to an order.
   * Validates that the order exists and is not soft deleted.
   */
  async getUnitsByOrderId(
    orderId: string,
    query?: ListProductionUnitsQueryDto,
    manager?: EntityManager
  ): Promise<PaginatedProductionUnitsResult> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const unitRepo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;

    const order = await orderRepo.findOne({
      where: { id: orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const qb = unitRepo
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.currentYard', 'currentYard')
      .where('unit.order_id = :orderId', { orderId })
      .andWhere('unit.deleted_at IS NULL');

    if (query?.status) {
      qb.andWhere('unit.status = :status', { status: query.status });
    }

    if (query?.orderLineId) {
      qb.andWhere('unit.order_line_id = :orderLineId', { orderLineId: query.orderLineId });
    }

    qb.orderBy('unit.order_line_id', 'ASC')
      .addOrderBy('unit.unit_sequence', 'ASC')
      .skip(skip)
      .take(limit);

    const [units, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: units.map(this.toUnitDto),
      total,
      page,
      limit,
      totalPages,
    };
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
   * Retrieves paginated historical events for a single unit.
   *
   * Invariants:
   * 1. IDOR Protection: Verifies orderId matches unit.orderId and both are active (not soft deleted).
   * 2. Row-level Authorization: User must have PRODUCTION_ORDER_VIEW permission.
   * 3. Scoping Enforcement: Default Deny. If user is scoped to specific departments,
   *    only events for those departments or general events are returned. DENY overrides ALLOW.
   */
  async getUnitEvents(
    orderIdOrUnitId: string,
    maybeUnitId?: string,
    currentUser?: AuthPrincipal,
    query?: ListProductionUnitEventsQueryDto,
    manager?: EntityManager
  ): Promise<any> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const unitRepo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;
    const eventRepo = manager ? manager.getRepository(ProductionUnitEventEntity) : this.eventRepo;

    let targetUnitId: string;
    let expectedOrderId: string | null = null;

    if (typeof maybeUnitId === 'string') {
      expectedOrderId = orderIdOrUnitId;
      targetUnitId = maybeUnitId;
    } else {
      targetUnitId = orderIdOrUnitId;
    }

    // 1. Verify unit exists and is not deleted
    const unit = await unitRepo.findOne({
      where: {
        id: targetUnitId,
        ...(expectedOrderId ? { orderId: expectedOrderId } : {}),
        deletedAt: IsNull(),
      },
    });
    if (!unit) {
      throw new NotFoundError('الغرفة غير موجودة في أمر الإنتاج المحدد', 'PRODUCTION_UNIT_NOT_FOUND');
    }

    // 2. Verify order exists and is active
    const order = await orderRepo.findOne({
      where: { id: unit.orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    // 3. Resolve authorization policy for PRODUCTION_ORDER_VIEW if user provided
    let policy = null;
    if (currentUser) {
      const rules = await this.authzService.getApplicableAccessRules(
        currentUser,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );

      const needsResponsibility = rules.some(
        (r) => r.scopeType === 'PRODUCTION_DEPARTMENT' || r.scopeType === 'PRODUCTION_YARD'
      );

      let responsibility: ProductionResponsibility = {
        headDepartmentId: null,
        engineerDepartmentId: null,
        engineerYardIds: [],
        isConsistent: true,
      };

      if (needsResponsibility) {
        responsibility = await this.respResolver.resolve(currentUser);
      }

      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );

      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError('ليس لديك صلاحية لعرض سجلات أحداث الغرفة', 'AUTHORIZATION_DENIED');
      }
    }

    // 4. Build query with row-level security and pagination
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? Math.min(query.limit, 100) : 50;
    const skip = (page - 1) * limit;

    const qb = eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.createdByUser', 'createdByUser')
      .where('event.unit_id = :unitId', { unitId: targetUnitId });

    if (policy) {
      applyUnitEventAccessScope(qb, policy, 'event');
    }

    qb.orderBy('event.occurred_at', 'ASC')
      .addOrderBy('event.created_at', 'ASC')
      .skip(skip)
      .take(limit);

    const [events, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    const items: ProductionUnitEventDto[] = events.map((e) => ({
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

    if (!expectedOrderId && !currentUser) {
      return items;
    }

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
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
