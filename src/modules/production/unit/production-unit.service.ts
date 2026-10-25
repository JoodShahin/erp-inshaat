import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull, Brackets } from 'typeorm';
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
import {
  applyUnitEventAccessScope,
  canAccessUnit,
} from '../authorization/production-access-query.helper.js';
import { ResolvedProductionAccessPolicy } from '../authorization/production-access-policy.types.js';
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
   * Enforces row-level security:
   * - Validates order existence and active status.
   * - When currentUser is provided, resolves PRODUCTION_ORDER_VIEW access rules and responsibilities.
   * - Limits unit results to allowed yards/departments for scoped users (e.g. yard engineer sees their yard rooms only).
   * - Accurately filters COUNT and pagination directly at SQL query time.
   */
  async getUnitsByOrderId(
    orderId: string,
    currentUserOrQuery?: AuthPrincipal | ListProductionUnitsQueryDto,
    maybeQuery?: ListProductionUnitsQueryDto,
    manager?: EntityManager
  ): Promise<PaginatedProductionUnitsResult> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const unitRepo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;

    let currentUser: AuthPrincipal | undefined;
    let query: ListProductionUnitsQueryDto | undefined;

    if (
      currentUserOrQuery &&
      typeof currentUserOrQuery === 'object' &&
      'id' in currentUserOrQuery &&
      !('page' in currentUserOrQuery || 'limit' in currentUserOrQuery || 'status' in currentUserOrQuery || 'orderLineId' in currentUserOrQuery)
    ) {
      currentUser = currentUserOrQuery as AuthPrincipal;
      query = maybeQuery;
    } else if (currentUserOrQuery) {
      query = currentUserOrQuery as ListProductionUnitsQueryDto;
    }

    const order = await orderRepo.findOne({
      where: { id: orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    let policy: ResolvedProductionAccessPolicy | null = null;
    if (currentUser) {
      const rules = await this.authzService.getApplicableAccessRules(
        currentUser,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      const responsibility = await this.respResolver.resolve(currentUser);
      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );

      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError('ليس لديك صلاحية لعرض غرف أمر الإنتاج', 'AUTHORIZATION_DENIED');
      }
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

    // Apply unit-level row authorization scoping
    if (policy) {
      if (!policy.allowAll) {
        const hasAllowDepts = policy.allowDepartmentIds.length > 0;
        const hasAllowYards = policy.allowYardIds.length > 0;

        if (!hasAllowDepts && !hasAllowYards) {
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere(
            new Brackets((subQb) => {
              if (hasAllowDepts && hasAllowYards) {
                subQb
                  .where('currentYard.department_id IN (:...authAllowUnitDeptIds)', {
                    authAllowUnitDeptIds: policy.allowDepartmentIds,
                  })
                  .orWhere('unit.current_yard_id IN (:...authAllowUnitYardIds)', {
                    authAllowUnitYardIds: policy.allowYardIds,
                  });
              } else if (hasAllowDepts) {
                subQb.where('currentYard.department_id IN (:...authAllowUnitDeptIds)', {
                  authAllowUnitDeptIds: policy.allowDepartmentIds,
                });
              } else {
                subQb.where('unit.current_yard_id IN (:...authAllowUnitYardIds)', {
                  authAllowUnitYardIds: policy.allowYardIds,
                });
              }
            })
          );
        }
      }

      // DENY overrides ALLOW
      const hasDenyDepts = policy.denyDepartmentIds.length > 0;
      const hasDenyYards = policy.denyYardIds.length > 0;

      if (hasDenyDepts || hasDenyYards) {
        qb.andWhere(
          new Brackets((subQb) => {
            if (policy.allowAll) {
              subQb.where('unit.current_yard_id IS NULL');
            }
            if (hasDenyDepts && hasDenyYards) {
              subQb.orWhere(
                '(currentYard.department_id NOT IN (:...authDenyUnitDeptIds) AND (unit.current_yard_id IS NULL OR unit.current_yard_id NOT IN (:...authDenyUnitYardIds)))',
                {
                  authDenyUnitDeptIds: policy.denyDepartmentIds,
                  authDenyUnitYardIds: policy.denyYardIds,
                }
              );
            } else if (hasDenyDepts) {
              subQb.orWhere(
                '(unit.current_yard_id IS NULL OR currentYard.department_id NOT IN (:...authDenyUnitDeptIds))',
                {
                  authDenyUnitDeptIds: policy.denyDepartmentIds,
                }
              );
            } else if (hasDenyYards) {
              subQb.orWhere(
                '(unit.current_yard_id IS NULL OR unit.current_yard_id NOT IN (:...authDenyUnitYardIds))',
                {
                  authDenyUnitYardIds: policy.denyYardIds,
                }
              );
            }
          })
        );
      }
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
   * Invariants & Security:
   * 1. 3-level Authorization: Order active & accessible -> Unit belongs to order & accessible -> Event scoped.
   * 2. Strict Typed Signature: (orderId, unitId, currentUser, query, manager).
   * 3. IDOR Protection: Verifies orderId matches unit.orderId and both are active (not soft deleted).
   * 4. Row-level Authorization: User must have PRODUCTION_ORDER_VIEW permission.
   * 5. Scoping Enforcement: Default Deny. Scoped users see only events within allowed departments / their own events.
   *    Administrative events are never leaked to scoped users. DENY overrides ALLOW.
   */
  async getUnitEvents(
    orderId: string,
    unitId: string,
    currentUser: AuthPrincipal,
    query?: ListProductionUnitEventsQueryDto,
    manager?: EntityManager
  ): Promise<PaginatedProductionUnitEventsResult> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const unitRepo = manager ? manager.getRepository(ProductionUnitEntity) : this.unitRepo;
    const eventRepo = manager ? manager.getRepository(ProductionUnitEventEntity) : this.eventRepo;

    // 1. Level 1: Verify order exists and is active
    const order = await orderRepo.findOne({
      where: { id: orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    // 2. Level 2: Verify unit exists, belongs to order, and is active
    const unit = await unitRepo.findOne({
      where: {
        id: unitId,
        orderId,
        deletedAt: IsNull(),
      },
      relations: { currentYard: true },
    });
    if (!unit) {
      throw new NotFoundError('الغرفة غير موجودة في أمر الإنتاج المحدد', 'PRODUCTION_UNIT_NOT_FOUND');
    }

    // 3. Resolve authorization policy for PRODUCTION_ORDER_VIEW
    if (!currentUser) {
      throw new ForbiddenError('يجب تسجيل الدخول لعرض سجلات الأحداث', 'AUTHENTICATION_REQUIRED');
    }

    const rules = await this.authzService.getApplicableAccessRules(
      currentUser,
      SystemPermission.PRODUCTION_ORDER_VIEW
    );

    const responsibility = await this.respResolver.resolve(currentUser);

    const policy = this.policyService.resolvePolicy(
      rules,
      responsibility,
      SystemPermission.PRODUCTION_ORDER_VIEW
    );

    if (policy.denyAll || !policy.hasAnyAccess) {
      throw new ForbiddenError('ليس لديك صلاحية لعرض سجلات أحداث الغرفة', 'AUTHORIZATION_DENIED');
    }

    // Level 2: Check unit-level access using unified canAccessUnit helper
    if (!canAccessUnit(policy, unit)) {
      throw new ForbiddenError('ليس لديك صلاحية للوصول إلى هذه الغرفة', 'AUTHORIZATION_DENIED');
    }

    // 4. Level 3: Build query with row-level event security and pagination
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? Math.min(query.limit, 100) : 50;
    const skip = (page - 1) * limit;

    const qb = eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.createdByUser', 'createdByUser')
      .where('event.unit_id = :unitId', { unitId });

    applyUnitEventAccessScope(qb, policy, currentUser, responsibility, 'event');

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
