import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull, Not } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionOrderEntity, ProductionOrderStatus } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from './production-order-line.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../unit/production-unit.entity.js';
import { ProductionUnitEventEntity, ProductionUnitEventType } from '../unit/production-unit-event.entity.js';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
import {
  ProductionExecutionPlanEntity,
  ExecutionPlanSpecificationSnapshot,
} from '../execution-plan/production-execution-plan.entity.js';
import {
  calculateLineQuantities,
  ProductionLineQuantities,
} from './production-order-line-quantity.helper.js';
import { canonicalizeLineConfiguration, hashLineConfiguration } from './production-order-line-configuration.helper.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import {
  authorizationService,
  AuthorizationService,
} from '../../system/authorization/authorization.service.js';
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

export interface AllocateAndLinkUnitsParams {
  orderLineId: string;
  candidateUnitIds?: string[];
  candidateUnits?: CandidateUnitLike[];
  unitsToCreateCount?: number;
  quantityToReserveOnly?: number;
  currentUser?: AuthPrincipal;
  userId?: string;
  correlationId?: string;
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
  currentUser?: AuthPrincipal;
  userId?: string;
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
    private authzService: AuthorizationService = authorizationService
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
   * Verifies candidate unit compatibility against an order line:
   * 1. Room is not cancelled or soft-deleted.
   * 2. Room is not already linked to another line (prevents double booking).
   * 3. Fundamental template identity matches.
   * 4. Pattern & option choices match (via activeConfigurationHash or canonical pattern selections).
   * 5. Mandatory technical specifications match.
   *
   * Fails closed with specific BusinessRuleError codes.
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

    // 2. Check Double Booking
    if (candidateUnit.orderLineId && candidateUnit.orderLineId !== line.id) {
      throw new BusinessRuleError(
        'الغرفة مرتبطة بالفعل ببند أمر إنتاج آخر ولا يمكن حجزها أو ربطها مرتين',
        'PRODUCTION_UNIT_ALREADY_LINKED'
      );
    }

    // 3. Fundamental Template Match
    const candidateTemplateId = candidateUnit.plan?.templateId || candidateUnit.templateId;
    if (candidateTemplateId && candidateTemplateId !== line.templateId) {
      throw new BusinessRuleError(
        'قالب الغرفة غير متطابق مع قالب بند مذكرة الإنتاج المطلوب',
        'PRODUCTION_UNIT_TEMPLATE_MISMATCH'
      );
    }

    // 4. Pattern & Option Choices Match
    if (candidateUnit.plan?.configurationHash && line.activeConfigurationHash) {
      if (candidateUnit.plan.configurationHash !== line.activeConfigurationHash) {
        throw new BusinessRuleError(
          'خيارات الأنماط للغرفة غير متوافقة مع أنماط البند المحدد',
          'PRODUCTION_UNIT_PATTERN_MISMATCH'
        );
      }
    } else if (candidateUnit.plan?.patternSummary) {
      // Canonical comparison from pattern summary
      const candidateSummary = candidateUnit.plan.patternSummary;
      const candidateRefs = candidateSummary.map((s) => ({
        templatePatternId: s.patternId,
        selectedOptionId: s.optionId,
      }));
      const candidateHash = hashLineConfiguration(candidateTemplateId || line.templateId, candidateRefs);
      if (line.activeConfigurationHash && candidateHash !== line.activeConfigurationHash) {
        throw new BusinessRuleError(
          'خيارات الأنماط للغرفة غير متوافقة مع أنماط البند المحدد',
          'PRODUCTION_UNIT_PATTERN_MISMATCH'
        );
      }
    } else if (line.patternSelections && line.patternSelections.length > 0) {
      // If the line has explicit pattern selections but the candidate unit has none -> mismatch
      if (!candidateUnit.plan || !candidateUnit.plan.configurationHash) {
        throw new BusinessRuleError(
          'خيارات الأنماط للغرفة غير متوافقة مع أنماط البند المحدد',
          'PRODUCTION_UNIT_PATTERN_MISMATCH'
        );
      }
    }

