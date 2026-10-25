import { DataSourceOptions } from 'typeorm';
import { envConfig } from './env.config.js';
import { RoleEntity } from '../modules/system/role/role.entity.js';
import { UserEntity } from '../modules/system/user/user.entity.js';
import { PermissionEntity } from '../modules/system/permission/permission.entity.js';
import { PermissionGrantEntity } from '../modules/system/permission-grant/permission-grant.entity.js';
import { AccessRuleEntity } from '../modules/system/access-rule/access-rule.entity.js';
import { SessionEntity } from '../modules/system/session/session.entity.js';
import { ProductionDepartmentEntity } from '../modules/production/department/production-department.entity.js';
import { ProductionYardEntity } from '../modules/production/yard/production-yard.entity.js';
import { ProductionDepartmentEngineerEntity } from '../modules/production/team/entities/production-department-engineer.entity.js';
import { ProductionYardEngineerEntity } from '../modules/production/team/entities/production-yard-engineer.entity.js';
import { InventoryCategoryEntity } from '../modules/inventory/category/inventory-category.entity.js';
import { InventoryProductEntity } from '../modules/inventory/product/inventory-product.entity.js';
import { InventoryProductUnitEntity } from '../modules/inventory/product/inventory-product-unit.entity.js';
import { ProductionTemplateEntity } from '../modules/production/template/production-template.entity.js';
import { ProductionTemplateSpecificationEntity } from '../modules/production/template-specification/production-template-specification.entity.js';
import { ProductionTemplateStageEntity } from '../modules/production/template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../modules/production/template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../modules/production/template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../modules/production/template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplatePatternEntity } from '../modules/production/template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../modules/production/template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../modules/production/template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../modules/production/template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../modules/production/template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionOrderSequenceEntity } from '../modules/production/order/production-order-sequence.entity.js';
import { ProductionOrderEntity } from '../modules/production/order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../modules/production/order-line/production-order-line.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../modules/production/order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { ProductionExecutionPlanEntity } from '../modules/production/execution-plan/production-execution-plan.entity.js';
import { ProductionExecutionTaskEntity } from '../modules/production/execution-plan/production-execution-task.entity.js';
import { ProductionUnitEntity } from '../modules/production/unit/production-unit.entity.js';
import { ProductionUnitEventEntity } from '../modules/production/unit/production-unit-event.entity.js';
import { CreateSystemCoreTables1710000000000 } from '../database/migrations/1710000000000-CreateSystemCoreTables.js';
import { CreateSystemSessionTable1710000000001 } from '../database/migrations/1710000000001-CreateSystemSessionTable.js';
import { CreateProductionDepartmentsAndYards1710000000002 } from '../database/migrations/1710000000002-CreateProductionDepartmentsAndYards.js';
import { CreateProductionTeamAssignments1710000000003 } from '../database/migrations/1710000000003-CreateProductionTeamAssignments.js';
import { CreateInventoryCategories1710000000004 } from '../database/migrations/1710000000004-CreateInventoryCategories.js';
import { CreateInventoryProductsAndUnits1710000000005 } from '../database/migrations/1710000000005-CreateInventoryProductsAndUnits.js';
import { HardenInventoryCatalogConstraints1710000000006 } from '../database/migrations/1710000000006-HardenInventoryCatalogConstraints.js';
import { CreateStudiesTemplateCoreTables1710000000007 } from '../database/migrations/1710000000007-CreateStudiesTemplateCoreTables.js';
import { MigrateStudiesToProductionTemplateTables1710000000008 } from '../database/migrations/1710000000008-MigrateStudiesToProductionTemplateTables.js';
import { HardenProductionTemplateCoreAndStageAttachments1710000000009 } from '../database/migrations/1710000000009-HardenProductionTemplateCoreAndStageAttachments.js';
import { FinalizeProductionTemplateHardening1710000000010 } from '../database/migrations/1710000000010-FinalizeProductionTemplateHardening.js';
import { AddProductionTemplateMixedWorkflowPatterns1710000000011 } from '../database/migrations/1710000000011-AddProductionTemplateMixedWorkflowPatterns.js';
import { HardenProductionTemplateMixedWorkflow1710000000012 } from '../database/migrations/1710000000012-HardenProductionTemplateMixedWorkflow.js';
import { CreateProductionOrderDraftingFoundation1710000000013 } from '../database/migrations/1710000000013-CreateProductionOrderDraftingFoundation.js';
import { AddProductionOrderLineConfigurationUniqueness1710000000014 } from '../database/migrations/1710000000014-AddProductionOrderLineConfigurationUniqueness.js';
import { AddProductionOrderApprovalStatus1710000000015 } from '../database/migrations/1710000000015-AddProductionOrderApprovalStatus.js';
import { AddProductionOrderPriority1710000000016 } from '../database/migrations/1710000000016-AddProductionOrderPriority.js';
import { CreateProductionExecutionPlansAndUnits1710000000017 } from '../database/migrations/1710000000017-CreateProductionExecutionPlansAndUnits.js';

