import { ProductionOrderLineDto } from '../order-line/production-order-line.types.js';
import { ProductionOrderPriority } from './production-order.entity.js';
import { OrderUnitsSummaryDto } from '../unit/production-unit.types.js';

export { ProductionOrderStatus, ProductionOrderPriority } from './production-order.entity.js';

export interface ProductionOrderUserSummaryDto {
  id: string;
  fullName: string;
}

export interface ProductionOrderSummaryDto {
  lineCount: number;
  totalQuantity: number;
  totalLinkedQuantity?: number;
  totalRemainingQuantity?: number;
}

export interface ProductionOrderDto {
  id: string;
  orderNumber: string;
  status: string;
  priority: ProductionOrderPriority;
  description: string | null;
  notes: string | null;
  approvedAt?: Date | null;
  approvedByUserId?: string | null;
  approvedByUser?: ProductionOrderUserSummaryDto | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUser?: ProductionOrderUserSummaryDto;
  summary: ProductionOrderSummaryDto;
  lines?: ProductionOrderLineDto[];
  hasExecutionPlans?: boolean;
  unitsSummary?: OrderUnitsSummaryDto | null;
}

export interface ProductionOrderListSummaryDto {
  totalOrders: number;
  draftOrders: number;
  approvedOrders: number;
  totalQuantity: number;
}

export interface ProductionOrderListItemDto {
  id: string;
  orderNumber: string;
  status: string;
  priority: ProductionOrderPriority;
  description: string | null;
  notes: string | null;
  approvedAt?: Date | null;
  approvedByUser?: ProductionOrderUserSummaryDto | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUser?: ProductionOrderUserSummaryDto;
  summary: ProductionOrderSummaryDto;
}

export interface PaginatedProductionOrdersResult {
  items: ProductionOrderListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: ProductionOrderListSummaryDto;
}

export interface ProductionOrderReadinessIssueDto {
  code: string;
  lineId?: string;
  patternId?: string;
  message: string;
}

export interface ProductionOrderReadinessDto {
  ready: boolean;
  issues: ProductionOrderReadinessIssueDto[];
}

export interface SyncPreviewAvailableOptionDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface SyncPreviewPatternDto {
  patternId: string;
  patternName: string;
  isRequired: boolean;
  options: SyncPreviewAvailableOptionDto[];
  currentSelection?: {
    optionId: string;
    optionName: string;
    isArchived: boolean;
  };
}

export interface SyncPreviewLinePatternSelectionDto {
  patternId: string;
  patternName: string;
  selectedOptionId: string | null;
  availableOptions: SyncPreviewAvailableOptionDto[];
  isHistorical: boolean;
  selectedOptionName: string | null;
}

export interface SyncDraftLinePreviewDto {
  lineId: string;
  templateId: string;
  templateName: string;
  resultingSelections: Array<{ patternId: string; optionId: string }>;
  patternSelections?: SyncPreviewLinePatternSelectionDto[];
  patterns: SyncPreviewPatternDto[];
  warnings: string[];
  hasChanges: boolean;
}

/**
 * Escapes characters that can break out of HTML/script contexts:
 * <, >, &, \u2028, \u2029
 * This guarantees safe serialization into <script type="application/json"> elements.
 */
export function safeJsonStringify(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
