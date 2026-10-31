import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull, Not, In } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionOrderEntity, ProductionOrderStatus } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from './production-order-line.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../unit/production-unit.entity.js';
import { ProductionUnitEventEntity, ProductionUnitEventType } from '../unit/production-unit-event.entity.js';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
import {
  ExecutionPlanSpecificationSnapshot,
} from '../execution-plan/production-execution-plan.entity.js';
import {
  calculateLineQuantities,
  ProductionLineQuantities,
} from './production-order-line-quantity.helper.js';
import { hashLineConfiguration } from './production-order-line-configuration.helper.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
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
import { canAccessUnit } from '../authorization/production-access-query.helper.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { ForbiddenError } from '../../../common/errors/forbidden.error.js';

export interface ProductionOrderLineAllocationStatus {
  lineId: string;
  orderId: string;
  templateId: string;
  orderStatus: string;
  isOrderApproved: boolean;
  quantities: ProductionLineQuantities;
}

export interface CandidateUnitLike {
  id: string;
  orderLineId?: string | null;
  orderId?: string | null;
  templateId?: string | null;
  isCancelled: boolean;
  status: string;
  deletedAt?: Date | null;
  planId?: string | null;
  plan?: {
    templateId: string;
    configurationHash?: string | null;
    patternSummary?: Array<{
      patternId: string;
      patternName?: string;
      optionId: string;
      optionName?: string;
    }> | null;
    specifications?: ExecutionPlanSpecificationSnapshot[] | null;
  } | null;
}

export interface InternalTrustedContext {
  isInternalTrusted: true;
  operatorUserId?: string | null;
  reason?: string;
}

export interface AllocateAndLinkUnitsParams {
  orderLineId: string;
  candidateUnitIds: string[];
  currentUser: AuthPrincipal | InternalTrustedContext;
  correlationId?: string;
  // Unsupported/Phantom parameter guards:
  candidateUnits?: CandidateUnitLike[];
  unitsToCreateCount?: number;
  quantityToReserveOnly?: number;
}

export interface AllocateAndLinkUnitsResult {
  orderLineId: string;
  orderId: string;
  previousLinkedQuantity: number;
  newLinkedQuantity: number;
  remainingQuantity: number;
  excessQuantity: number;
  hasQuantityViolation: boolean;
  linkedUnitIds: string[];
}

export interface RestoreCancelledUnitParams {
  orderLineId: string;
  unitId: string;
  currentUser: AuthPrincipal | InternalTrustedContext;
  reason?: string;
}

export interface RestoreCancelledUnitResult {
  unitId: string;
  orderLineId: string;
  status: string;
  isCancelled: boolean;
  newLinkedQuantity: number;
  remainingQuantity: number;
}

export class ProductionOrderLineAllocationService {
  constructor(
    private dataSource: DataSource = AppDataSource,
    private authzService: AuthorizationService = authorizationService,
    private policyService: ProductionAccessPolicyService = productionAccessPolicyService,
    private respResolver: ProductionResponsibilityResolver = productionResponsibilityResolver
  ) {}

  /**
   * Reusable quantity calculation helper.
   */
  calculateQuantities(requestedQuantity: number, linkedQuantity: number): ProductionLineQuantities {
    return calculateLineQuantities(requestedQuantity, linkedQuantity);
  }

