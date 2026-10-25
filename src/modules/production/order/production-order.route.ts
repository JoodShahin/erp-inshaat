import { Router } from 'express';
import { productionOrderController } from './production-order.controller.js';
import { requireApiAuth } from '../../system/auth/auth.middleware.js';
import { requirePermission } from '../../system/authorization/authorization.middleware.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { validateDto } from '../../../common/middleware/validate-dto.middleware.js';
import { validateQueryDto } from '../../../common/middleware/validate-query-dto.middleware.js';
import { validateUuidParam } from '../../../common/middleware/validate-uuid-param.middleware.js';
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

const productionOrderApiRouter: Router = Router();

productionOrderApiRouter.use(requireApiAuth);

// ==========================================
// 1. ORDERS CORE ENDPOINTS
// ==========================================

// GET /api/production/orders - List production orders (paginated, filtered)
productionOrderApiRouter.get(
  '/',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateQueryDto(ListProductionOrdersQueryDto),
  productionOrderController.listOrders
);

// POST /api/production/orders - Create DRAFT production order
productionOrderApiRouter.post(
  '/',
  requirePermission(SystemPermission.PRODUCTION_ORDER_CREATE),
  validateDto(CreateProductionOrderDto),
  productionOrderController.createOrder
);

// GET /api/production/orders/:orderId/release-readiness - Check release readiness (read-only)
productionOrderApiRouter.get(
  '/:orderId/release-readiness',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  productionOrderController.validateDraftForRelease
);

// GET /api/production/orders/:orderId - Get order details with lines and selections
productionOrderApiRouter.get(
  '/:orderId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  productionOrderController.getOrderById
);

// PATCH /api/production/orders/:orderId/priority - Update production order priority
productionOrderApiRouter.patch(
  '/:orderId/priority',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY),
  validateUuidParam('orderId'),
  validateDto(UpdateProductionOrderPriorityDto),
  productionOrderController.updatePriority
);

// PATCH /api/production/orders/:orderId - Update draft order header
productionOrderApiRouter.patch(
  '/:orderId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateDto(UpdateProductionOrderDto),
  productionOrderController.updateOrder
);

// DELETE /api/production/orders/:orderId - Archive draft order
productionOrderApiRouter.delete(
  '/:orderId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_DELETE),
  validateUuidParam('orderId'),
  productionOrderController.archiveOrder
);

// ==========================================
// 2. ORDER LINES ENDPOINTS
// ==========================================

// POST /api/production/orders/:orderId/lines/batch - Batch add lines to draft order (MUST be before :lineId)
productionOrderApiRouter.post(
  '/:orderId/lines/batch',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateDto(BatchAddProductionOrderLinesDto),
  productionOrderController.addLinesBatch
);

// POST /api/production/orders/:orderId/lines - Add line to draft order
productionOrderApiRouter.post(
  '/:orderId/lines',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateDto(AddProductionOrderLineDto),
  productionOrderController.addLine
);

// PATCH /api/production/orders/:orderId/lines/reorder - Reorder lines (MUST be before :lineId)
productionOrderApiRouter.patch(
  '/:orderId/lines/reorder',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateDto(ReorderProductionOrderLinesDto),
  productionOrderController.reorderLines
);

// PATCH /api/production/orders/:orderId/lines/:lineId - Update line quantity
productionOrderApiRouter.patch(
  '/:orderId/lines/:lineId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateUuidParam('lineId'),
  validateDto(UpdateProductionOrderLineDto),
  productionOrderController.updateLineQuantity
);

// DELETE /api/production/orders/:orderId/lines/:lineId - Archive line
productionOrderApiRouter.delete(
  '/:orderId/lines/:lineId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateUuidParam('lineId'),
  productionOrderController.archiveLine
);

// ==========================================
// 3. PATTERN SELECTIONS & SYNC ENDPOINTS
// ==========================================

// PATCH /api/production/orders/:orderId/lines/:lineId/patterns/:patternId - Change pattern selection
productionOrderApiRouter.patch(
  '/:orderId/lines/:lineId/patterns/:patternId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateUuidParam('lineId'),
  validateUuidParam('patternId'),
  validateDto(UpdatePatternSelectionDto),
  productionOrderController.changePatternSelection
);

// POST /api/production/orders/:orderId/lines/:lineId/sync-template - Sync line with template
productionOrderApiRouter.post(
  '/:orderId/lines/:lineId/sync-template',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateUuidParam('lineId'),
  productionOrderController.syncDraftLineSelections
);

// GET /api/production/orders/:orderId/lines/:lineId/sync-preview - Sync preview (Read-Only)
productionOrderApiRouter.get(
  '/:orderId/lines/:lineId/sync-preview',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateUuidParam('lineId'),
  productionOrderController.previewSyncDraftLine
);

// ==========================================
// 4. ATOMIC DRAFT LINES COMMIT
// ==========================================

// PUT /api/production/orders/:orderId/draft-lines - Commit entire draft line target set atomically
productionOrderApiRouter.put(
  '/:orderId/draft-lines',
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('orderId'),
  validateDto(CommitProductionOrderDraftLinesDto),
  productionOrderController.commitDraftLines
);

// ==========================================
// 5. ORDER APPROVAL & REOPEN WORKFLOW
// ==========================================

// POST /api/production/orders/:orderId/approve - Administrative approval of ready order
productionOrderApiRouter.post(
  '/:orderId/approve',
  requirePermission(SystemPermission.PRODUCTION_ORDER_APPROVE),
  validateUuidParam('orderId'),
  productionOrderController.approveOrder
);

// POST /api/production/orders/:orderId/reopen - Reopen approved order back to draft
productionOrderApiRouter.post(
  '/:orderId/reopen',
  requirePermission(SystemPermission.PRODUCTION_ORDER_APPROVE),
  validateUuidParam('orderId'),
  productionOrderController.reopenOrder
);

// ==========================================
// 6. EXECUTION PLANS & PRODUCTION UNITS (PHASE 1)
// ==========================================

// GET /api/production/orders/:orderId/execution-plans - List execution plans for an order
productionOrderApiRouter.get(
  '/:orderId/execution-plans',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  productionOrderController.getOrderExecutionPlans
);

// GET /api/production/orders/:orderId/execution-plans/:planId - Get execution plan detail
productionOrderApiRouter.get(
  '/:orderId/execution-plans/:planId',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  validateUuidParam('planId'),
  productionOrderController.getExecutionPlanById
);

// GET /api/production/orders/:orderId/units - List units for an order
productionOrderApiRouter.get(
  '/:orderId/units',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  validateQueryDto(ListProductionUnitsQueryDto),
  productionOrderController.getOrderUnits
);

// GET /api/production/orders/:orderId/units/:unitId/events - List history events of a unit
productionOrderApiRouter.get(
  '/:orderId/units/:unitId/events',
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('orderId'),
  validateUuidParam('unitId'),
  validateQueryDto(ListProductionUnitEventsQueryDto),
  productionOrderController.getUnitEvents
);

export { productionOrderApiRouter };
