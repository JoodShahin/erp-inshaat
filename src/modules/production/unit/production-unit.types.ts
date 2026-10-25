import { ProductionUnitStatus } from './production-unit.entity.js';
import { ProductionUnitEventType } from './production-unit-event.entity.js';

export { ProductionUnitStatus } from './production-unit.entity.js';
export { ProductionUnitEventType } from './production-unit-event.entity.js';

export interface ProductionUnitEventDto {
  id: string;
  unitId: string;
  eventType: string;
  createdByUserId: string | null;
  createdByUser?: {
    id: string;
    fullName: string;
  } | null;
  occurredAt: Date;
  departmentId: string | null;
  executionTaskId: string | null;
  previousData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ProductionUnitDto {
  id: string;
  orderId: string;
  orderLineId: string;
  planId: string;
  unitSequence: number;
  unitNumber: string;
  code: string | null;
  currentYardId: string | null;
  currentYardName?: string | null;
  status: ProductionUnitStatus;
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  events?: ProductionUnitEventDto[];
}

export interface OrderUnitsSummaryDto {
  totalUnits: number;
  createdUnits: number;
  inProgressUnits: number;
  completedUnits: number;
  cancelledUnits: number;
}
