import { randomUUID } from 'node:crypto';
import { ProductionExecutionPlanEntity } from '../execution-plan/production-execution-plan.entity.js';
import { ProductionExecutionTaskEntity } from '../execution-plan/production-execution-task.entity.js';
import { ProductionUnitEntity, ProductionUnitStatus } from '../unit/production-unit.entity.js';
import { ProductionUnitEventEntity } from '../unit/production-unit-event.entity.js';
import {
  ProductionExecutionPlanService,
  productionExecutionPlanService,
} from '../execution-plan/production-execution-plan.service.js';
import {
  ProductionUnitService,
  productionUnitService,
} from '../unit/production-unit.service.js';
import { DataSource, EntityManager, Repository, IsNull, In, Not } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionOrderEntity, ProductionOrderStatus, ProductionOrderPriority } from './production-order.entity.js';
import { ProductionOrderSequenceEntity } from './production-order-sequence.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';
import {
  ProductionOrderDto,
  PaginatedProductionOrdersResult,
  ProductionOrderListItemDto,
  ProductionOrderListSummaryDto,
  ProductionOrderReadinessDto,
  ProductionOrderReadinessIssueDto,
  SyncDraftLinePreviewDto,
  SyncPreviewPatternDto,
  SyncPreviewAvailableOptionDto,
} from './production-order.types.js';
import { ProductionOrderLineDto } from '../order-line/production-order-line.types.js';
import { CreateProductionOrderDto } from './dto/create-production-order.dto.js';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto.js';
import { UpdateProductionOrderPriorityDto } from './dto/update-production-order-priority.dto.js';
import { ListProductionOrdersQueryDto } from './dto/list-production-orders-query.dto.js';
import { AddProductionOrderLineDto } from '../order-line/dto/add-production-order-line.dto.js';
import { BatchAddProductionOrderLinesDto } from '../order-line/dto/batch-add-production-order-lines.dto.js';
import { UpdateProductionOrderLineDto } from '../order-line/dto/update-production-order-line.dto.js';
import { ReorderProductionOrderLinesDto } from '../order-line/dto/reorder-production-order-lines.dto.js';
import { CommitProductionOrderDraftLinesDto } from '../order-line/dto/commit-production-order-draft-lines.dto.js';
import { UpdatePatternSelectionDto } from '../order-line-pattern-selection/dto/update-pattern-selection.dto.js';
import { hashLineConfiguration } from '../order-line/production-order-line-configuration.helper.js';
import { calculateLineQuantities } from '../order-line/production-order-line-quantity.helper.js';
import {
  ProductionOrderGuardService,
  productionOrderGuardService,
} from './production-order-guard.service.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { NotFoundError } from '../../../common/errors/not-found.error.js';

export class ProductionOrderService {
  private orderRepo: Repository<ProductionOrderEntity>;
  private lineRepo: Repository<ProductionOrderLineEntity>;
  private selectionRepo: Repository<ProductionOrderLinePatternSelectionEntity>;
  private templateRepo: Repository<ProductionTemplateEntity>;
  private patternRepo: Repository<ProductionTemplatePatternEntity>;
  private optionRepo: Repository<ProductionTemplatePatternOptionEntity>;
  private workflowItemRepo: Repository<ProductionTemplateWorkflowItemEntity>;
  private guardService: ProductionOrderGuardService;
  private executionPlanService: ProductionExecutionPlanService;
  private unitService: ProductionUnitService;

  constructor(
    private dataSource: DataSource = AppDataSource,
    guardService: ProductionOrderGuardService = productionOrderGuardService,
    executionPlanService: ProductionExecutionPlanService = productionExecutionPlanService,
    unitService: ProductionUnitService = productionUnitService
  ) {
    this.orderRepo = this.dataSource.getRepository(ProductionOrderEntity);
    this.lineRepo = this.dataSource.getRepository(ProductionOrderLineEntity);
    this.selectionRepo = this.dataSource.getRepository(ProductionOrderLinePatternSelectionEntity);
    this.templateRepo = this.dataSource.getRepository(ProductionTemplateEntity);
    this.patternRepo = this.dataSource.getRepository(ProductionTemplatePatternEntity);
    this.optionRepo = this.dataSource.getRepository(ProductionTemplatePatternOptionEntity);
    this.workflowItemRepo = this.dataSource.getRepository(ProductionTemplateWorkflowItemEntity);
    this.guardService = guardService;
    this.executionPlanService = executionPlanService;
    this.unitService = unitService;
  }

  // ==========================================
  // 1. ORDER LIFECYCLE & MUTATIONS
  // ==========================================

  /**
   * Creates a new DRAFT production order with a concurrency-safe unique order number.
   */
  async createOrder(
    dto: CreateProductionOrderDto,
    userId: string
  ): Promise<ProductionOrderDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Generate human-readable order number atomically using sequence row lock
      const seqRepo = manager.getRepository(ProductionOrderSequenceEntity);
      const seq = await seqRepo.findOne({
        where: { id: 'PRODUCTION_ORDER' },
        lock: { mode: 'pessimistic_write' },
      });

      if (!seq) {
        throw new BusinessRuleError(
          'عداد تسلسل أوامر الإنتاج غير مهيأ في قاعدة البيانات',
          'PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED'
        );
      }

      const nextVal = BigInt(seq.currentValue || '0') + 1n;
      seq.currentValue = nextVal.toString();
      await seqRepo.save(seq);

      const orderNumber = `PO-${String(nextVal).padStart(6, '0')}`;

      // 2. Insert new DRAFT order
      const orderRepo = manager.getRepository(ProductionOrderEntity);
      const order = orderRepo.create({
        orderNumber,
        status: ProductionOrderStatus.DRAFT,
        priority: dto.priority ?? ProductionOrderPriority.NORMAL,
        description: dto.description?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdByUserId: userId,
      });

      const savedOrder = await orderRepo.save(order);

