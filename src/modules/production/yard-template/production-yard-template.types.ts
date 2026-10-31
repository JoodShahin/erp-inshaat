import { ProductionYardTemplateEntity } from './production-yard-template.entity.js';

export interface ProductionYardTemplateDto {
  id: string;
  yardId: string;
  templateId: string;
  templateName: string;
  templateCode: string;
  templateDescription: string | null;
  templateIsActive: boolean;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface AvailableTemplateOptionDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  isAssigned: boolean;
}

export function toProductionYardTemplateDto(
  entity: ProductionYardTemplateEntity
): ProductionYardTemplateDto {
  return {
    id: entity.id,
    yardId: entity.yardId,
    templateId: entity.templateId,
    templateName: entity.template?.name || '',
    templateCode: entity.template?.code || '',
    templateDescription: entity.template?.description || null,
    templateIsActive: entity.template ? Boolean(entity.template.isActive) : true,
    createdAt: entity.createdAt,
    createdByUserId: entity.createdByUserId || null,
  };
}
