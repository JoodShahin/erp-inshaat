import { ProductionOrderLinePatternSelectionDto } from '../order-line-pattern-selection/production-order-line-pattern-selection.types.js';
import { ExecutionPlanSummaryDto } from '../execution-plan/production-execution-plan.types.js';

export interface ProductionOrderLineTemplateSummaryDto {
  id: string;
  name: string;
  referenceNumber: string | null;
  code: string;
  isActive: boolean;
}

export interface ProductionOrderLineDto {
  id: string;
  orderId: string;
  templateId: string;
  quantity: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  template?: ProductionOrderLineTemplateSummaryDto;
  patternSelections: ProductionOrderLinePatternSelectionDto[];
  executionPlan?: ExecutionPlanSummaryDto | null;
  unitCount?: number;
}