    // 5. Mandatory Technical Specifications Match
    if (
      lineTemplateSpecifications &&
      lineTemplateSpecifications.length > 0 &&
      candidateUnit.plan?.specifications &&
      candidateUnit.plan.specifications.length > 0
    ) {
      const candidateSpecMap = new Map(
        candidateUnit.plan.specifications.map((s) => [s.name.trim().toLowerCase(), s.value.trim()])
      );

      for (const lineSpec of lineTemplateSpecifications) {
        const candidateValue = candidateSpecMap.get(lineSpec.name.trim().toLowerCase());
        if (candidateValue !== undefined && candidateValue !== lineSpec.value.trim()) {
          throw new BusinessRuleError(
            `المواصفات الفنية للغرفة غير متطابقة مع مواصفات البند (${lineSpec.name}: المطلوب "${lineSpec.value}", الغرفة "${candidateValue}")`,
            'PRODUCTION_UNIT_SPECIFICATION_MISMATCH'
          );
        }
      }
    }
  }

  /**
   * Atomic Quantity Enforcement & Unit Linking Entry Point.
   *
   * Executes inside a MySQL database transaction with a pessimistic write lock
   * on the target ProductionOrderLineEntity row to serialize concurrent allocations.
   *
   * Steps:
   * 1. Validate user permissions if provided.
   * 2. Lock the target order line row (pessimistic_write / SELECT FOR UPDATE).
   * 3. Read latest line quantity and verify order is APPROVED.
   * 4. Query count of linked non-cancelled units directly from MySQL under the lock.
   * 5. Ensure linkedCount + candidateUnitsCount <= requestedQuantity (fail closed otherwise).
   * 6. Verify candidate unit compatibility (cancellation, double-booking, template, patterns, specs).
   * 7. Link units, update database, log audit events.
   * 8. Commit transaction (or atomic rollback on any failure).
   */
  async allocateAndLinkUnits(params: AllocateAndLinkUnitsParams): Promise<AllocateAndLinkUnitsResult> {
    const { orderLineId, candidateUnitIds, candidateUnits, quantityToReserveOnly, currentUser, userId, correlationId } = params;

    // 1. Permission check if principal provided
    if (currentUser) {
      const rules = await this.authzService.getApplicableAccessRules(
        currentUser,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      const isSystemAdmin = rules.some((r) => r.scopeType === 'ALL' && r.effect === 'ALLOW');
      if (rules.length === 0 && !isSystemAdmin) {
        throw new ForbiddenError('ليس لديك صلاحية لتعديل أو تخصيص بنود مذكرة الإنتاج', 'AUTHORIZATION_DENIED');
      }
    }

    // Execute in transaction
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const unitRepo = manager.getRepository(ProductionUnitEntity);
      const eventRepo = manager.getRepository(ProductionUnitEventEntity);

      // 2. Lock the target line row (Pessimistic Write)
      const line = await lineRepo
        .createQueryBuilder('line')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('line.order', 'order')
        .leftJoinAndSelect('line.patternSelections', 'patternSelections')
        .leftJoinAndSelect('line.template', 'template')
        .leftJoinAndSelect('template.specifications', 'specifications')
        .where('line.id = :orderLineId', { orderLineId })
        .andWhere('line.deletedAt IS NULL')
        .getOne();

      if (!line) {
        throw new NotFoundError('بند أمر الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      // 3. Verify order is APPROVED
      if (line.order?.status !== ProductionOrderStatus.APPROVED) {
        throw new BusinessRuleError(
          'لا يمكن تخصيص أو ربط غرف ببند أمر إنتاج غير معتمد (يجب أن يكون في حالة مذكرة معتمدة)',
          'PRODUCTION_ORDER_NOT_APPROVED'
        );
      }

      // 4. Query current active non-cancelled linked units count under lock
      const currentLinkedCount = await unitRepo
        .createQueryBuilder('unit')
        .where('unit.orderLineId = :lineId', { lineId: line.id })
        .andWhere('unit.isCancelled = :isCancelled', { isCancelled: false })
        .andWhere('unit.status != :cancelledStatus', { cancelledStatus: ProductionUnitStatus.CANCELLED })
        .andWhere('unit.deletedAt IS NULL')
        .getCount();

      // Determine units count to add
      const unitIdsList = candidateUnitIds || [];
      const unitsList = candidateUnits || [];

      // Check for duplicate unit IDs in request
      if (unitIdsList.length > 0) {
        const idSet = new Set(unitIdsList);
        if (idSet.size !== unitIdsList.length) {
          throw new BusinessRuleError(
            'تكرار معرفات الغرف في طلب الربط والتخصيص',
            'PRODUCTION_UNIT_DUPLICATE_IN_REQUEST'
          );
        }
      }

      const unitsCountToAdd = unitsList.length > 0
        ? unitsList.length
        : unitIdsList.length > 0
        ? unitIdsList.length
        : (params.unitsToCreateCount || quantityToReserveOnly || 0);

      const requestedQuantity = line.quantity;
      const remainingBefore = Math.max(0, requestedQuantity - currentLinkedCount);

      // 5. Strictly enforce line quantity limit
      if (unitsCountToAdd > remainingBefore) {
        throw new BusinessRuleError(
          `لا يمكن تخصيص أو ربط ${unitsCountToAdd} غرفة للبند. الكمية المتبقية المتاحة هي ${remainingBefore} فقط من أصل ${requestedQuantity}`,
          'PRODUCTION_ORDER_LINE_QUANTITY_EXCEEDED'
        );
      }

      const linkedUnitIds: string[] = [];
      const now = new Date();
      const batchCorrelationId = correlationId || randomUUID();
      const operatorUserId = userId || currentUser?.id || null;

      // 6. If concrete unit IDs provided, load and verify each unit
      if (unitIdsList.length > 0) {
        const unitsFromDb = await unitRepo
          .createQueryBuilder('unit')
          .setLock('pessimistic_write')
          .leftJoinAndSelect('unit.plan', 'plan')
          .where('unit.id IN (:...unitIds)', { unitIds: unitIdsList })
          .andWhere('unit.deletedAt IS NULL')
          .getMany();

        if (unitsFromDb.length !== unitIdsList.length) {
          throw new NotFoundError(
            'إحدى الغرف المطلوبة غير موجودة في النظام أو تم حذفها',
            'PRODUCTION_UNIT_NOT_FOUND'
          );
        }

        const eventsToSave: ProductionUnitEventEntity[] = [];

        for (const unit of unitsFromDb) {
          // Verify compatibility
          this.verifyCandidateUnitCompatibility(line, unit, line.template?.specifications);

          const previousOrderLineId = unit.orderLineId;
          const previousOrderId = unit.orderId;

          // Mutate unit link
          unit.orderLineId = line.id;
          unit.orderId = line.orderId;
          unit.updatedAt = now;

          linkedUnitIds.push(unit.id);

          // Audit event
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
              orderNumber: line.order?.orderNumber,
              lineSortOrder: line.sortOrder,
              templateId: line.templateId,
            },
            createdAt: now,
          });

          eventsToSave.push(event);
        }

        await unitRepo.save(unitsFromDb);
        await eventRepo.save(eventsToSave);
      } else if (unitsList.length > 0) {
        // If candidate unit objects were passed in
        for (const candidate of unitsList) {
          this.verifyCandidateUnitCompatibility(line, candidate, line.template?.specifications);
          linkedUnitIds.push(candidate.id);
        }
      } else if (params.unitsToCreateCount && params.unitsToCreateCount > 0) {
        const plan = await manager.getRepository(ProductionExecutionPlanEntity).findOne({
          where: { orderLineId: line.id },
        });

        const newUnits: ProductionUnitEntity[] = [];
        const newEvents: ProductionUnitEventEntity[] = [];

        for (let i = 1; i <= params.unitsToCreateCount; i++) {
          const seq = currentLinkedCount + i;
          const unitId = randomUUID();
          const unitNumber = `${line.order?.orderNumber || 'PO'}-L${line.sortOrder}-U${String(seq).padStart(3, '0')}`;

          const unit = unitRepo.create({
            id: unitId,
            orderId: line.orderId,
            orderLineId: line.id,
            planId: plan?.id || randomUUID(),
            unitSequence: seq,
            unitNumber,
            code: null,
            currentYardId: null,
            status: ProductionUnitStatus.CREATED,
            isCancelled: false,
            createdAt: now,
            updatedAt: now,
          });

          const event = eventRepo.create({
            id: randomUUID(),
            unitId,
            eventType: ProductionUnitEventType.UNIT_CREATED,
            createdByUserId: operatorUserId,
            occurredAt: now,
            departmentId: null,
            executionTaskId: null,
            previousData: null,
            newData: {
              orderLineId: line.id,
              orderId: line.orderId,
              unitSequence: seq,
              unitNumber,
            },
            correlationId: batchCorrelationId,
            createdAt: now,
          });

          newUnits.push(unit);
          newEvents.push(event);
          linkedUnitIds.push(unitId);
        }

        await unitRepo.save(newUnits);
        await eventRepo.save(newEvents);
      }

      const newLinkedQuantity = currentLinkedCount + unitsCountToAdd;
      const updatedQuantities = calculateLineQuantities(requestedQuantity, newLinkedQuantity);

      return {
        orderLineId: line.id,
        orderId: line.orderId,
        previousLinkedQuantity: currentLinkedCount,
        newLinkedQuantity,
        remainingQuantity: updatedQuantities.remainingQuantity,
        excessQuantity: updatedQuantities.excessQuantity,
        hasQuantityViolation: updatedQuantities.hasQuantityViolation,
        linkedUnitIds,
      };
    });
  }

  /**
   * Restores a previously cancelled unit to active status under the line row lock.
   * Strictly enforces that restoring the unit does not cause linked units to exceed requestedQuantity.
   */
  async restoreCancelledUnit(params: RestoreCancelledUnitParams): Promise<RestoreCancelledUnitResult> {
    const { orderLineId, unitId, currentUser, userId, reason } = params;

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const unitRepo = manager.getRepository(ProductionUnitEntity);
      const eventRepo = manager.getRepository(ProductionUnitEventEntity);

      // Lock order line row
      const line = await lineRepo
        .createQueryBuilder('line')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('line.order', 'order')
        .where('line.id = :orderLineId', { orderLineId })
        .andWhere('line.deletedAt IS NULL')
        .getOne();

      if (!line) {
        throw new NotFoundError('بند أمر الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      // Fetch the unit under lock
      const unit = await unitRepo.findOne({
        where: { id: unitId, orderLineId: line.id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!unit) {
        throw new NotFoundError('الغرفة غير موجودة في هذا البند', 'PRODUCTION_UNIT_NOT_FOUND');
      }

      if (!unit.isCancelled && unit.status !== ProductionUnitStatus.CANCELLED) {
        throw new BusinessRuleError('الغرفة ليست في حالة إلغاء ولا تحتاج استعادة', 'PRODUCTION_UNIT_NOT_CANCELLED');
      }

      // Count currently active units under lock
      const activeLinkedCount = await unitRepo
        .createQueryBuilder('unit')
        .where('unit.orderLineId = :lineId', { lineId: line.id })
        .andWhere('unit.isCancelled = :isCancelled', { isCancelled: false })
        .andWhere('unit.status != :cancelledStatus', { cancelledStatus: ProductionUnitStatus.CANCELLED })
        .andWhere('unit.deletedAt IS NULL')
        .getCount();

      // Check remaining capacity: restoring 1 unit requires activeLinkedCount + 1 <= line.quantity
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
        createdByUserId: userId || currentUser?.id || null,
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
          orderNumber: line.order?.orderNumber,
        },
        createdAt: now,
      });

      await eventRepo.save(event);

      const newLinkedQuantity = activeLinkedCount + 1;
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