  /**
   * Inspects the current allocation status of an order line, including
   * active non-cancelled linked units count and excess detection.
   */
  async getLineAllocationStatus(
    orderLineId: string,
    manager?: EntityManager
  ): Promise<ProductionOrderLineAllocationStatus> {
    const lineRepo = manager
      ? manager.getRepository(ProductionOrderLineEntity)
      : this.dataSource.getRepository(ProductionOrderLineEntity);
    const unitRepo = manager
      ? manager.getRepository(ProductionUnitEntity)
      : this.dataSource.getRepository(ProductionUnitEntity);

    const line = await lineRepo.findOne({
      where: { id: orderLineId, deletedAt: IsNull() },
      relations: { order: true },
    });

    if (!line) {
      throw new NotFoundError('بند أمر الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
    }

    const linkedCount = await unitRepo.count({
      where: {
        orderLineId: line.id,
        isCancelled: false,
        status: Not(ProductionUnitStatus.CANCELLED),
        deletedAt: IsNull(),
      },
    });

    const isOrderApproved = line.order?.status === ProductionOrderStatus.APPROVED;
    const quantities = calculateLineQuantities(line.quantity, linkedCount);

    return {
      lineId: line.id,
      orderId: line.orderId,
      templateId: line.templateId,
      orderStatus: line.order?.status || 'UNKNOWN',
      isOrderApproved,
      quantities,
    };
  }

  /**
   * Strict compatibility verification:
   * Policy: Fail Closed — No Verified Compatibility, No Allocation.
   *
   * 1. Cancellation / Archive: rejects cancelled or soft-deleted room.
   * 2. Double Booking: rejects if already linked to another line, or already linked to THIS line.
   * 3. Template Match: must have verified templateId matching order line.
   * 4. Pattern & Option Choices Match:
   *    - Must verify configuration hash or canonical pattern choices.
   *    - If line requires patterns, candidate unit MUST possess verified pattern data.
   * 5. Mandatory Technical Specifications Match:
   *    - If line template defines specifications, candidate unit MUST possess specifications snapshot.
   *    - Every specification must be present with identical value.
   * 6. Immutability: candidate unit snapshot is NEVER mutated.
   */
  verifyCandidateUnitCompatibility(
    line: ProductionOrderLineEntity,
    candidateUnit: CandidateUnitLike,
    lineTemplateSpecifications?: ProductionTemplateSpecificationEntity[] | null
  ): void {
    // 1. Check Cancellation / Soft-delete
    if (
      candidateUnit.deletedAt ||
      candidateUnit.isCancelled ||
      candidateUnit.status === ProductionUnitStatus.CANCELLED
    ) {
      throw new BusinessRuleError(
        'لا يمكن ربط أو تخصيص غرفة ملغاة أو مؤرشفة لبند مذكرة الإنتاج',
        'PRODUCTION_UNIT_CANCELLED'
      );
    }

    // 2. Check Double Booking & Re-linking
    if (candidateUnit.orderLineId && candidateUnit.orderLineId !== line.id) {
      throw new BusinessRuleError(
        'الغرفة مرتبطة بالفعل ببند أمر إنتاج آخر ولا يمكن حجزها أو ربطها مرتين',
        'PRODUCTION_UNIT_ALREADY_LINKED'
      );
    }
    if (candidateUnit.orderLineId === line.id) {
      throw new BusinessRuleError(
        'الغرفة مرتبطة بالفعل بهذا البند ولا يجوز إعادة احتسابها أو ربطها مرتين',
        'PRODUCTION_UNIT_ALREADY_LINKED'
      );
    }

    // 3. Fundamental Template Match
    const candidateTemplateId = candidateUnit.plan?.templateId || candidateUnit.templateId;
    if (!candidateTemplateId) {
      throw new BusinessRuleError(
        'تعذر التحقق من قالب الغرفة في سجلها التنفيذي المعتمد',
        'PRODUCTION_UNIT_TEMPLATE_MISSING'
      );
    }
    if (candidateTemplateId !== line.templateId) {
      throw new BusinessRuleError(
        'قالب الغرفة غير متطابق مع قالب بند مذكرة الإنتاج المطلوب',
        'PRODUCTION_UNIT_TEMPLATE_MISMATCH'
      );
    }

    // 4. Pattern & Option Choices Match
    if (line.activeConfigurationHash) {
      if (candidateUnit.plan?.configurationHash) {
        if (candidateUnit.plan.configurationHash !== line.activeConfigurationHash) {
          throw new BusinessRuleError(
            'خيارات الأنماط للغرفة غير متوافقة مع أنماط البند المحدد',
            'PRODUCTION_UNIT_PATTERN_MISMATCH'
          );
        }
      } else if (candidateUnit.plan?.patternSummary) {
        const candidateRefs = candidateUnit.plan.patternSummary.map((s) => ({
          templatePatternId: s.patternId,
          selectedOptionId: s.optionId,
        }));
        const candidateHash = hashLineConfiguration(candidateTemplateId, candidateRefs);
        if (candidateHash !== line.activeConfigurationHash) {
          throw new BusinessRuleError(
            'خيارات الأنماط للغرفة غير متوافقة مع أنماط البند المحدد',
            'PRODUCTION_UNIT_PATTERN_MISMATCH'
          );
        }
      } else {
        // Missing pattern data on candidate unit when line has active pattern configuration
        throw new BusinessRuleError(
          'بيانات الأنماط غير متوفرة في السجل التنفيذي للغرفة للتحقق من توافقها',
          'PRODUCTION_UNIT_PATTERN_DATA_MISSING'
        );
      }
    }

    // 5. Mandatory Technical Specifications Match
    if (lineTemplateSpecifications && lineTemplateSpecifications.length > 0) {
      if (!candidateUnit.plan?.specifications || candidateUnit.plan.specifications.length === 0) {
        throw new BusinessRuleError(
          'المواصفات الفنية للغرفة غير متوفرة في سجلها التنفيذي لإثبات التوافق',
          'PRODUCTION_UNIT_SPECIFICATION_DATA_MISSING'
        );
      }

      const candidateSpecMap = new Map(
        candidateUnit.plan.specifications.map((s) => [s.name.trim().toLowerCase(), s.value.trim()])
      );

      for (const lineSpec of lineTemplateSpecifications) {
        const candidateValue = candidateSpecMap.get(lineSpec.name.trim().toLowerCase());
        if (candidateValue === undefined) {
          throw new BusinessRuleError(
            `المواصفة الفنية الإلزامية "${lineSpec.name}" غير متوفرة في سجل الغرفة`,
            'PRODUCTION_UNIT_SPECIFICATION_MISMATCH'
          );
        }
        if (candidateValue !== lineSpec.value.trim()) {
          throw new BusinessRuleError(
            `المواصفات الفنية للغرفة غير متطابقة مع مواصفات البند (${lineSpec.name}: المطلوب "${lineSpec.value}", الغرفة "${candidateValue}")`,
            'PRODUCTION_UNIT_SPECIFICATION_MISMATCH'
          );
        }
      }
    }
  }

  /**
   * Atomic Quantity Enforcement & Real Database Unit Linking.
   *
   * Invariants:
   * 1. Requires valid authentication context (fails closed otherwise).
   * 2. Evaluates PRODUCTION_ORDER_LINE_ALLOCATE_UNITS permission and row-level access scoping.
   * 3. Database is the single source of truth: strictly links real rows from production_unit.
   * 4. Single-table pessimistic write lock on target line to serialize allocations without deadlocks.
   * 5. Checks line quota: currentLinked + toLink <= line.quantity.
   * 6. Verifies candidate units compatibility & yard scoping before any mutation.
   * 7. Transactional atomic commit/rollback.
   * 8. Re-queries and verifies actual count directly from MySQL before return.
   */
  async allocateAndLinkUnits(params: AllocateAndLinkUnitsParams): Promise<AllocateAndLinkUnitsResult> {
    const { orderLineId, candidateUnitIds, currentUser, correlationId } = params;

    // Reject phantom / unsupported parameters
    if (params.quantityToReserveOnly !== undefined) {
      throw new BusinessRuleError(
        'حجز الكميات بدون ربط غرف فعلية غير مدعوم في هذه المرحلة',
        'RESERVATION_NOT_SUPPORTED'
      );
    }
    if (params.unitsToCreateCount !== undefined) {
      throw new BusinessRuleError(
        'إنشاء الغرف من خدمة التخصيص غير مدعوم في هذه المرحلة',
        'UNIT_CREATION_NOT_SUPPORTED'
      );
    }
    if (params.candidateUnits !== undefined && (!candidateUnitIds || candidateUnitIds.length === 0)) {
      throw new BusinessRuleError(
        'يجب تقديم معرفات الغرف الفعلية المراد ربطها من قاعدة البيانات',
        'PRODUCTION_UNITS_REAL_IDS_REQUIRED'
      );
    }

    // 1. Authentication context check (No optional authentication for mutations)
    if (!currentUser) {
      throw new ForbiddenError(
        'يجب توفير سياق المصادقة لتنفيذ عملية تخصيص الغرف',
        'AUTHENTICATION_REQUIRED'
      );
    }

    // 2. Authorization check
    let policy: any = null;
    let operatorUserId: string | null = null;

    if ('isInternalTrusted' in currentUser && currentUser.isInternalTrusted) {
      operatorUserId = currentUser.operatorUserId || null;
    } else {
      const principal = currentUser as AuthPrincipal;
      operatorUserId = principal.id;

      const rules = await this.authzService.getApplicableAccessRules(
        principal,
        SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS
      );
      const responsibility = await this.respResolver.resolve(principal);
      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS
      );

      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError(
          'ليس لديك صلاحية لتخصيص أو ربط غرف الإنتاج',
          'AUTHORIZATION_DENIED'
        );
      }
    }

