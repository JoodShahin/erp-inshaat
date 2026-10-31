import { NotFoundError } from '../../../common/errors/not-found.error.js';
import {
  ProductionExecutionPlanService,
  productionExecutionPlanService,
} from '../execution-plan/production-execution-plan.service.js';
import {
  ProductionUnitService,
  productionUnitService,
} from '../unit/production-unit.service.js';
import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../../common/responses/api-response.js';
import { ProductionOrderService, productionOrderService } from './production-order.service.js';
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
import { ListProductionUnitsQueryDto } from '../unit/dto/list-production-units-query.dto.js';
import { ListProductionUnitEventsQueryDto } from '../unit/dto/list-production-unit-events-query.dto.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionOrderController {
  constructor(
    private orderService: ProductionOrderService = productionOrderService,
    private executionPlanService: ProductionExecutionPlanService = productionExecutionPlanService,
    private unitService: ProductionUnitService = productionUnitService
  ) {}

  // ==========================================
  // 1. ORDER HEADER OPERATIONS
  // ==========================================

  listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = (req.validatedQuery ?? req.query) as unknown as ListProductionOrdersQueryDto;
      const result = await this.orderService.listOrders(query);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  };

  getOrderById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const order = await this.orderService.getOrderById(orderId as string);
      res.status(200).json(ApiResponse.success(order));
    } catch (error) {
      next(error);
    }
  };

  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as CreateProductionOrderDto;
      const userId = (req as any).user?.id;
      const order = await this.orderService.createOrder(dto, userId);
      res.status(201).json(ApiResponse.success(order, 'تم إنشاء طلب الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  updateOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as UpdateProductionOrderDto;
      const order = await this.orderService.updateOrder(orderId as string, dto);
      res.status(200).json(ApiResponse.success(order, 'تم تحديث بيانات طلب الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  updatePriority = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as UpdateProductionOrderPriorityDto;
      const order = await this.orderService.updatePriority(orderId as string, dto);
      res.status(200).json(ApiResponse.success(order, 'تم تحديث أولوية أمر الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  archiveOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      await this.orderService.archiveOrder(orderId as string);
      res.status(200).json(ApiResponse.success(null, 'تم أرشفة طلب الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 2. ORDER LINES OPERATIONS
  // ==========================================

  addLine = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as AddProductionOrderLineDto;
      const line = await this.orderService.addLine(orderId as string, dto);
      res.status(201).json(ApiResponse.success(line, 'تمت إضافة بند الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  addLinesBatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as BatchAddProductionOrderLinesDto;
      const lines = await this.orderService.addLinesBatch(orderId as string, dto);
      res.status(201).json(ApiResponse.success(lines, 'تمت إضافة بنود الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  updateLineQuantity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId, lineId } = req.params;
      const dto = req.body as UpdateProductionOrderLineDto;
      const line = await this.orderService.updateLineQuantity(
        orderId as string,
        lineId as string,
        dto
      );
      res.status(200).json(ApiResponse.success(line, 'تم تحديث كمية البند بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  archiveLine = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId, lineId } = req.params;
      await this.orderService.archiveLine(orderId as string, lineId as string);
      res.status(200).json(ApiResponse.success(null, 'تم أرشفة بند الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  reorderLines = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as ReorderProductionOrderLinesDto;
      const lines = await this.orderService.reorderLines(orderId as string, dto);
      res.status(200).json(ApiResponse.success(lines, 'تم إعادة ترتيب بنود الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 3. PATTERN SELECTIONS & SYNC
  // ==========================================

  changePatternSelection = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId, lineId, patternId } = req.params;
      const dto = req.body as UpdatePatternSelectionDto;
      const line = await this.orderService.changePatternSelection(
        orderId as string,
        lineId as string,
        patternId as string,
        dto
      );
      res.status(200).json(ApiResponse.success(line, 'تم تعديل خيار النمط بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  syncDraftLineSelections = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId, lineId } = req.params;
      const line = await this.orderService.syncDraftLineSelections(
        orderId as string,
        lineId as string
      );
      res.status(200).json(ApiResponse.success(line, 'تمت مزامنة خيارات البند مع القالب بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 4. RELEASE READINESS
  // ==========================================

  validateDraftForRelease = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const readiness = await this.orderService.validateDraftForRelease(orderId as string);
      res.status(200).json(ApiResponse.success(readiness));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 5. ATOMIC DRAFT COMMIT & SYNC PREVIEW
  // ==========================================

  commitDraftLines = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const dto = req.body as CommitProductionOrderDraftLinesDto;
      const order = await this.orderService.commitDraftLines(orderId as string, dto);
      res.status(200).json(ApiResponse.success(order, 'تم حفظ أمر الإنتاج بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  previewSyncDraftLine = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId, lineId } = req.params;
      const preview = await this.orderService.previewSyncDraftLine(
        orderId as string,
        lineId as string
      );
      res.status(200).json(ApiResponse.success(preview));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 6. ORDER APPROVAL & REOPEN WORKFLOW
  // ==========================================

  approveOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const currentUser = (req as any).user;
      if (!currentUser?.id) {
        throw new BusinessRuleError(
          'تعذر تحديد المستخدم الذي يقوم باعتماد أمر الإنتاج',
          'PRODUCTION_ORDER_APPROVER_REQUIRED'
        );
      }
      const order = await this.orderService.approveOrder(orderId as string, currentUser);
      res.status(200).json(ApiResponse.success(order, 'تم اعتماد أمر الإنتاج وتحويله إلى مذكرة إنتاج جاهزة للتصنيع'));
    } catch (error) {
      next(error);
    }
  };

  reopenOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const currentUser = (req as any).user;
      const order = await this.orderService.reopenOrder(orderId as string, currentUser);
      res.status(200).json(ApiResponse.success(order, 'تمت إعادة أمر الإنتاج إلى المسودة بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 7. EXECUTION PLANS & UNITS (PHASE 1)
  // ==========================================

  getOrderExecutionPlans = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const currentUser = req.user as AuthPrincipal | undefined;
      const plans = await this.executionPlanService.getPlansByOrderId(
        orderId as string,
        currentUser
      );
      res.status(200).json(ApiResponse.success(plans));
    } catch (error) {
      next(error);
    }
  };

  getExecutionPlanById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId, planId } = req.params;
      const currentUser = req.user as AuthPrincipal | undefined;
      const plan = await this.executionPlanService.getPlanById(
        orderId as string,
        planId as string,
        currentUser
      );
      if (!plan) {
        throw new NotFoundError(
          'الخطة التنفيذية غير موجودة في أمر الإنتاج المحدد',
          'PRODUCTION_EXECUTION_PLAN_NOT_FOUND'
        );
      }
      res.status(200).json(ApiResponse.success(plan));
    } catch (error) {
      next(error);
    }
  };

  getOrderUnits = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const currentUser = req.user as AuthPrincipal | undefined;
      const query = (req.validatedQuery ?? req.query) as unknown as ListProductionUnitsQueryDto;
      const units = await this.unitService.getUnitsByOrderId(
        orderId as string,
        currentUser,
        query
      );
      res.status(200).json(ApiResponse.success(units));
    } catch (error) {
      next(error);
    }
  };

  getUnitEvents = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId, unitId } = req.params;
      const currentUser = req.user as AuthPrincipal | undefined;
      const query = (req.validatedQuery ?? req.query) as unknown as ListProductionUnitEventsQueryDto;
      const events = await this.unitService.getUnitEvents(
        orderId as string,
        unitId as string,
        currentUser,
        query
      );
      res.status(200).json(ApiResponse.success(events));
    } catch (error) {
      next(error);
    }
  };
}

export const productionOrderController = new ProductionOrderController();
