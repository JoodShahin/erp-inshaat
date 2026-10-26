import { ProductionTemplateStageEntity } from './production-template-stage.entity.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';

export { TaskDurationUnit } from '../task-duration/task-duration.types.js';

export interface ProductionTemplateStageDto {
  id: string;
  templateId: string;
  departmentId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  estimatedDurationValue?: number | null;
  estimatedDurationUnit?: TaskDurationUnit | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: string | null;
  createdAt: Date;
  updatedAt: Date;
  department?: {
    id: string;
    name: string;
    code: string;
  };
  plannedMaterials?: Array<{
    id: string;
    stageId: string;
    productId: string;
    productUnitId: string;
    plannedQuantity: string;
    product?: {
      id: string;
      name: string;
      code: string;
    };
    productUnit?: {
      id: string;
      name: string;
    };
  }>;
}

export function toProductionTemplateStageDto(
  stage: ProductionTemplateStageEntity
): ProductionTemplateStageDto {
  return {
    id: stage.id,
    templateId: stage.templateId,
    departmentId: stage.departmentId,
    name: stage.name,
    description: stage.description,
    sortOrder: stage.workflowItem?.sortOrder ?? stage.sortOrder ?? 0,
    estimatedDurationValue: stage.estimatedDurationValue ?? stage.estimatedDurationMinutes ?? null,
    estimatedDurationUnit: stage.estimatedDurationUnit ?? (stage.estimatedDurationMinutes ? TaskDurationUnit.MINUTES : null),
    estimatedDurationMinutes: stage.estimatedDurationMinutes,
    estimatedCost: stage.estimatedCost ? String(stage.estimatedCost) : null,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
    department: stage.department
      ? {
          id: stage.department.id,
          name: stage.department.name,
          code: stage.department.code,
        }
      : undefined,
  };
}


export interface ProductionTemplateStageBrowserDto {
  id: string;
  name: string;
  description: string | null;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  sortOrder: number;
  estimatedDurationValue?: number | null;
  estimatedDurationUnit?: TaskDurationUnit | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: string | null;
  plannedMaterialsCount: number;
  attachmentsCount: number;
}

export interface ConsecutiveDepartmentGroup<T = ProductionTemplateStageBrowserDto> {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  stages: T[];
}