    // Validate candidate unit IDs in request
    if (!candidateUnitIds || candidateUnitIds.length === 0) {
      throw new BusinessRuleError(
        'يجب تحديد معرفات الغرف المراد ربطها',
        'NO_CANDIDATE_UNITS_PROVIDED'
      );
    }

    const idSet = new Set(candidateUnitIds);
    if (idSet.size !== candidateUnitIds.length) {
      throw new BusinessRuleError(
        'تكرار معرفات الغرف في طلب الربط والتخصيص',
        'PRODUCTION_UNIT_DUPLICATE_IN_REQUEST'
      );
    }

    // Execute in transaction with clean single-row locking
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const unitRepo = manager.getRepository(ProductionUnitEntity);
      const eventRepo = manager.getRepository(ProductionUnitEventEntity);

      // 3. Lock ONLY the target line row (pessimistic write without joins to prevent MySQL table-level lock escalation)
      const line = await lineRepo.findOne({
        where: { id: orderLineId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!line) {
        throw new NotFoundError(
          'بند أمر الإنتاج غير موجود أو تم أرشفته',
          'PRODUCTION_ORDER_LINE_NOT_FOUND'
        );
      }

      // Fetch order and template details without lock
      const order = await manager.getRepository(ProductionOrderEntity).findOne({
        where: { id: line.orderId, deletedAt: IsNull() },
      });

      if (!order || order.status !== ProductionOrderStatus.APPROVED) {
        throw new BusinessRuleError(
          'لا يمكن تخصيص أو ربط غرف ببند أمر إنتاج غير معتمد (يجب أن يكون في حالة مذكرة معتمدة)',
          'PRODUCTION_ORDER_NOT_APPROVED'
        );
      }

      const template = await manager.getRepository(ProductionTemplateEntity).findOne({
        where: { id: line.templateId, deletedAt: IsNull() },
        relations: { specifications: true },
      });
      const templateSpecifications = template?.specifications || [];

      // 4. Query current active non-cancelled linked units count from MySQL under lock
      const currentLinkedCount = await unitRepo.count({
        where: {
          orderLineId: line.id,
          isCancelled: false,
          status: Not(ProductionUnitStatus.CANCELLED),
          deletedAt: IsNull(),
        },
      });

      const requestedQuantity = line.quantity;
      const remainingCapacity = Math.max(0, requestedQuantity - currentLinkedCount);

      if (candidateUnitIds.length > remainingCapacity) {
        throw new BusinessRuleError(
          `لا يمكن تخصيص أو ربط ${candidateUnitIds.length} غرفة للبند. الكمية المتبقية المتاحة هي ${remainingCapacity} فقط من أصل ${requestedQuantity}`,
          'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED'
        );
      }

      // 5. Lock and load candidate units from database
      const candidateUnits = await unitRepo
        .createQueryBuilder('unit')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('unit.plan', 'plan')
        .leftJoinAndSelect('unit.currentYard', 'currentYard')
        .where('unit.id IN (:...candidateUnitIds)', { candidateUnitIds })
        .andWhere('unit.deletedAt IS NULL')
        .getMany();

      if (candidateUnits.length !== candidateUnitIds.length) {
        throw new NotFoundError(
          'إحدى الغرف المطلوبة غير موجودة في النظام أو تم حذفها',
          'PRODUCTION_UNIT_NOT_FOUND'
        );
      }

      // 6. Verify each unit's authorization scope and compatibility
      const eventsToSave: ProductionUnitEventEntity[] = [];
      const now = new Date();
      const batchCorrelationId = correlationId || randomUUID();

      for (const unit of candidateUnits) {
        // Yard-level row authorization check
        if (policy && !canAccessUnit(policy, unit)) {
          throw new ForbiddenError(
            'ليس لديك صلاحية للوصول إلى الغرفة في ساحتها',
            'AUTHORIZATION_DENIED'
          );
        }

        // Strict compatibility check
        this.verifyCandidateUnitCompatibility(line, unit, templateSpecifications);

        const previousOrderLineId = unit.orderLineId;
        const previousOrderId = unit.orderId;

        // Mutate link
        unit.orderLineId = line.id;
        unit.orderId = line.orderId;
        unit.updatedAt = now;

        const event = eventRepo.create({
          id: randomUUID(),
          unitId: unit.id,
          eventType: ProductionUnitEventType.UNIT_LINKED,
          createdByUserId: operatorUserId,
          occurredAt: now,
          departmentId: null,
          executionTaskId: null,
          previousData: {
            orderId: previousOrderId,
            orderLineId: previousOrderLineId,
          },
          newData: {
            orderId: line.orderId,
            orderLineId: line.id,
            lineSortOrder: line.sortOrder,
          },
          correlationId: batchCorrelationId,
          metadata: {
            orderNumber: order.orderNumber,
            lineSortOrder: line.sortOrder,
            templateId: line.templateId,
          },
          createdAt: now,
        });

        eventsToSave.push(event);
      }

      // Persist mutations atomically
      await unitRepo.save(candidateUnits);
      await eventRepo.save(eventsToSave);

      // 7. Re-query actual count from MySQL database to guarantee truth
      const actualLinkedCountAfter = await unitRepo.count({
        where: {
          orderLineId: line.id,
          isCancelled: false,
          status: Not(ProductionUnitStatus.CANCELLED),
          deletedAt: IsNull(),
        },
      });

      if (actualLinkedCountAfter > requestedQuantity) {
        throw new BusinessRuleError(
          `تم تجاوز الكمية المعتمدة للبند (#${line.sortOrder}): المرتبط الفعلي أصبح ${actualLinkedCountAfter} من أصل ${requestedQuantity}`,
          'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED'
        );
      }

      const updatedQuantities = calculateLineQuantities(requestedQuantity, actualLinkedCountAfter);

      return {
        orderLineId: line.id,
        orderId: line.orderId,
        previousLinkedQuantity: currentLinkedCount,
        newLinkedQuantity: actualLinkedCountAfter,
        remainingQuantity: updatedQuantities.remainingQuantity,
        excessQuantity: updatedQuantities.excessQuantity,
        hasQuantityViolation: updatedQuantities.hasQuantityViolation,
        linkedUnitIds: candidateUnits.map((u) => u.id),
      };
    });
  }

  /**
   * Restores a previously cancelled unit to active status under the line row lock.
   * Strictly enforces that restoring the unit does not cause linked units to exceed requestedQuantity.
   */
  async restoreCancelledUnit(params: RestoreCancelledUnitParams): Promise<RestoreCancelledUnitResult> {
    const { orderLineId, unitId, currentUser, reason } = params;

    // 1. Authentication check
    if (!currentUser) {
      throw new ForbiddenError(
        'يجب توفير سياق المصادقة لاستعادة الغرفة الملغاة',
        'AUTHENTICATION_REQUIRED'
      );
    }

    // 2. Authorization check
    let policy: any = null;
    let operatorUserId: string | null = null;

    if ('isInternalTrusted' in currentUser && currentUser.isInternalTrusted) {
      operatorUserId = currentUser.operatorUserId || null;
    } else {
      const principal = currentUser as AuthPrincipal;
      operatorUserId = principal.id;

      const rules = await this.authzService.getApplicableAccessRules(
        principal,
        SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS
      );
      const responsibility = await this.respResolver.resolve(principal);
      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_LINE_ALLOCATE_UNITS
      );

      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError(
          'ليس لديك صلاحية لاستعادة الغرفة الملغاة',
          'AUTHORIZATION_DENIED'
        );
      }
    }

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const unitRepo = manager.getRepository(ProductionUnitEntity);
      const eventRepo = manager.getRepository(ProductionUnitEventEntity);

      // Lock order line row (single row lock)
      const line = await lineRepo.findOne({
        where: { id: orderLineId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!line) {
        throw new NotFoundError(
          'بند أمر الإنتاج غير موجود أو تم أرشفته',
          'PRODUCTION_ORDER_LINE_NOT_FOUND'
        );
      }

      // Check order status
      const order = await manager.getRepository(ProductionOrderEntity).findOne({
        where: { id: line.orderId, deletedAt: IsNull() },
      });

      if (!order || order.status !== ProductionOrderStatus.APPROVED) {
        throw new BusinessRuleError(
          'لا يمكن استعادة غرفة لبند أمر إنتاج غير معتمد',
          'PRODUCTION_ORDER_NOT_APPROVED'
        );
      }

      // Lock unit row
      const unit = await unitRepo.findOne({
        where: { id: unitId, orderLineId: line.id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
        relations: { currentYard: true },
      });

      if (!unit) {
        throw new NotFoundError(
          'الغرفة غير موجودة في هذا البند',
          'PRODUCTION_UNIT_NOT_FOUND'
        );
      }

      if (!unit.isCancelled && unit.status !== ProductionUnitStatus.CANCELLED) {
        throw new BusinessRuleError(
          'الغرفة ليست في حالة إلغاء ولا تحتاج استعادة',
          'PRODUCTION_UNIT_NOT_CANCELLED'
        );
      }

      // Yard authorization check
      if (policy && !canAccessUnit(policy, unit)) {
        throw new ForbiddenError(
          'ليس لديك صلاحية للوصول إلى الغرفة في ساحتها',
          'AUTHORIZATION_DENIED'
        );
      }

      // Count currently active units under lock
      const activeLinkedCount = await unitRepo.count({
        where: {
          orderLineId: line.id,
          isCancelled: false,
          status: Not(ProductionUnitStatus.CANCELLED),
          deletedAt: IsNull(),
        },
      });

      // Capacity check: activeLinkedCount + 1 <= line.quantity
      if (activeLinkedCount + 1 > line.quantity) {
        throw new BusinessRuleError(
          `لا يمكن استعادة الغرفة الملغاة لتجاوز الكمية المعتمدة للبند (المطلوب: ${line.quantity}, النشط حالياً: ${activeLinkedCount})`,
          'PRODUCTION_UNIT_RESTORE_QUANTITY_EXCEEDED'
        );
      }

      const now = new Date();
      const previousStatus = unit.status;
      const previousReason = unit.cancellationReason;

      unit.isCancelled = false;
      unit.cancelledAt = null;
      unit.cancellationReason = null;
      unit.status = ProductionUnitStatus.CREATED;
      unit.updatedAt = now;

      await unitRepo.save(unit);

      // Audit event
      const event = eventRepo.create({
        id: randomUUID(),
        unitId: unit.id,
        eventType: ProductionUnitEventType.UNIT_RESTORED,
        createdByUserId: operatorUserId,
        occurredAt: now,
        departmentId: null,
        executionTaskId: null,
        previousData: {
          isCancelled: true,
          status: previousStatus,
          cancellationReason: previousReason,
        },
        newData: {
          isCancelled: false,
          status: ProductionUnitStatus.CREATED,
          restoreReason: reason || null,
        },
        correlationId: randomUUID(),
        metadata: {
          orderLineId: line.id,
          orderNumber: order.orderNumber,
        },
        createdAt: now,
      });

      await eventRepo.save(event);

      // Re-query actual count from DB
      const newLinkedQuantity = await unitRepo.count({
        where: {
          orderLineId: line.id,
          isCancelled: false,
          status: Not(ProductionUnitStatus.CANCELLED),
          deletedAt: IsNull(),
        },
      });

      const updatedQuantities = calculateLineQuantities(line.quantity, newLinkedQuantity);

      return {
        unitId: unit.id,
        orderLineId: line.id,
        status: unit.status,
        isCancelled: unit.isCancelled,
        newLinkedQuantity,
        remainingQuantity: updatedQuantities.remainingQuantity,
      };
    });
  }
}

export const productionOrderLineAllocationService = new ProductionOrderLineAllocationService();
