import { ProductionTemplateEntity } from './production-template.entity.js';
import { ProductionTemplateWorkflowItemDto } from '../template-workflow-item/production-template-workflow-item.types.js';
import { ProductionTemplatePatternDto } from '../template-pattern/production-template-pattern.types.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';

export { TaskDurationUnit } from '../task-duration/task-duration.types.js';

export interface ProductionTemplateDto {
  id: string;
  name: string;
  code: string;
  referenceNumber: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductionTemplateListItemDto {
  id: string;
  name: string;
  code: string;
  referenceNumber: string | null;
  description: string | null;
  isActive: boolean;
  stagesCount: number;
  specsCount: number;
  patternsCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toProductionTemplateDto(entity: ProductionTemplateEntity): ProductionTemplateDto {
  return {
    id: entity.id,
    name: entity.name,
    code: entity.code,
    referenceNumber: entity.referenceNumber,
    description: entity.description,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toProductionTemplateListItemDto(
  entity: ProductionTemplateEntity,
  stagesCount = 0,
  specsCount = 0,
  patternsCount = 0
): ProductionTemplateListItemDto {
  return {
    id: entity.id,
    name: entity.name,
    code: entity.code,
    referenceNumber: entity.referenceNumber,
    description: entity.description,
    isActive: entity.isActive,
    stagesCount,
    specsCount,
    patternsCount,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export interface PaginatedProductionTemplatesResult {
  items: ProductionTemplateListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductionTemplateDetailSpecificationDto {
  id: string;
  name: string;
  value: string;
  unit: string | null;
  sortOrder: number;
}

export interface ProductionTemplateDetailStageDto {
  id: string;
  name: string;
  description: string | null;
  departmentId: string;
  departmentName?: string;
  departmentCode?: string;
  sortOrder: number;
  estimatedDurationValue?: number | null;
  estimatedDurationUnit?: TaskDurationUnit | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: string | null;
  plannedMaterialsCount: number;
  attachmentsCount: number;
}

export interface ProductionTemplateDetailDto {
  id: string;
  name: string;
  referenceNumber: string | null;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  specifications: ProductionTemplateDetailSpecificationDto[];
  /**
   * Derived compatibility field for consumers expecting stages.
   * Note: ProductionTemplateWorkflowItem is the true single source of truth for workflow ordering.
   */
  stages: ProductionTemplateDetailStageDto[];
  workflowItems: ProductionTemplateWorkflowItemDto[];
  patternsCount: number;
  patterns?: ProductionTemplatePatternDto[];
}

export interface ProductionTemplateReferenceOptionDto {
  id: string;
  name: string;
  code: string;
  referenceNumber: string | null;
}

export interface PaginatedTemplateReferenceOptionsResult {
  items: ProductionTemplateReferenceOptionDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductionTemplateOrderConfigOptionDto {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ProductionTemplateOrderConfigPatternDto {
  id: string;
  name: string;
  sortOrder?: number;
  options: ProductionTemplateOrderConfigOptionDto[];
  defaultOptionId: string | null;
}

export interface ProductionTemplateOrderConfigurationDto {
  templateId: string;
  templateName: string;
  patterns: ProductionTemplateOrderConfigPatternDto[];
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