      // 3. Return DTO
      return this.getOrderByIdInternal(savedOrder.id, manager);
    });
  }

  /**
   * Lists production orders with server-side pagination and search.
   */
  async listOrders(
    query: ListProductionOrdersQueryDto
  ): Promise<PaginatedProductionOrdersResult> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.createdByUser', 'u')
      .leftJoinAndSelect('o.approvedByUser', 'ap')
      .where('o.deleted_at IS NULL');

    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim()}%`;
      qb.andWhere('(o.order_number LIKE :s OR o.description LIKE :s)', { s });
    }

    if (query.priority) {
      qb.andWhere('o.priority = :priority', { priority: query.priority });
    }

    qb.addSelect(
      `CASE o.priority
        WHEN 'CRITICAL' THEN 4
        WHEN 'HIGH' THEN 3
        WHEN 'NORMAL' THEN 2
        WHEN 'LOW' THEN 1
        ELSE 0
      END`,
      'priority_rank'
    )
      .orderBy('priority_rank', 'DESC')
      .addOrderBy('o.created_at', 'ASC')
      .addOrderBy('o.id', 'ASC')
      .skip(skip)
      .take(limit);

    const [orders, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    // Batch load active line counts and total quantities for returned orders
    const orderIds = orders.map((o) => o.id);
    const summaryMap = new Map<string, { lineCount: number; totalQuantity: number }>();

    if (orderIds.length > 0) {
      const rawSummaries = await this.lineRepo
        .createQueryBuilder('l')
        .select('l.order_id', 'orderId')
        .addSelect('COUNT(l.id)', 'lineCount')
        .addSelect('COALESCE(SUM(l.quantity), 0)', 'totalQuantity')
        .where('l.order_id IN (:...orderIds)', { orderIds })
        .andWhere('l.deleted_at IS NULL')
        .groupBy('l.order_id')
        .getRawMany();

      for (const row of rawSummaries) {
        summaryMap.set(row.orderId, {
          lineCount: parseInt(row.lineCount, 10) || 0,
          totalQuantity: parseInt(row.totalQuantity, 10) || 0,
        });
      }
    }

    const items: ProductionOrderListItemDto[] = orders.map((o) => {
      const summary = summaryMap.get(o.id) || { lineCount: 0, totalQuantity: 0 };
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        priority: o.priority,
        description: o.description,
        notes: o.notes,
        approvedAt: o.approvedAt,
        approvedByUser: o.approvedByUser
          ? {
              id: o.approvedByUser.id,
              fullName: o.approvedByUser.fullName,
            }
          : null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        createdByUser: o.createdByUser
          ? {
              id: o.createdByUser.id,
              fullName: o.createdByUser.fullName,
            }
          : undefined,
        summary,
      };
    });

    // Compute global summary aggregate across ALL matching orders under current search filter
    const summaryQb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('production_order_line', 'l', 'l.order_id = o.id AND l.deleted_at IS NULL')
      .where('o.deleted_at IS NULL');

    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim()}%`;
      summaryQb.andWhere('(o.order_number LIKE :s OR o.description LIKE :s)', { s });
    }

    if (query.priority) {
      summaryQb.andWhere('o.priority = :priority', { priority: query.priority });
    }

    const summaryRaw = await summaryQb
      .select('COUNT(DISTINCT o.id)', 'totalOrders')
      .addSelect("COUNT(DISTINCT CASE WHEN o.status = 'DRAFT' THEN o.id END)", 'draftOrders')
      .addSelect("COUNT(DISTINCT CASE WHEN o.status = 'APPROVED' THEN o.id END)", 'approvedOrders')
      .addSelect('COALESCE(SUM(l.quantity), 0)', 'totalQuantity')
      .getRawOne();

    const summary: ProductionOrderListSummaryDto = {
      totalOrders: parseInt(summaryRaw?.totalOrders || '0', 10) || 0,
      draftOrders: parseInt(summaryRaw?.draftOrders || '0', 10) || 0,
      approvedOrders: parseInt(summaryRaw?.approvedOrders || '0', 10) || 0,
      totalQuantity: parseInt(summaryRaw?.totalQuantity || '0', 10) || 0,
    };

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      summary,
    };
  }

  /**
   * Retrieves production order detail with all active lines and selections (Batch loaded, zero N+1).
   */
  async getOrderById(orderId: string): Promise<ProductionOrderDto> {
    return this.getOrderByIdInternal(orderId);
  }

  /**
   * Updates DRAFT production order header (description, notes). Status and orderNumber are immutable.
   */
  async updateOrder(
    orderId: string,
    dto: UpdateProductionOrderDto
  ): Promise<ProductionOrderDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock order row (Unified Lock Root)
      const order = await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Apply modifications explicitly
      if (dto.description !== undefined) {
        order.description = dto.description === null ? null : dto.description.trim() || null;
      }
      if (dto.notes !== undefined) {
        order.notes = dto.notes === null ? null : dto.notes.trim() || null;
      }

      await manager.save(order);

      return this.getOrderByIdInternal(orderId, manager);
    });
  }

  /**
   * Updates production order priority independently of status (works for DRAFT and APPROVED).
   * Does NOT mutate lines, header descriptions, or approval status.
   */
  async updatePriority(
    orderId: string,
    dto: UpdateProductionOrderPriorityDto
  ): Promise<ProductionOrderDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock existing active order pessimistically (not restricted to DRAFT)
      const order = await this.guardService.lockExistingOrder(orderId, manager);

      // 2. Assign priority
      order.priority = dto.priority;

      // 3. Save
      await manager.save(order);

      // 4. Return refreshed order DTO
      return this.getOrderByIdInternal(orderId, manager);
    });
  }

  /**
   * Archives (soft-deletes) a DRAFT production order.
   */
  async archiveOrder(orderId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock order row
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Soft-delete order
      await manager.softDelete(ProductionOrderEntity, orderId);
    });
  }

  // ==========================================
  // 2. ORDER LINES MANAGEMENT
  // ==========================================

  private validateLineQuantity(quantity: number): void {
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      throw new BusinessRuleError(
        'كمية بند أمر الإنتاج يجب أن تكون عدداً صحيحاً بين 1 و 10,000',
        'PRODUCTION_ORDER_LINE_QUANTITY_INVALID'
      );
    }
  }

  private async assertConfigurationAvailable(
    orderId: string,
    configurationHash: string,
    excludeLineId: string | undefined,
    manager: EntityManager
  ): Promise<void> {
    const lineRepo = manager.getRepository(ProductionOrderLineEntity);
    const where: any = {
      orderId,
      activeConfigurationHash: configurationHash,
      deletedAt: IsNull(),
    };
    if (excludeLineId) {
      where.id = Not(excludeLineId);
    }

    const existing = await lineRepo.findOne({
      where,
      select: { id: true },
    });

    if (existing) {
      throw new BusinessRuleError(
        'يوجد بند إنتاج آخر في هذا الطلب يستخدم نفس القالب ونفس خيارات الأنماط. عدّل كمية البند الموجود بدلاً من إضافة بند مكرر.',
        'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION',
        { existingLineId: existing.id }
      );
    }
  }

  /**
   * Resolves and validates line configuration, active patterns, and selections.
   */
  private async resolveLineConfigurationInternal(
    dto: AddProductionOrderLineDto,
    manager: EntityManager
  ): Promise<{
    templateId: string;
    quantity: number;
    selectionsToCreate: Array<{ templatePatternId: string; selectedOptionId: string }>;
    configHash: string;
  }> {
    this.validateLineQuantity(dto.quantity);

    // Validate Template exists, not archived, and is active
    const templateRepo = manager.getRepository(ProductionTemplateEntity);
    const template = await templateRepo.findOne({
      where: { id: dto.templateId, deletedAt: IsNull() },
    });

    if (!template) {
      throw new NotFoundError('القالب غير موجود', 'PRODUCTION_ORDER_TEMPLATE_NOT_FOUND');
    }

    if (!template.isActive) {
      throw new BusinessRuleError('لا يمكن إضافة قالب تصنيع غير فعال إلى طلب الإنتاج', 'PRODUCTION_ORDER_TEMPLATE_INACTIVE');
    }

    // Load active patterns and their active options
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const activePatterns = await patternRepo.find({
      where: { templateId: dto.templateId, deletedAt: IsNull() },
      relations: { options: true },
      order: { createdAt: 'ASC' },
    });

    // Filter active options and sort them
    const patternsWithOptions = activePatterns.map((p) => {
      const activeOptions = (p.options || [])
        .filter((opt) => !opt.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        pattern: p,
        options: activeOptions,
      };
    });

    // Verify that every active pattern has at least one active option
    for (const item of patternsWithOptions) {
      if (item.options.length === 0) {
        throw new BusinessRuleError(
          `النمط "${item.pattern.name}" لا يحتوي على أي خيارات فعالة`,
          'PRODUCTION_ORDER_TEMPLATE_PATTERN_HAS_NO_ACTIVE_OPTIONS'
        );
      }
    }

    // Resolve pattern selections: either explicit payload validation or system defaults
    const selectionsToCreate: Array<{ templatePatternId: string; selectedOptionId: string }> = [];

    if (dto.patternSelections !== undefined) {
      // Explicit payload provided: MUST be the exact set of active patterns
      const payload = dto.patternSelections;

      // Check for duplicates in payload
      const patternIdSet = new Set<string>();
      for (const item of payload) {
        if (patternIdSet.has(item.patternId)) {
          throw new BusinessRuleError(
            'لا يمكن تكرار اختيار نفس النمط في نفس البند',
            'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID'
          );
        }
        patternIdSet.add(item.patternId);
      }

      // Must match exact count and keys of active patterns
      if (patternIdSet.size !== patternsWithOptions.length) {
        throw new BusinessRuleError(
          'يجب تحديد خيار لكل نمط فعال في القالب بدقة',
          'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID'
        );
      }

      for (const item of patternsWithOptions) {
        if (!patternIdSet.has(item.pattern.id)) {
          throw new BusinessRuleError(
            `لم يتم إرسال خيار للنمط "${item.pattern.name}"`,
            'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID'
          );
        }
      }

      // Validate each selection: option belongs to pattern and is active
      for (const pSel of payload) {
        const matchedPatternItem = patternsWithOptions.find((p) => p.pattern.id === pSel.patternId);
        if (!matchedPatternItem) {
          throw new BusinessRuleError(
            'النمط المحدد لا ينتمي إلى هذا القالب',
            'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID'
          );
        }

        const matchedOption = matchedPatternItem.options.find((o) => o.id === pSel.optionId);
        if (!matchedOption) {
          throw new BusinessRuleError(
            'الخيار المحدد غير فعال أو لا يتبع هذا النمط',
            'PRODUCTION_ORDER_LINE_OPTION_INVALID'
          );
        }

        selectionsToCreate.push({
          templatePatternId: matchedPatternItem.pattern.id,
          selectedOptionId: matchedOption.id,
        });
      }
    } else {
      // No explicit payload: select default (first active option by sortOrder ASC)
      for (const item of patternsWithOptions) {
        selectionsToCreate.push({
          templatePatternId: item.pattern.id,
          selectedOptionId: item.options[0].id,
        });
      }
    }

    const configHash = hashLineConfiguration(dto.templateId, selectionsToCreate);

    return {
      templateId: dto.templateId,
      quantity: dto.quantity,
      selectionsToCreate,
      configHash,
    };
  }

  /**
   * Adds a new line to a DRAFT production order.
   * Atomic: creates line and pattern selections (default or explicit).
   */
  async addLine(
    orderId: string,
    dto: AddProductionOrderLineDto
  ): Promise<ProductionOrderLineDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order (Unified Lock Root)
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Resolve Configuration
      const resolved = await this.resolveLineConfigurationInternal(dto, manager);

      // 3. Uniqueness assertion within order
      await this.assertConfigurationAvailable(orderId, resolved.configHash, undefined, manager);

      // 4. Calculate next sort order dense (1..N)
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const activeLinesCount = await lineRepo.count({
        where: { orderId, deletedAt: IsNull() },
      });
      const nextSortOrder = activeLinesCount + 1;

      // 5. Insert Line
      const newLine = lineRepo.create({
        orderId,
        templateId: resolved.templateId,
        quantity: resolved.quantity,
        sortOrder: nextSortOrder,
        activeConfigurationHash: resolved.configHash,
      });

      let savedLine: ProductionOrderLineEntity;
      try {
        savedLine = await lineRepo.save(newLine);
      } catch (err: any) {
        if (
          err?.code === 'ER_DUP_ENTRY' ||
          err?.message?.includes('UQ_prod_order_line_order_config_hash')
        ) {
          throw new BusinessRuleError(
            'يوجد بند إنتاج آخر في هذا الطلب يستخدم نفس القالب ونفس خيارات الأنماط. عدّل كمية البند الموجود بدلاً من إضافة بند مكرر.',
            'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
          );
        }
        throw err;
      }

      // 6. Insert Selections
      const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);
      for (const sel of resolved.selectionsToCreate) {
        const newSel = selectionRepo.create({
          orderLineId: savedLine.id,
          templatePatternId: sel.templatePatternId,
          selectedOptionId: sel.selectedOptionId,
        });
        await selectionRepo.save(newSel);
      }

      // 7. Return created line DTO
      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      const createdLineDto = fullOrder.lines?.find((l) => l.id === savedLine.id);
      if (!createdLineDto) {
        throw new NotFoundError('تعذر استرجاع بند الإنتاج المنشأ', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      return createdLineDto;
    });
  }

  /**
   * Adds multiple lines to a DRAFT production order in a single atomic transaction.
   */
  async addLinesBatch(
    orderId: string,
    dto: BatchAddProductionOrderLinesDto
  ): Promise<ProductionOrderLineDto[]> {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BusinessRuleError('يجب تقديم بند واحد على الأقل', 'PRODUCTION_ORDER_BATCH_EMPTY');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order (Unified Lock Root)
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Resolve configuration for each line & detect intra-batch duplicates
      const resolvedLines: Array<{
        templateId: string;
        quantity: number;
        selectionsToCreate: Array<{ templatePatternId: string; selectedOptionId: string }>;
        configHash: string;
      }> = [];

      const batchHashSet = new Set<string>();

      for (const itemDto of dto.lines) {
        const resolved = await this.resolveLineConfigurationInternal(itemDto, manager);
        if (batchHashSet.has(resolved.configHash)) {
          throw new BusinessRuleError(
            'تتضمن قائمة البنود تراكيب مكررة لنفس القالب ونفس خيارات الأنماط',
            'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
          );
        }
        batchHashSet.add(resolved.configHash);
        resolvedLines.push(resolved);
      }

      // 3. Assert no duplicate against existing active lines in order
      for (const resolved of resolvedLines) {
        await this.assertConfigurationAvailable(orderId, resolved.configHash, undefined, manager);
      }

      // 4. Calculate starting sort order
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const activeLinesCount = await lineRepo.count({
        where: { orderId, deletedAt: IsNull() },
      });

      const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);
      const createdLineIds: string[] = [];

      for (let i = 0; i < resolvedLines.length; i++) {
        const resLine = resolvedLines[i];
        const nextSortOrder = activeLinesCount + i + 1;

        const newLine = lineRepo.create({
          orderId,
          templateId: resLine.templateId,
          quantity: resLine.quantity,
          sortOrder: nextSortOrder,
          activeConfigurationHash: resLine.configHash,
        });

        let savedLine: ProductionOrderLineEntity;
        try {
          savedLine = await lineRepo.save(newLine);
        } catch (err: any) {
          if (
            err?.code === 'ER_DUP_ENTRY' ||
            err?.message?.includes('UQ_prod_order_line_order_config_hash')
          ) {
            throw new BusinessRuleError(
              'يوجد بند إنتاج آخر في هذا الطلب يستخدم نفس القالب ونفس خيارات الأنماط. عدّل كمية البند الموجود بدلاً من إضافة بند مكرر.',
              'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
            );
          }
          throw err;
        }

        createdLineIds.push(savedLine.id);

        for (const sel of resLine.selectionsToCreate) {
          const newSel = selectionRepo.create({
            orderLineId: savedLine.id,
            templatePatternId: sel.templatePatternId,
            selectedOptionId: sel.selectedOptionId,
          });
          await selectionRepo.save(newSel);
        }
      }

      // 5. Return created lines DTOs
      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      const createdLines = (fullOrder.lines || []).filter((l) => createdLineIds.includes(l.id));
      return createdLines;
    });
  }

  /**
   * Updates quantity on a DRAFT production order line. (Template ID is strictly immutable).
   */
  async updateLineQuantity(
    orderId: string,
    lineId: string,
    dto: UpdateProductionOrderLineDto
  ): Promise<ProductionOrderLineDto> {
    this.validateLineQuantity(dto.quantity);

    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Validate Line exists on this order
      const line = await this.guardService.requireExistingLine(orderId, lineId, manager);

      // 3. Update quantity
      line.quantity = dto.quantity;
      await manager.save(line);

      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      const lineDto = fullOrder.lines?.find((l) => l.id === lineId);
      if (!lineDto) {
        throw new NotFoundError('تعذر استرجاع بند الإنتاج', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      return lineDto;
    });
  }

  /**
   * Soft deletes a line from a DRAFT order and recompacts remaining sort orders (dense 1..N).
   */
  async archiveLine(orderId: string, lineId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Validate Line exists on this order
      const line = await this.guardService.requireExistingLine(orderId, lineId, manager);

      // 3. Clear activeConfigurationHash and soft-delete the line in the same transaction
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      line.activeConfigurationHash = null;
      line.deletedAt = new Date();
      await lineRepo.save(line);

      // 4. Re-compact remaining active lines to dense 1..N
      const remainingLines = await lineRepo.find({
        where: { orderId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });

      for (let i = 0; i < remainingLines.length; i++) {
        const expectedSortOrder = i + 1;
        if (remainingLines[i].sortOrder !== expectedSortOrder) {
          remainingLines[i].sortOrder = expectedSortOrder;
          await lineRepo.save(remainingLines[i]);
        }
      }
    });
  }

  /**
   * Reorders all active lines in a DRAFT order.
   * Requires exact permutation and sets dense sort orders 1..N.
   */
  async reorderLines(
    orderId: string,
    dto: ReorderProductionOrderLinesDto
  ): Promise<ProductionOrderLineDto[]> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order
      await this.guardService.lockMutableOrder(orderId, manager);

      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const activeLines = await lineRepo.find({
        where: { orderId, deletedAt: IsNull() },
      });

      // 2. Validate exact permutation
      const lineIdSet = new Set(dto.lineIds);
      if (lineIdSet.size !== dto.lineIds.length) {
        throw new BusinessRuleError('مصفوفة المعرفات تحتوي على تكرارات', 'PRODUCTION_ORDER_LINE_INVALID_REORDER');
      }

      if (dto.lineIds.length !== activeLines.length) {
        throw new BusinessRuleError(
          'يجب تقديم كافة بنود الإنتاج النشطة في عملية إعادة الترتيب',
          'PRODUCTION_ORDER_LINE_INVALID_REORDER'
        );
      }

      const activeLineMap = new Map(activeLines.map((l) => [l.id, l]));
      for (const id of dto.lineIds) {
        if (!activeLineMap.has(id)) {
          throw new BusinessRuleError(
            'أحد المعرفات المقدمة غير صالح أو لا ينتمي لهذا الطلب',
            'PRODUCTION_ORDER_LINE_INVALID_REORDER'
          );
        }
      }

      // 3. Update sortOrder for each line
      for (let i = 0; i < dto.lineIds.length; i++) {
        const id = dto.lineIds[i];
        const line = activeLineMap.get(id)!;
        line.sortOrder = i + 1;
        await lineRepo.save(line);
      }

      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      return fullOrder.lines || [];
    });
  }

  // ==========================================
  // 3. PATTERN SELECTION & SYNC
  // ==========================================

  /**
   * Changes the selected option for a pattern on a draft order line.
   */
  async changePatternSelection(
    orderId: string,
    lineId: string,
    patternId: string,
    dto: UpdatePatternSelectionDto
  ): Promise<ProductionOrderLineDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Validate Line belongs to Order
      const line = await this.guardService.requireExistingLine(orderId, lineId, manager);

      // 2.1. Validate Template exists, not archived, and is active
      const templateRepo = manager.getRepository(ProductionTemplateEntity);
      const template = await templateRepo.findOne({
        where: { id: line.templateId, deletedAt: IsNull() },
      });

      if (!template) {
        throw new NotFoundError(
          'قالب هذا البند غير موجود أو تم حذفه',
          'PRODUCTION_ORDER_TEMPLATE_NOT_FOUND'
        );
      }

      if (!template.isActive) {
        throw new BusinessRuleError(
          'لا يمكن تعديل خيارات نمط لقالب تصنيع غير فعال',
          'PRODUCTION_ORDER_TEMPLATE_INACTIVE'
        );
      }

      // 3. Validate Pattern belongs to Line's Template and is active
      const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
      const pattern = await patternRepo.findOne({
        where: { id: patternId, templateId: line.templateId, deletedAt: IsNull() },
      });

      if (!pattern) {
        throw new NotFoundError(
          'النمط غير موجود في قالب هذا البند',
          'PRODUCTION_ORDER_LINE_PATTERN_NOT_FOUND'
        );
      }

      // 4. Validate Option belongs to Pattern and is active
      const optionRepo = manager.getRepository(ProductionTemplatePatternOptionEntity);
      const option = await optionRepo.findOne({
        where: { id: dto.optionId, patternId, deletedAt: IsNull() },
      });

      if (!option) {
        throw new BusinessRuleError(
          'الخيار المحدد غير فعال أو لا ينتمي لهذا النمط',
          'PRODUCTION_ORDER_LINE_OPTION_INVALID'
        );
      }

      // 5. Find current selections and compute would-be configuration
      const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);
      const existingSelections = await selectionRepo.find({
        where: { orderLineId: lineId },
      });

      const wouldBeSelections: Array<{ templatePatternId: string; selectedOptionId: string }> = [];
      let targetPatternReplaced = false;

      for (const sel of existingSelections) {
        if (sel.templatePatternId === patternId) {
          wouldBeSelections.push({
            templatePatternId: patternId,
            selectedOptionId: dto.optionId,
          });
          targetPatternReplaced = true;
        } else {
          wouldBeSelections.push({
            templatePatternId: sel.templatePatternId,
            selectedOptionId: sel.selectedOptionId,
          });
        }
      }

      if (!targetPatternReplaced) {
        wouldBeSelections.push({
          templatePatternId: patternId,
          selectedOptionId: dto.optionId,
        });
      }

      const wouldBeHash = hashLineConfiguration(line.templateId, wouldBeSelections);
      await this.assertConfigurationAvailable(orderId, wouldBeHash, lineId, manager);

      // 6. Find or create selection record
      let selection = existingSelections.find((s) => s.templatePatternId === patternId);

      if (selection) {
        selection.selectedOptionId = dto.optionId;
        await selectionRepo.save(selection);
      } else {
        selection = selectionRepo.create({
          orderLineId: lineId,
          templatePatternId: patternId,
          selectedOptionId: dto.optionId,
        });
        await selectionRepo.save(selection);
      }

      // 7. Update line's activeConfigurationHash
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      line.activeConfigurationHash = wouldBeHash;
      try {
        await lineRepo.save(line);
      } catch (err: any) {
        if (
          err?.code === 'ER_DUP_ENTRY' ||
          err?.message?.includes('UQ_prod_order_line_order_config_hash')
        ) {
          throw new BusinessRuleError(
            'يوجد بند إنتاج آخر في هذا الطلب يستخدم نفس القالب ونفس خيارات الأنماط. عدّل كمية البند الموجود بدلاً من إضافة بند مكرر.',
            'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
          );
        }
        throw err;
      }

      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      const lineDto = fullOrder.lines?.find((l) => l.id === lineId);
      if (!lineDto) {
        throw new NotFoundError('تعذر استرجاع بند الإنتاج', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      return lineDto;
    });
  }

  /**
   * Synchronizes a draft line's pattern selections with live template configuration.
   * - Retains valid active selections.
   * - Sets default (first active option) for missing patterns or invalid selected options.
   * - Removes selections for deleted/inactive patterns.
   * - Rollback occurs if any active pattern has no active options.
   */
  async syncDraftLineSelections(
    orderId: string,
    lineId: string
  ): Promise<ProductionOrderLineDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order
      await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Validate Line belongs to Order
      const line = await this.guardService.requireExistingLine(orderId, lineId, manager);

      // 3. Load Template
      const templateRepo = manager.getRepository(ProductionTemplateEntity);
      const template = await templateRepo.findOne({
        where: { id: line.templateId, deletedAt: IsNull() },
      });

      if (!template) {
        throw new NotFoundError('قالب البند غير موجود', 'PRODUCTION_ORDER_TEMPLATE_NOT_FOUND');
      }

      if (!template.isActive) {
        throw new BusinessRuleError(
          'لا يمكن مزامنة بند لقالب غير فعال',
          'PRODUCTION_ORDER_TEMPLATE_INACTIVE'
        );
      }

      // 4. Load active patterns and active options
      const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
      const activePatterns = await patternRepo.find({
        where: { templateId: line.templateId, deletedAt: IsNull() },
        relations: { options: true },
        order: { createdAt: 'ASC' },
      });

      const patternsWithOptions = activePatterns.map((p) => {
        const activeOptions = (p.options || [])
          .filter((opt) => !opt.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return {
          pattern: p,
          options: activeOptions,
        };
      });

      for (const item of patternsWithOptions) {
        if (item.options.length === 0) {
          throw new BusinessRuleError(
            `النمط "${item.pattern.name}" لا يحتوي على أي خيارات فعالة`,
            'PRODUCTION_ORDER_TEMPLATE_PATTERN_HAS_NO_ACTIVE_OPTIONS'
          );
        }
      }

      // 5. Load existing selections on this line
      const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);
      const existingSelections = await selectionRepo.find({
        where: { orderLineId: lineId },
      });

      // 5.1. Validate existing selections against structural corruption (Fail Closed)
      if (existingSelections.length > 0) {
        const existingPatternIds = Array.from(new Set(existingSelections.map((s) => s.templatePatternId)));
        const existingOptionIds = Array.from(new Set(existingSelections.map((s) => s.selectedOptionId)));

        const referencedPatterns = await patternRepo.find({
          where: { id: In(existingPatternIds) },
          withDeleted: true,
        });
        const refPatternMap = new Map(referencedPatterns.map((p) => [p.id, p]));

        const referencedOptions = await manager.getRepository(ProductionTemplatePatternOptionEntity).find({
          where: { id: In(existingOptionIds) },
          withDeleted: true,
        });
        const refOptionMap = new Map(referencedOptions.map((o) => [o.id, o]));

        for (const sel of existingSelections) {
          const pat = refPatternMap.get(sel.templatePatternId);
          if (!pat || pat.templateId !== line.templateId) {
            throw new BusinessRuleError(
              'تعذر المزامنة: بنية اختيارات البند تالفة وغير موثوقة',
              'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
            );
          }
          const opt = refOptionMap.get(sel.selectedOptionId);
          if (!opt || opt.patternId !== sel.templatePatternId) {
            throw new BusinessRuleError(
              'تعذر المزامنة: بنية اختيارات البند تالفة وغير موثوقة',
              'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
            );
          }
        }
      }

      const activePatternMap = new Map(patternsWithOptions.map((item) => [item.pattern.id, item]));

      // 6. Calculate reconciled selections and resulting configuration hash BEFORE modifying anything
      const existingMap = new Map(existingSelections.map((s) => [s.templatePatternId, s]));
      const resultingSelections: Array<{ templatePatternId: string; selectedOptionId: string }> = [];

      for (const item of patternsWithOptions) {
        const sel = existingMap.get(item.pattern.id);
        if (sel) {
          const isValidOption = item.options.some((opt) => opt.id === sel.selectedOptionId);
          if (isValidOption) {
            resultingSelections.push({
              templatePatternId: item.pattern.id,
              selectedOptionId: sel.selectedOptionId,
            });
          } else {
            resultingSelections.push({
              templatePatternId: item.pattern.id,
              selectedOptionId: item.options[0].id,
            });
          }
        } else {
          resultingSelections.push({
            templatePatternId: item.pattern.id,
            selectedOptionId: item.options[0].id,
          });
        }
      }

      const resultingHash = hashLineConfiguration(line.templateId, resultingSelections);
      await this.assertConfigurationAvailable(orderId, resultingHash, lineId, manager);

      // 7. Remove obsolete selections (pointing to patterns no longer active)
      for (const sel of existingSelections) {
        if (!activePatternMap.has(sel.templatePatternId)) {
          await selectionRepo.remove(sel);
        }
      }

      // 8. Reconcile selections for active patterns
      for (const item of patternsWithOptions) {
        const sel = existingMap.get(item.pattern.id);
        if (sel) {
          const isValidOption = item.options.some((opt) => opt.id === sel.selectedOptionId);
          if (!isValidOption) {
            sel.selectedOptionId = item.options[0].id;
            await selectionRepo.save(sel);
          }
        } else {
          const newSel = selectionRepo.create({
            orderLineId: lineId,
            templatePatternId: item.pattern.id,
            selectedOptionId: item.options[0].id,
          });
          await selectionRepo.save(newSel);
        }
      }

      // 9. Update line's activeConfigurationHash
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      line.activeConfigurationHash = resultingHash;
      try {
        await lineRepo.save(line);
      } catch (err: any) {
        if (
          err?.code === 'ER_DUP_ENTRY' ||
          err?.message?.includes('UQ_prod_order_line_order_config_hash')
        ) {
          throw new BusinessRuleError(
            'يوجد بند إنتاج آخر في هذا الطلب يستخدم نفس القالب ونفس خيارات الأنماط. عدّل كمية البند الموجود بدلاً من إضافة بند مكرر.',
            'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
          );
        }
        throw err;
      }

      const fullOrder = await this.getOrderByIdInternal(orderId, manager);
      const lineDto = fullOrder.lines?.find((l) => l.id === lineId);
      if (!lineDto) {
        throw new NotFoundError('تعذر استرجاع بند الإنتاج', 'PRODUCTION_ORDER_LINE_NOT_FOUND');
      }

      return lineDto;
    });
  }

  // ==========================================
  // 4. ATOMIC DRAFT LINES COMMIT
  // ==========================================

  /**
   * Commits the entire target active line set of a DRAFT order atomically.
   * Single HTTP request, Single DB transaction, Single pessimistic_write lock on order row.
   * All-or-nothing: deletes omitted lines, updates existing lines, adds new lines, reorders dense 1..N.
   */
  async commitDraftLines(
    orderId: string,
    dto: CommitProductionOrderDraftLinesDto
  ): Promise<ProductionOrderDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock order row (Unified Lock Root) - validates DRAFT status
      await this.guardService.lockMutableOrder(orderId, manager);

      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);

      // 2. Load all current active lines in DB
      const currentLines = await lineRepo.find({
        where: { orderId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC' },
      });
      const currentLineMap = new Map(currentLines.map((l) => [l.id, l]));

      // 3. Validate existing IDs in payload
      const seenPayloadIds = new Set<string>();
      for (const lineItem of dto.lines) {
        if (lineItem.id) {
          if (seenPayloadIds.has(lineItem.id)) {
            throw new BusinessRuleError(
              'تكرار غير مسموح في معرفات البنود المرسلة',
              'PRODUCTION_ORDER_LINE_DUPLICATE_ID'
            );
          }
          seenPayloadIds.add(lineItem.id);

          const existing = currentLineMap.get(lineItem.id);
          if (!existing) {
            throw new NotFoundError(
              'بند الإنتاج غير موجود في هذا الطلب أو تم أرشفته',
              'PRODUCTION_ORDER_LINE_NOT_FOUND'
            );
          }

          if (lineItem.templateId !== existing.templateId) {
            throw new BusinessRuleError(
              'لا يمكن تغيير قالب تصنيع لبند إنتاج موجود',
              'PRODUCTION_ORDER_LINE_TEMPLATE_IMMUTABLE'
            );
          }
        }
      }

      // 4. Identify lines to remove (active in DB but omitted from payload)
      const removedLines = currentLines.filter((l) => !seenPayloadIds.has(l.id));

      // 5. Pre-validate and resolve entire target state before performing any mutations
      interface ResolvedTargetLine {
        lineDto: (typeof dto.lines)[number];
        isExisting: boolean;
        lineId?: string;
        templateId: string;
        quantity: number;
        selectionsToCreate: Array<{ templatePatternId: string; selectedOptionId: string }>;
        configHash: string;
      }

      const resolvedLines: ResolvedTargetLine[] = [];
      const targetConfigHashes = new Set<string>();

      for (const lineItem of dto.lines) {
        const resolved = await this.resolveLineConfigurationInternal(
          {
            templateId: lineItem.templateId,
            quantity: lineItem.quantity,
            patternSelections: lineItem.patternSelections,
          },
          manager
        );

        if (targetConfigHashes.has(resolved.configHash)) {
          throw new BusinessRuleError(
            'يوجد تكرار لنفس القالب ونفس خيارات الأنماط في بنود طلب الإنتاج. لا يمكن إضافة نفس التكوين أكثر من مرة.',
            'PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION'
          );
        }
        targetConfigHashes.add(resolved.configHash);

        resolvedLines.push({
          lineDto: lineItem,
          isExisting: Boolean(lineItem.id),
          lineId: lineItem.id,
          templateId: resolved.templateId,
          quantity: resolved.quantity,
          selectionsToCreate: resolved.selectionsToCreate,
          configHash: resolved.configHash,
        });
      }

      // 6. DB Mutations:
      // Phase A: Set active_configuration_hash = null on all currently active lines to avoid unique key collisions during swaps
      if (currentLines.length > 0) {
        await lineRepo.update({ orderId, deletedAt: IsNull() }, { activeConfigurationHash: null });
      }

      // Phase B: Soft-delete removed lines and null their active_configuration_hash
      for (const rem of removedLines) {
        await lineRepo.update(rem.id, { activeConfigurationHash: null });
        await lineRepo.softDelete(rem.id);
      }

      // Phase C: Apply updates to existing lines and insert new lines with dense sortOrder (1..N)
      for (let i = 0; i < resolvedLines.length; i++) {
        const r = resolvedLines[i];
        const denseSortOrder = i + 1;

        if (r.isExisting && r.lineId) {
          // Existing line update
          await lineRepo.update(r.lineId, {
            quantity: r.quantity,
            sortOrder: denseSortOrder,
          });

          // Delete existing selections and insert new
          await selectionRepo.delete({ orderLineId: r.lineId });
          if (r.selectionsToCreate.length > 0) {
            const newSelections = r.selectionsToCreate.map((sel) =>
              selectionRepo.create({
                orderLineId: r.lineId!,
                templatePatternId: sel.templatePatternId,
                selectedOptionId: sel.selectedOptionId,
              })
            );
            await selectionRepo.save(newSelections);
          }
        } else {
          // New line insert
          const newLine = lineRepo.create({
            orderId,
            templateId: r.templateId,
            quantity: r.quantity,
            sortOrder: denseSortOrder,
            activeConfigurationHash: null,
          });
          const savedLine = await lineRepo.save(newLine);
          r.lineId = savedLine.id;

          if (r.selectionsToCreate.length > 0) {
            const newSelections = r.selectionsToCreate.map((sel) =>
              selectionRepo.create({
                orderLineId: savedLine.id,
                templatePatternId: sel.templatePatternId,
                selectedOptionId: sel.selectedOptionId,
              })
            );
            await selectionRepo.save(newSelections);
          }
        }
      }

      // Phase D: Write final configuration hashes
      for (const r of resolvedLines) {
        await lineRepo.update(r.lineId!, {
          activeConfigurationHash: r.configHash,
        });
      }

      // 7. Post-mutation invariant verification (Fail Closed)
      const verifyActiveLines = await lineRepo.find({
        where: { orderId, deletedAt: IsNull() },
      });
      if (verifyActiveLines.length !== dto.lines.length) {
        throw new BusinessRuleError(
          'خطأ في الاتساق بعد حفظ بنود المسودة',
          'PRODUCTION_ORDER_COMMIT_INCONSISTENCY'
        );
      }
      for (const val of verifyActiveLines) {
        if (!val.activeConfigurationHash) {
          throw new BusinessRuleError(
            'خطأ: تم اكتشاف بند نشط بدون رمز تحقق تركيبي',
            'PRODUCTION_ORDER_COMMIT_INCONSISTENCY'
          );
        }
      }

      return this.getOrderByIdInternal(orderId, manager);
    });
  }

  // ==========================================
  // 5. PATTERN SELECTIONS SYNC PREVIEW
  // ==========================================

  /**
   * Previews the result of synchronizing a line's selections against the live template.
   * STRICTLY READ-ONLY: Never writes or modifies DB state.
   */
  async previewSyncDraftLine(
    orderId: string,
    lineId: string
  ): Promise<SyncDraftLinePreviewDto> {
    const order = await this.guardService.requireExistingOrder(orderId);
    this.guardService.requireDraftOrder(order);
    const line = await this.guardService.requireExistingLine(orderId, lineId);

    const template = await this.templateRepo.findOne({
      where: { id: line.templateId, deletedAt: IsNull() },
    });

    if (!template || !template.isActive) {
      throw new BusinessRuleError(
        'قالب التصنيع المرتبط بهذا البند غير موجود أو غير فعال',
        'PRODUCTION_ORDER_TEMPLATE_INACTIVE'
      );
    }

    // Load active patterns and active options
    const activePatterns = await this.patternRepo.find({
      where: { templateId: line.templateId, deletedAt: IsNull() },
      relations: { options: true },
      order: { createdAt: 'ASC' },
    });

    const patternsWithOptions = activePatterns.map((p) => {
      const activeOptions = (p.options || [])
        .filter((opt) => !opt.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        pattern: p,
        options: activeOptions,
      };
    });

    // Load existing selections on this line
    const existingSelections = await this.selectionRepo.find({
      where: { orderLineId: lineId },
    });

    const existingPatternIds = existingSelections.map((s) => s.templatePatternId);
    const existingOptionIds = existingSelections.map((s) => s.selectedOptionId);

    const refPatterns = existingPatternIds.length > 0
      ? await this.patternRepo.find({
          where: { id: In(existingPatternIds) },
          withDeleted: true,
        })
      : [];
    const refPatternMap = new Map(refPatterns.map((p) => [p.id, p]));

    const refOptions = existingOptionIds.length > 0
      ? await this.optionRepo.find({
          where: { id: In(existingOptionIds) },
          withDeleted: true,
        })
      : [];
    const refOptionMap = new Map(refOptions.map((o) => [o.id, o]));

    // Fail closed on any structural corruption
    for (const sel of existingSelections) {
      const pat = refPatternMap.get(sel.templatePatternId);
      if (!pat) {
        throw new BusinessRuleError(
          'بنية اختيارات البند تالفة: النمط المرجعي غير موجود في النظام',
          'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
        );
      }
      if (pat.templateId !== line.templateId) {
        throw new BusinessRuleError(
          'بنية اختيارات البند تالفة: النمط المرجعي لا ينتمي إلى قالب هذا البند',
          'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
        );
      }

      const opt = refOptionMap.get(sel.selectedOptionId);
      if (!opt) {
        throw new BusinessRuleError(
          'بنية اختيارات البند تالفة: الخيار المرجعي غير موجود في النظام',
          'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
        );
      }
      if (opt.patternId !== sel.templatePatternId) {
        throw new BusinessRuleError(
          'بنية اختيارات البند تالفة: الخيار المرجعي لا ينتمي إلى النمط المحدد',
          'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
        );
      }
    }

    const existingMap = new Map(existingSelections.map((s) => [s.templatePatternId, s]));
    const resultingSelections: Array<{ patternId: string; optionId: string }> = [];
    const patternsDto: SyncPreviewPatternDto[] = [];
    const warnings: string[] = [];
    let hasChanges = false;

    for (const item of patternsWithOptions) {
      const activeOptsDto: SyncPreviewAvailableOptionDto[] = item.options.map((o) => ({
        id: o.id,
        name: o.name,
        sortOrder: o.sortOrder,
        isActive: !o.deletedAt,
      }));

      const existingSel = existingMap.get(item.pattern.id);
      let selectedOptionId: string;
      let currentSelectionDto: SyncPreviewPatternDto['currentSelection'] | undefined = undefined;

      if (existingSel) {
        const refOpt = refOptionMap.get(existingSel.selectedOptionId)!;
        const isArchived = !item.options.some((o) => o.id === existingSel.selectedOptionId);
        currentSelectionDto = {
          optionId: existingSel.selectedOptionId,
          optionName: refOpt.name,
          isArchived,
        };

        if (!isArchived) {
          selectedOptionId = existingSel.selectedOptionId;
        } else {
          selectedOptionId = item.options.length > 0 ? item.options[0].id : '';
          hasChanges = true;
          warnings.push(
            `الخيار السابق "${currentSelectionDto.optionName}" للنمط "${item.pattern.name}" لم يعد فعالاً وتم اقتراح الخيار الافتراضي`
          );
        }
      } else {
        selectedOptionId = item.options.length > 0 ? item.options[0].id : '';
        hasChanges = true;
        warnings.push(`النمط "${item.pattern.name}" نمط جديد تمت إضافته للقالب`);
      }

      if (selectedOptionId) {
        resultingSelections.push({
          patternId: item.pattern.id,
          optionId: selectedOptionId,
        });
      }

      patternsDto.push({
        patternId: item.pattern.id,
        patternName: item.pattern.name,
        isRequired: true,
        options: activeOptsDto,
        currentSelection: currentSelectionDto,
      });
    }

    const activePatIdSet = new Set(patternsWithOptions.map((p) => p.pattern.id));
    for (const sel of existingSelections) {
      if (!activePatIdSet.has(sel.templatePatternId)) {
        hasChanges = true;
        warnings.push(`يحتوي البند على نمط سابق لم يعد جزءاً من القالب الحالي وسيتم حذفه عند المزامنة`);
      }
    }

    return {
      lineId,
      templateId: template.id,
      templateName: template.name,
      resultingSelections,
      patterns: patternsDto,
      patternSelections: patternsDto.map((p) => {
        const sel = resultingSelections.find((s) => s.patternId === p.patternId);
        return {
          patternId: p.patternId,
          patternName: p.patternName,
          selectedOptionId: sel ? sel.optionId : null,
          availableOptions: p.options,
          isHistorical: p.currentSelection ? p.currentSelection.isArchived : false,
          selectedOptionName: p.currentSelection ? p.currentSelection.optionName : null,
        };
      }),
      warnings,
      hasChanges,
    };
  }

  // ==========================================
  // 6. ORDER APPROVAL & REOPEN WORKFLOW
  // ==========================================

  /**
   * Approves a DRAFT production order:
   * 1. Validates order is DRAFT and readiness check passes.
   * 2. Atomically generates isolated execution plans for all lines.
   * 3. Generates production units and immutable initial history events.
   * 4. Transitions status to APPROVED.
   */
  async approveOrder(
    orderId: string,
    currentUser: { id: string } | string
  ): Promise<ProductionOrderDto> {
    const rawId = typeof currentUser === 'string' ? currentUser : currentUser?.id;
    const userId = rawId ? rawId.trim() : '';
    if (!userId) {
      throw new BusinessRuleError(
        'تعذر تحديد المستخدم الذي يقوم باعتماد أمر الإنتاج',
        'PRODUCTION_ORDER_APPROVER_REQUIRED'
      );
    }
    return this.dataSource.transaction(async (manager) => {
      // 1. Lock Order (checks status = DRAFT)
      const order = await this.guardService.lockMutableOrder(orderId, manager);

      // 2. Validate readiness internally
      const readiness = await this.validateOrderReadinessInternal(orderId, manager);
      if (!readiness.ready) {
        throw new BusinessRuleError(
          'طلب الإنتاج غير جاهز للاعتماد بسبب وجود ملاحظات في البنود أو القوالب',
          'PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL',
          { issues: readiness.issues }
        );
      }

      // 3. Load active lines
      const lineRepo = manager.getRepository(ProductionOrderLineEntity);
      const lines = await lineRepo.find({
        where: { orderId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });

      if (lines.length === 0) {
        throw new BusinessRuleError(
          'يجب أن يحتوي طلب الإنتاج على بند إنتاج واحد على الأقل',
          'PRODUCTION_ORDER_EMPTY'
        );
      }

      // 4. Set APPROVED (Production Order Approval = Approved Production Memorandum)
      // Note: No execution plans, execution tasks, units, or events are generated automatically.
      order.status = ProductionOrderStatus.APPROVED;
      order.approvedAt = new Date();
      order.approvedByUserId = userId;

      await manager.save(order);

      return this.getOrderByIdInternal(orderId, manager);
    });
  }

  /**
   * Reopens an APPROVED production order back to DRAFT for edits.
   * Blocked with PRODUCTION_ORDER_HAS_EXECUTION_PLANS if execution plans or units exist.
   */
  async reopenOrder(
    orderId: string,
    _currentUser?: { id: string } | string
  ): Promise<ProductionOrderDto> {
    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(ProductionOrderEntity);
      const order = await orderRepo.findOne({
        where: { id: orderId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
      }

      if (order.status !== ProductionOrderStatus.APPROVED) {
        throw new BusinessRuleError(
          'لا يمكن إعادة طلب إنتاج ليس في حالة معتمد إلى مسودة',
          'PRODUCTION_ORDER_NOT_APPROVED'
        );
      }

      // Invariant: Block reopening if execution plans or units exist
      const planRepo = manager.getRepository(ProductionExecutionPlanEntity);
      const planCount = await planRepo.count({
        where: { orderId, deletedAt: IsNull() },
      });
      const unitRepo = manager.getRepository(ProductionUnitEntity);
      const unitCount = await unitRepo.count({
        where: { orderId, deletedAt: IsNull() },
      });

      if (planCount > 0 || unitCount > 0) {
        throw new BusinessRuleError(
          'لا يمكن إعادة فتح أمر إنتاج تم إنشاء خطط تنفيذية أو غرف إنتاج له',
          'PRODUCTION_ORDER_HAS_EXECUTION_PLANS'
        );
      }

      order.status = ProductionOrderStatus.DRAFT;
      order.approvedAt = null;
      order.approvedByUserId = null;

      await manager.save(order);

      return this.getOrderByIdInternal(orderId, manager);
    });
  }

  // ==========================================
  // 7. READ-ONLY RELEASE READINESS VALIDATION
  // ==========================================

  /**
   * Evaluates readiness of a DRAFT order for future release against live template data.
   * STRICTLY READ-ONLY: Never mutates order status, lines, or DB state.
   */
  async validateDraftForRelease(
    orderId: string
  ): Promise<ProductionOrderReadinessDto> {
    return this.validateOrderReadinessInternal(orderId, undefined, true);
  }

  /**
   * Internal reusable readiness validation engine.
   */
  private async validateOrderReadinessInternal(
    orderId: string,
    manager?: EntityManager,
    allowApproved = false
  ): Promise<ProductionOrderReadinessDto> {
    const issues: ProductionOrderReadinessIssueDto[] = [];

    // 1. Order exists
    const order = await this.guardService.requireExistingOrder(orderId, manager);
    if (!allowApproved && order.status !== ProductionOrderStatus.DRAFT) {
      issues.push({
        code: 'PRODUCTION_ORDER_NOT_DRAFT',
        message: 'طلب الإنتاج ليس في حالة مسودة',
      });
      return { ready: false, issues };
    }

    const lineRepo = manager ? manager.getRepository(ProductionOrderLineEntity) : this.lineRepo;
    const templateRepo = manager ? manager.getRepository(ProductionTemplateEntity) : this.templateRepo;
    const patternRepo = manager ? manager.getRepository(ProductionTemplatePatternEntity) : this.patternRepo;
    const optionRepo = manager ? manager.getRepository(ProductionTemplatePatternOptionEntity) : this.optionRepo;
    const workflowItemRepo = manager
      ? manager.getRepository(ProductionTemplateWorkflowItemEntity)
      : this.workflowItemRepo;
    const selectionRepo = manager
      ? manager.getRepository(ProductionOrderLinePatternSelectionEntity)
      : this.selectionRepo;

    // 2. Load active lines
    const activeLines = await lineRepo.find({
      where: { orderId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    if (activeLines.length === 0) {
      issues.push({
        code: 'PRODUCTION_ORDER_EMPTY',
        message: 'يجب أن يحتوي طلب الإنتاج على بند إنتاج واحد على الأقل',
      });
      return { ready: false, issues };
    }

    // 3. Batch load templates, patterns, options, workflow items, and selections
    const templateIds = Array.from(new Set(activeLines.map((l) => l.templateId)));
    const templates = await templateRepo.find({
      where: { id: In(templateIds) },
      withDeleted: true,
    });
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    // Batch load active workflow items for templates
    const workflowItems = await workflowItemRepo.find({
      where: { templateId: In(templateIds), deletedAt: IsNull() },
    });
    const workflowCountMap = new Map<string, number>();
    for (const item of workflowItems) {
      workflowCountMap.set(item.templateId, (workflowCountMap.get(item.templateId) || 0) + 1);
    }

    // Batch load active patterns and options
    const patterns = await patternRepo.find({
      where: { templateId: In(templateIds), deletedAt: IsNull() },
      relations: { options: true },
    });
    const templatePatternsMap = new Map<string, ProductionTemplatePatternEntity[]>();
    for (const p of patterns) {
      const list = templatePatternsMap.get(p.templateId) || [];
      list.push(p);
      templatePatternsMap.set(p.templateId, list);
    }

    // Batch load all selections for the lines
    const lineIds = activeLines.map((l) => l.id);
    const selections = await selectionRepo.find({
      where: { orderLineId: In(lineIds) },
    });
    const lineSelectionsMap = new Map<string, ProductionOrderLinePatternSelectionEntity[]>();
    for (const sel of selections) {
      const list = lineSelectionsMap.get(sel.orderLineId) || [];
      list.push(sel);
      lineSelectionsMap.set(sel.orderLineId, list);
    }

    // Fail closed on any structural corruption in existing selections
    if (selections.length > 0) {
      const referencedPatternIds = Array.from(new Set(selections.map((s) => s.templatePatternId)));
      const referencedOptionIds = Array.from(new Set(selections.map((s) => s.selectedOptionId)));

      const referencedPatterns = await patternRepo.find({
        where: { id: In(referencedPatternIds) },
        withDeleted: true,
      });
      const refPatternMap = new Map(referencedPatterns.map((p) => [p.id, p]));

      const referencedOptions = await optionRepo.find({
        where: { id: In(referencedOptionIds) },
        withDeleted: true,
      });
      const refOptionMap = new Map(referencedOptions.map((o) => [o.id, o]));

      for (const line of activeLines) {
        const lineSels = lineSelectionsMap.get(line.id) || [];
        for (const sel of lineSels) {
          const pat = refPatternMap.get(sel.templatePatternId);
          if (!pat || pat.templateId !== line.templateId) {
            throw new BusinessRuleError(
              'بنية اختيارات البند تالفة: النمط المرجعي غير موجود أو لا ينتمي لهذا القالب',
              'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
            );
          }
          const opt = refOptionMap.get(sel.selectedOptionId);
          if (!opt || opt.patternId !== sel.templatePatternId) {
            throw new BusinessRuleError(
              'بنية اختيارات البند تالفة: الخيار المرجعي غير موجود أو لا ينتمي لهذا النمط',
              'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
            );
          }
        }
      }
    }

    // 4. Validate each line
    for (const line of activeLines) {
      const template = templateMap.get(line.templateId);

      // Check Template status
      if (!template || template.deletedAt !== null || !template.isActive) {
        issues.push({
          code: 'PRODUCTION_ORDER_TEMPLATE_INACTIVE',
          lineId: line.id,
          message: `القالب المرتبط بالبند #${line.sortOrder} غير موجود أو معطل أو تمت أرشفته`,
        });
        continue;
      }

      // Check Template workflow is not empty
      const wfCount = workflowCountMap.get(template.id) || 0;
      if (wfCount === 0) {
        issues.push({
          code: 'PRODUCTION_ORDER_TEMPLATE_WORKFLOW_EMPTY',
          lineId: line.id,
          message: `القالب "${template.name}" في البند #${line.sortOrder} لا يحتوي على أي مراحل أو أنماط في سير العمل`,
        });
      }

      // Check Patterns & Selections
      const activeTemplatePatterns = templatePatternsMap.get(template.id) || [];
      const lineSelections = lineSelectionsMap.get(line.id) || [];

      const selectionMap = new Map<string, ProductionOrderLinePatternSelectionEntity>();
      for (const sel of lineSelections) {
        if (selectionMap.has(sel.templatePatternId)) {
          issues.push({
            code: 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID',
            lineId: line.id,
            patternId: sel.templatePatternId,
            message: `تكرار غير صالح في خيارات النمط للبند #${line.sortOrder}`,
          });
        }
        selectionMap.set(sel.templatePatternId, sel);
      }

      // Verify each active pattern has a valid active option selection
      for (const pat of activeTemplatePatterns) {
        const sel = selectionMap.get(pat.id);
        if (!sel) {
          issues.push({
            code: 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID',
            lineId: line.id,
            patternId: pat.id,
            message: `البند #${line.sortOrder} ينقصه خيار محدد للنمط "${pat.name}"`,
          });
          continue;
        }

        const activeOptions = (pat.options || []).filter((o) => !o.deletedAt);
        const matchedOption = activeOptions.find((o) => o.id === sel.selectedOptionId);
        if (!matchedOption) {
          issues.push({
            code: 'PRODUCTION_ORDER_LINE_OPTION_INVALID',
            lineId: line.id,
            patternId: pat.id,
            message: `الخيار المحدد للنمط "${pat.name}" في البند #${line.sortOrder} لم يعد فعالاً أو تم حذفه`,
          });
        }
      }

      // Check if line has foreign/obsolete selections pointing to patterns not belonging to this template
      const activePatIdSet = new Set(activeTemplatePatterns.map((p) => p.id));
      for (const sel of lineSelections) {
        if (!activePatIdSet.has(sel.templatePatternId)) {
          issues.push({
            code: 'PRODUCTION_ORDER_LINE_PATTERN_SELECTION_INVALID',
            lineId: line.id,
            patternId: sel.templatePatternId,
            message: `البند #${line.sortOrder} يحتوي على خيارات لأنماط لم تعد تنتمي لهذا القالب`,
          });
        }
      }
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  }

  // ==========================================
  // INTERNAL HELPERS (BATCH LOADING)
  // ==========================================

  private async getOrderByIdInternal(
    orderId: string,
    manager?: EntityManager
  ): Promise<ProductionOrderDto> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const lineRepo = manager ? manager.getRepository(ProductionOrderLineEntity) : this.lineRepo;
    const templateRepo = manager ? manager.getRepository(ProductionTemplateEntity) : this.templateRepo;
    const patternRepo = manager ? manager.getRepository(ProductionTemplatePatternEntity) : this.patternRepo;
    const selectionRepo = manager
      ? manager.getRepository(ProductionOrderLinePatternSelectionEntity)
      : this.selectionRepo;

    // 1. Fetch Order with User
    const order = await orderRepo.findOne({
      where: { id: orderId, deletedAt: IsNull() },
      relations: { createdByUser: true, approvedByUser: true },
    });

    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    // 2. Fetch active Lines
    const lines = await lineRepo.find({
      where: { orderId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    if (lines.length === 0) {
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        priority: order.priority,
        description: order.description,
        notes: order.notes,
        approvedAt: order.approvedAt,
        approvedByUser: order.approvedByUser
          ? {
              id: order.approvedByUser.id,
              fullName: order.approvedByUser.fullName,
            }
          : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        createdByUser: order.createdByUser
          ? {
              id: order.createdByUser.id,
              fullName: order.createdByUser.fullName,
            }
          : undefined,
        summary: { lineCount: 0, totalQuantity: 0, totalLinkedQuantity: 0, totalRemainingQuantity: 0, totalExcessQuantity: 0, hasQuantityViolation: false },
        lines: [],
        hasExecutionPlans: false,
        unitsSummary: null,
      };
    }

    // 3. Batch load unique templates
    const templateIds = Array.from(new Set(lines.map((l) => l.templateId)));
    const templates = await templateRepo.find({
      where: { id: In(templateIds) },
      withDeleted: true,
    });
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    // 4. Batch load all selections for all lines
    const lineIds = lines.map((l) => l.id);
    const selections = await selectionRepo.find({
      where: { orderLineId: In(lineIds) },
    });
    const selectionsByLineId = new Map<string, ProductionOrderLinePatternSelectionEntity[]>();
    for (const sel of selections) {
      const list = selectionsByLineId.get(sel.orderLineId) || [];
      list.push(sel);
      selectionsByLineId.set(sel.orderLineId, list);
    }

    // 4.1. Validate structural corruption on all selections (Fail Closed)
    const referencedPatternIds = Array.from(new Set(selections.map((s) => s.templatePatternId)));
    const referencedOptionIds = Array.from(new Set(selections.map((s) => s.selectedOptionId)));

    const referencedPatterns = referencedPatternIds.length > 0
      ? await patternRepo.find({
          where: { id: In(referencedPatternIds) },
          withDeleted: true,
        })
      : [];
    const refPatternMap = new Map(referencedPatterns.map((p) => [p.id, p]));

    const referencedOptions = referencedOptionIds.length > 0
      ? await (manager ? manager.getRepository(ProductionTemplatePatternOptionEntity) : this.optionRepo).find({
          where: { id: In(referencedOptionIds) },
          withDeleted: true,
        })
      : [];
    const refOptionMap = new Map(referencedOptions.map((o) => [o.id, o]));

    for (const line of lines) {
      if (!line.activeConfigurationHash) {
        throw new BusinessRuleError(
          'بنية اختيارات البند تالفة: رمز التحقق الهيكلي للبند مفقود',
          'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
        );
      }

      const lineSels = selectionsByLineId.get(line.id) || [];
      for (const sel of lineSels) {
        const pat = refPatternMap.get(sel.templatePatternId);
        if (!pat) {
          throw new BusinessRuleError(
            'بنية اختيارات البند تالفة: النمط المرجعي غير موجود في النظام',
            'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
          );
        }
        if (pat.templateId !== line.templateId) {
          throw new BusinessRuleError(
            'بنية اختيارات البند تالفة: النمط المرجعي لا ينتمي إلى قالب هذا البند',
            'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
          );
        }

        const opt = refOptionMap.get(sel.selectedOptionId);
        if (!opt) {
          throw new BusinessRuleError(
            'بنية اختيارات البند تالفة: الخيار المرجعي غير موجود في النظام',
            'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
          );
        }
        if (opt.patternId !== sel.templatePatternId) {
          throw new BusinessRuleError(
            'بنية اختيارات البند تالفة: الخيار المرجعي لا ينتمي إلى النمط المحدد',
            'PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT'
          );
        }
      }
    }

    // 5. Batch load active patterns and options for all unique templates
    const patterns = await patternRepo.find({
      where: { templateId: In(templateIds), deletedAt: IsNull() },
      relations: { options: true },
      order: { createdAt: 'ASC' },
    });

    const patternsByTemplateId = new Map<string, ProductionTemplatePatternEntity[]>();
    const allPatternsMap = new Map<string, ProductionTemplatePatternEntity>();
    for (const pat of patterns) {
      allPatternsMap.set(pat.id, pat);
      const list = patternsByTemplateId.get(pat.templateId) || [];
      list.push(pat);
      patternsByTemplateId.set(pat.templateId, list);
    }

    // 5.1 Batch load execution plans, task counts, and units
    const planRepo = manager
      ? manager.getRepository(ProductionExecutionPlanEntity)
      : this.dataSource.getRepository(ProductionExecutionPlanEntity);
    const taskRepo = manager
      ? manager.getRepository(ProductionExecutionTaskEntity)
      : this.dataSource.getRepository(ProductionExecutionTaskEntity);
    const unitRepo = manager
      ? manager.getRepository(ProductionUnitEntity)
      : this.dataSource.getRepository(ProductionUnitEntity);

    const activePlans = lines.length > 0
      ? await planRepo.find({
          where: { orderId, deletedAt: IsNull() },
        })
      : [];
    const planByLineId = new Map(activePlans.map((p) => [p.orderLineId, p]));

    const planIds = activePlans.map((p) => p.id);
    const activeTasks = planIds.length > 0
      ? await taskRepo.find({
          where: { planId: In(planIds), deletedAt: IsNull() },
          select: { id: true, planId: true },
        })
      : [];
    const taskCountByPlanId = new Map<string, number>();
    for (const t of activeTasks) {
      taskCountByPlanId.set(t.planId, (taskCountByPlanId.get(t.planId) || 0) + 1);
    }

    const activeUnits = lines.length > 0
      ? await unitRepo.find({
          where: { orderId, deletedAt: IsNull() },
          select: { id: true, orderLineId: true, status: true, isCancelled: true },
        })
      : [];

    const unitCountByLineId = new Map<string, number>();
    const linkedNonCancelledUnitCountByLineId = new Map<string, number>();
    const unitsSummary = {
      totalUnits: activeUnits.length,
      createdUnits: 0,
      inProgressUnits: 0,
      completedUnits: 0,
      cancelledUnits: 0,
    };

    for (const u of activeUnits) {
      if (!u.orderLineId) continue;
      unitCountByLineId.set(u.orderLineId, (unitCountByLineId.get(u.orderLineId) || 0) + 1);
      if (u.isCancelled || u.status === ProductionUnitStatus.CANCELLED) {
        unitsSummary.cancelledUnits++;
      } else {
        linkedNonCancelledUnitCountByLineId.set(
          u.orderLineId,
          (linkedNonCancelledUnitCountByLineId.get(u.orderLineId) || 0) + 1
        );
        if (u.status === ProductionUnitStatus.COMPLETED) {
          unitsSummary.completedUnits++;
        } else if (u.status === ProductionUnitStatus.IN_PROGRESS) {
          unitsSummary.inProgressUnits++;
        } else {
          unitsSummary.createdUnits++;
        }
      }
    }

    // 6. Map Line DTOs
    let totalQuantity = 0;
    let totalLinkedQuantity = 0;
    let totalRemainingQuantity = 0;
    let totalExcessQuantity = 0;
    let hasOrderQuantityViolation = false;
    const lineDtos: ProductionOrderLineDto[] = lines.map((line) => {
      totalQuantity += line.quantity;
      const requestedQuantity = line.quantity;
      const linkedQuantity = linkedNonCancelledUnitCountByLineId.get(line.id) || 0;
      const lineQuantities = calculateLineQuantities(requestedQuantity, linkedQuantity);

      totalLinkedQuantity += lineQuantities.linkedQuantity;
      totalRemainingQuantity += lineQuantities.remainingQuantity;
      totalExcessQuantity += lineQuantities.excessQuantity;
      if (lineQuantities.hasQuantityViolation) {
        hasOrderQuantityViolation = true;
      }
      const tmpl = templateMap.get(line.templateId);
      const lineSelections = selectionsByLineId.get(line.id) || [];

      // Assemble pattern selections DTOs
      const selectionDtos = lineSelections.map((sel) => {
        const pat = refPatternMap.get(sel.templatePatternId)!;
        const opt = refOptionMap.get(sel.selectedOptionId)!;

        const isPatternActive = pat.deletedAt === null;
        const isSelectedOptionActive = isPatternActive && opt.deletedAt === null;
        const isHistorical = !isPatternActive || !isSelectedOptionActive;

        // If pattern is still active, fetch active available options; if archived, availableOptions = []
        const activePat = isPatternActive ? allPatternsMap.get(pat.id) : null;
        const activeOptions = activePat
          ? (activePat.options || [])
              .filter((o) => !o.deletedAt)
              .sort((a, b) => a.sortOrder - b.sortOrder)
          : [];

        return {
          id: sel.id,
          templatePatternId: sel.templatePatternId,
          patternName: pat.name,
          selectedOptionId: sel.selectedOptionId,
          selectedOptionName: opt.name,
          isPatternActive,
          isSelectedOptionActive,
          isHistorical,
          availableOptions: activeOptions.map((o) => ({
            id: o.id,
            name: o.name,
            sortOrder: o.sortOrder,
          })),
        };
      });

      return {
        id: line.id,
        orderId: line.orderId,
        templateId: line.templateId,
        quantity: line.quantity,
        requestedQuantity,
        linkedQuantity,
        remainingQuantity: lineQuantities.remainingQuantity,
        excessQuantity: lineQuantities.excessQuantity,
        hasQuantityViolation: lineQuantities.hasQuantityViolation,
        sortOrder: line.sortOrder,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
        template: tmpl
          ? {
              id: tmpl.id,
              name: tmpl.name,
              code: tmpl.code,
              referenceNumber: tmpl.referenceNumber,
              isActive: tmpl.isActive,
            }
          : undefined,
        patternSelections: selectionDtos,
        executionPlan: (() => {
          const plan = planByLineId.get(line.id);
          return plan
            ? {
                id: plan.id,
                orderLineId: plan.orderLineId,
                templateId: plan.templateId,
                templateName: plan.templateName,
                templateCode: plan.templateCode,
                lineQuantity: plan.lineQuantity,
                configurationHash: plan.configurationHash,
                tasksCount: taskCountByPlanId.get(plan.id) || 0,
                unitsCount: linkedQuantity,
              }
            : null;
        })(),
        unitCount: unitCountByLineId.get(line.id) || 0,
      };
    });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      priority: order.priority,
      description: order.description,
      notes: order.notes,
      approvedAt: order.approvedAt || null,
      approvedByUserId: order.approvedByUserId || null,
      approvedByUser: order.approvedByUser
        ? {
            id: order.approvedByUser.id,
            fullName: order.approvedByUser.fullName,
          }
        : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      createdByUser: order.createdByUser
        ? {
            id: order.createdByUser.id,
            fullName: order.createdByUser.fullName,
          }
        : undefined,
      summary: {
        lineCount: lines.length,
        totalQuantity,
        totalLinkedQuantity,
        totalRemainingQuantity,
        totalExcessQuantity,
        hasQuantityViolation: hasOrderQuantityViolation,
      },
      lines: lineDtos,
      hasExecutionPlans: activePlans.length > 0,
      unitsSummary: activeUnits.length > 0 ? unitsSummary : null,
    };
  }
}

export const productionOrderService = new ProductionOrderService();