export const databaseConfig: DataSourceOptions = {
  type: 'mysql',
  host: envConfig.db.host,
  port: envConfig.db.port,
  username: envConfig.db.username,
  password: envConfig.db.password,
  database: envConfig.db.database,
  synchronize: false,
  logging: envConfig.nodeEnv === 'development' ? ['error', 'warn'] : false,
  entities: [
    RoleEntity,
    UserEntity,
    PermissionEntity,
    PermissionGrantEntity,
    AccessRuleEntity,
    SessionEntity,
    ProductionDepartmentEntity,
    ProductionYardEntity,
    ProductionDepartmentEngineerEntity,
    ProductionYardEngineerEntity,
    InventoryCategoryEntity,
    InventoryProductEntity,
    InventoryProductUnitEntity,
    ProductionTemplateEntity,
    ProductionTemplateSpecificationEntity,
    ProductionTemplateStageEntity,
    ProductionTemplateStageMaterialEntity,
    ProductionTemplateStageAttachmentEntity,
    ProductionTemplateWorkflowItemEntity,
    ProductionTemplatePatternEntity,
    ProductionTemplatePatternOptionEntity,
    ProductionTemplatePatternOptionTaskEntity,
    ProductionTemplatePatternOptionTaskMaterialEntity,
    ProductionTemplatePatternOptionTaskAttachmentEntity,
    ProductionOrderSequenceEntity,
    ProductionOrderEntity,
    ProductionOrderLineEntity,
    ProductionOrderLinePatternSelectionEntity,
    ProductionExecutionPlanEntity,
    ProductionExecutionTaskEntity,
    ProductionUnitEntity,
    ProductionUnitEventEntity,
  ],
  migrations: [
    CreateSystemCoreTables1710000000000,
    CreateSystemSessionTable1710000000001,
    CreateProductionDepartmentsAndYards1710000000002,
    CreateProductionTeamAssignments1710000000003,
    CreateInventoryCategories1710000000004,
    CreateInventoryProductsAndUnits1710000000005,
    HardenInventoryCatalogConstraints1710000000006,
    CreateStudiesTemplateCoreTables1710000000007,
    MigrateStudiesToProductionTemplateTables1710000000008,
    HardenProductionTemplateCoreAndStageAttachments1710000000009,
    FinalizeProductionTemplateHardening1710000000010,
    AddProductionTemplateMixedWorkflowPatterns1710000000011,
    HardenProductionTemplateMixedWorkflow1710000000012,
    CreateProductionOrderDraftingFoundation1710000000013,
    AddProductionOrderLineConfigurationUniqueness1710000000014,
    AddProductionOrderApprovalStatus1710000000015,
    AddProductionOrderPriority1710000000016,
    CreateProductionExecutionPlansAndUnits1710000000017,
  ],
  subscribers: [],
};
