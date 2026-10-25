import { ExecutionTaskSource } from './production-execution-task.entity.js';

export { ExecutionTaskSource } from './production-execution-task.entity.js';

export interface ExecutionTaskDto {
  id: string;
  planId: string;
  name: string;
  description: string | null;
  departmentId: string;
  departmentName: string | null;
  sortOrder: number;
  taskSource: ExecutionTaskSource;
  sourceStageId: string | null;
  sourceTaskId: string | null;
  templatePatternId: string | null;
  patternName: string | null;
  templatePatternOptionId: string | null;
  optionName: string | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: string | null;
  plannedMaterials: Array<{
    productId: string;
    productUnitId: string;
    plannedQuantity: string;
    productName?: string;
    productCode?: string;
    unitName?: string;
  }> | null;
  attachments: Array<{
    originalFileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: string | number;
    description: string | null;
    sortOrder: number;
  }> | null;
  isActive: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionPlanPatternSummaryDto {
  patternId: string;
  patternName: string;
  optionId: string;
  optionName: string;
}

export interface ExecutionPlanSpecificationSnapshot {
  name: string;
  value: string;
  unit: string | null;
  sortOrder: number;
}

export interface ExecutionPlanDto {
  id: string;
  orderId: string;
  orderLineId: string;
  templateId: string;
  templateName: string;
  templateCode: string;
  templateReferenceNumber: string | null;
  templateDescription: string | null;
  lineQuantity: number;
  configurationHash: string;
  patternSummary: ExecutionPlanPatternSummaryDto[] | null;
  specifications?: ExecutionPlanSpecificationSnapshot[] | null;
  tasksCount: number;
  unitsCount: number;
  tasks?: ExecutionTaskDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionPlanSummaryDto {
  id: string;
  orderLineId: string;
  templateId: string;
  templateName: string;
  templateCode: string;
  lineQuantity: number;
  configurationHash: string;
  tasksCount: number;
  unitsCount: number;
}
