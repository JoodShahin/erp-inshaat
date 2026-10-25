import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull, In } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import { ProductionExecutionPlanEntity, ExecutionPlanPatternSummaryItem } from './production-execution-plan.entity.js';
import {
  ProductionExecutionTaskEntity,
  ExecutionTaskSource,
  ExecutionTaskPlannedMaterialSnapshot,
  ExecutionTaskAttachmentSnapshot,
} from './production-execution-task.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateStageAttachmentEntity } from '../template-stage-attachment/production-template-stage-attachment.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplatePatternOptionTaskEntity } from '../template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { ProductionOrderLinePatternSelectionEntity } from '../order-line-pattern-selection/production-order-line-pattern-selection.entity.js';
import { InventoryProductEntity } from '../../inventory/product/inventory-product.entity.js';
import { InventoryProductUnitEntity } from '../../inventory/product/inventory-product-unit.entity.js';
import {
  ExecutionPlanDto,
  ExecutionPlanSummaryDto,
  ExecutionTaskDto,
} from './production-execution-plan.types.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionExecutionPlanService {
  private planRepo: Repository<ProductionExecutionPlanEntity>;
  private taskRepo: Repository<ProductionExecutionTaskEntity>;

  constructor(private dataSource: DataSource = AppDataSource) {
    this.planRepo = this.dataSource.getRepository(ProductionExecutionPlanEntity);
    this.taskRepo = this.dataSource.getRepository(ProductionExecutionTaskEntity);
  }

  /**
   * Generates an immutable, isolated Execution Plan and its Execution Tasks
   * for a specific production order line within a database transaction.
   *
   * Invariants:
   * 1. 1-to-1 unique mapping between line and execution plan.
   * 2. Snapshots all required metadata so future template edits never affect this plan.
   * 3. Extracts only general tasks (stages) and tasks for selected pattern options.
   * 4. Excludes any unselected pattern options and their tasks.
   * 5. Does NOT create empty task execution records for units.
   */
  async createPlanForLine(
    line: ProductionOrderLineEntity,
    manager: EntityManager
  ): Promise<{ plan: ProductionExecutionPlanEntity; tasks: ProductionExecutionTaskEntity[] }> {
    const planRepo = manager.getRepository(ProductionExecutionPlanEntity);
    const taskRepo = manager.getRepository(ProductionExecutionTaskEntity);
    const templateRepo = manager.getRepository(ProductionTemplateEntity);
    const workflowItemRepo = manager.getRepository(ProductionTemplateWorkflowItemEntity);
    const stageRepo = manager.getRepository(ProductionTemplateStageEntity);
    const stageMatRepo = manager.getRepository(ProductionTemplateStageMaterialEntity);
    const stageAttRepo = manager.getRepository(ProductionTemplateStageAttachmentEntity);
    const patternRepo = manager.getRepository(ProductionTemplatePatternEntity);
    const optionRepo = manager.getRepository(ProductionTemplatePatternOptionEntity);
    const optionTaskRepo = manager.getRepository(ProductionTemplatePatternOptionTaskEntity);
    const optionTaskMatRepo = manager.getRepository(ProductionTemplatePatternOptionTaskMaterialEntity);
    const optionTaskAttRepo = manager.getRepository(ProductionTemplatePatternOptionTaskAttachmentEntity);
    const deptRepo = manager.getRepository(ProductionDepartmentEntity);
    const selectionRepo = manager.getRepository(ProductionOrderLinePatternSelectionEntity);
    const productRepo = manager.getRepository(InventoryProductEntity);
    const unitRepo = manager.getRepository(InventoryProductUnitEntity);

    // 1. Check idempotency: ensure no plan already exists for this line
    const existingPlan = await planRepo.findOne({
      where: { orderLineId: line.id },
    });
    if (existingPlan) {
      throw new BusinessRuleError(
        `تم بالفعل إنشاء خطة تنفيذية لهذا البند (#${line.sortOrder})`,
        'PRODUCTION_EXECUTION_PLAN_ALREADY_EXISTS'
      );
    }

    // 2. Load template details
    const template = await templateRepo.findOne({
      where: { id: line.templateId },
      withDeleted: true,
    });
    if (!template) {
      throw new BusinessRuleError(
        `القالب المرجعي للبند #${line.sortOrder} غير موجود`,
        'PRODUCTION_TEMPLATE_NOT_FOUND'
      );
    }

    // 3. Load pattern selections for this line
    const selections = await selectionRepo.find({
      where: { orderLineId: line.id },
    });

    const selectedOptionIds = selections.map((s) => s.selectedOptionId);
    const selectedPatternIds = selections.map((s) => s.templatePatternId);

    // 4. Batch load patterns and options for snapshot summary
    const patterns = selectedPatternIds.length > 0
      ? await patternRepo.find({ where: { id: In(selectedPatternIds) }, withDeleted: true })
      : [];
    const patternMap = new Map(patterns.map((p) => [p.id, p]));

    const options = selectedOptionIds.length > 0
      ? await optionRepo.find({ where: { id: In(selectedOptionIds) }, withDeleted: true })
      : [];
    const optionMap = new Map(options.map((o) => [o.id, o]));

    const patternSummary: ExecutionPlanPatternSummaryItem[] = selections.map((sel) => {
      const p = patternMap.get(sel.templatePatternId);
      const o = optionMap.get(sel.selectedOptionId);
      return {
        patternId: sel.templatePatternId,
        patternName: p ? p.name : 'نمط غير معروف',
        optionId: sel.selectedOptionId,
        optionName: o ? o.name : 'خيار غير معروف',
      };
    });

    // 5. Create Execution Plan Entity
    const planId = randomUUID();
    const plan = planRepo.create({
      id: planId,
      orderId: line.orderId,
      orderLineId: line.id,
      templateId: template.id,
      templateName: template.name,
      templateCode: template.code,
      templateReferenceNumber: template.referenceNumber,
      templateDescription: template.description,
      lineQuantity: line.quantity,
      configurationHash: line.activeConfigurationHash || '',
      patternSummary: patternSummary.length > 0 ? patternSummary : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await planRepo.save(plan);

    // 6. Load workflow items for template in strict sortOrder
    const workflowItems = await workflowItemRepo.find({
      where: { templateId: template.id, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    // Batch load all departments referenced to snapshot department names
    const allDepartments = await deptRepo.find({ withDeleted: true });
    const deptMap = new Map(allDepartments.map((d) => [d.id, d.name]));

    // Batch load products and product units for material snapshot names
    const allProducts = await productRepo.find({ withDeleted: true });
    const productMap = new Map(allProducts.map((p) => [p.id, p]));

    const allUnits = await unitRepo.find({ withDeleted: true });
    const unitNameMap = new Map(allUnits.map((u) => [u.id, u.name]));

    const executionTasks: ProductionExecutionTaskEntity[] = [];
    let taskSequence = 1;

    for (const wfItem of workflowItems) {
      if (wfItem.itemType === 'STAGE' && wfItem.stageId) {
        // General task (from Stage)
        const stage = await stageRepo.findOne({
          where: { id: wfItem.stageId, deletedAt: IsNull() },
        });
        if (!stage) continue;

        // Load planned materials for stage
        const stageMaterials = await stageMatRepo.find({
          where: { stageId: stage.id },
        });
        const materialsSnapshot: ExecutionTaskPlannedMaterialSnapshot[] = stageMaterials.map((sm) => {
          const prod = productMap.get(sm.productId);
          return {
            productId: sm.productId,
            productUnitId: sm.productUnitId,
            plannedQuantity: String(sm.plannedQuantity),
            productName: prod?.name,
            productCode: prod?.code,
            unitName: unitNameMap.get(sm.productUnitId),
          };
        });

        // Load attachments for stage
        const stageAttachments = await stageAttRepo.find({
          where: { stageId: stage.id, deletedAt: IsNull() },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        const attachmentsSnapshot: ExecutionTaskAttachmentSnapshot[] = stageAttachments.map((sa) => ({
          originalFileName: sa.originalFileName,
          storageKey: sa.storageKey,
          mimeType: sa.mimeType,
          sizeBytes: sa.sizeBytes,
          description: sa.description,
          sortOrder: sa.sortOrder,
        }));

        const execTask = taskRepo.create({
          id: randomUUID(),
          planId: plan.id,
          name: stage.name,
          description: stage.description,
          departmentId: stage.departmentId,
          departmentName: deptMap.get(stage.departmentId) || null,
          sortOrder: taskSequence++,
          taskSource: ExecutionTaskSource.GENERAL,
          sourceStageId: stage.id,
          sourceTaskId: null,
          templatePatternId: null,
          patternName: null,
          templatePatternOptionId: null,
          optionName: null,
          estimatedDurationMinutes: stage.estimatedDurationMinutes,
          estimatedCost: stage.estimatedCost,
          plannedMaterials: materialsSnapshot.length > 0 ? materialsSnapshot : null,
          attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : null,
          isActive: true,
          archivedAt: null,
        });

        executionTasks.push(execTask);
      } else if (wfItem.itemType === 'PATTERN' && wfItem.patternId) {
        // Pattern option tasks (from selected Option only)
        const selection = selections.find((s) => s.templatePatternId === wfItem.patternId);
        if (!selection) continue;

        const pattern = patternMap.get(wfItem.patternId);
        const option = optionMap.get(selection.selectedOptionId);
        if (!option) continue;

        // Load tasks belonging to this option
        const optionTasks = await optionTaskRepo.find({
          where: { optionId: option.id, deletedAt: IsNull() },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });

        for (const oTask of optionTasks) {
          // Load planned materials for option task
          const taskMaterials = await optionTaskMatRepo.find({
            where: { taskId: oTask.id },
          });
          const materialsSnapshot: ExecutionTaskPlannedMaterialSnapshot[] = taskMaterials.map((tm) => {
            const prod = productMap.get(tm.productId);
            return {
              productId: tm.productId,
              productUnitId: tm.productUnitId,
              plannedQuantity: String(tm.plannedQuantity),
              productName: prod?.name,
              productCode: prod?.code,
              unitName: unitNameMap.get(tm.productUnitId),
            };
          });

          // Load attachments for option task
          const taskAttachments = await optionTaskAttRepo.find({
            where: { taskId: oTask.id, deletedAt: IsNull() },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
          });
          const attachmentsSnapshot: ExecutionTaskAttachmentSnapshot[] = taskAttachments.map((ta) => ({
            originalFileName: ta.originalFileName,
            storageKey: ta.storageKey,
            mimeType: ta.mimeType,
            sizeBytes: ta.sizeBytes,
            description: ta.description,
            sortOrder: ta.sortOrder,
          }));

          const execTask = taskRepo.create({
            id: randomUUID(),
            planId: plan.id,
            name: oTask.name,
            description: oTask.description,
            departmentId: oTask.departmentId,
            departmentName: deptMap.get(oTask.departmentId) || null,
            sortOrder: taskSequence++,
            taskSource: ExecutionTaskSource.PATTERN_OPTION,
            sourceStageId: null,
            sourceTaskId: oTask.id,
            templatePatternId: pattern ? pattern.id : wfItem.patternId,
            patternName: pattern ? pattern.name : null,
            templatePatternOptionId: option.id,
            optionName: option.name,
            estimatedDurationMinutes: oTask.estimatedDurationMinutes,
            estimatedCost: oTask.estimatedCost,
            plannedMaterials: materialsSnapshot.length > 0 ? materialsSnapshot : null,
            attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : null,
            isActive: true,
            archivedAt: null,
          });

          executionTasks.push(execTask);
        }
      }
    }

    if (executionTasks.length > 0) {
      await taskRepo.save(executionTasks);
    }

    plan.tasks = executionTasks;
    return { plan, tasks: executionTasks };
  }

  /**
   * Retrieves all execution plans for an order with tasks and unit counts.
   */
  async getPlansByOrderId(
    orderId: string,
    manager?: EntityManager
  ): Promise<ExecutionPlanDto[]> {
    const planRepo = manager ? manager.getRepository(ProductionExecutionPlanEntity) : this.planRepo;
    const taskRepo = manager ? manager.getRepository(ProductionExecutionTaskEntity) : this.taskRepo;

    const plans = await planRepo.find({
      where: { orderId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    if (plans.length === 0) {
      return [];
    }

    const planIds = plans.map((p) => p.id);
    const tasks = await taskRepo.find({
      where: { planId: In(planIds), deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    const tasksByPlanMap = new Map<string, ProductionExecutionTaskEntity[]>();
    for (const t of tasks) {
      const list = tasksByPlanMap.get(t.planId) || [];
      list.push(t);
      tasksByPlanMap.set(t.planId, list);
    }

    return plans.map((p) => {
      const planTasks = tasksByPlanMap.get(p.id) || [];
      return this.toPlanDto(p, planTasks);
    });
  }

  /**
   * Retrieves an execution plan by its ID.
   */
  async getPlanById(
    planId: string,
    manager?: EntityManager
  ): Promise<ExecutionPlanDto | null> {
    const planRepo = manager ? manager.getRepository(ProductionExecutionPlanEntity) : this.planRepo;
    const taskRepo = manager ? manager.getRepository(ProductionExecutionTaskEntity) : this.taskRepo;

    const plan = await planRepo.findOne({
      where: { id: planId, deletedAt: IsNull() },
    });

    if (!plan) return null;

    const tasks = await taskRepo.find({
      where: { planId: plan.id, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    return this.toPlanDto(plan, tasks);
  }

  /**
   * Converts entity to clean client DTO without leaking internal ORM state.
   */
  private toPlanDto(
    plan: ProductionExecutionPlanEntity,
    tasks: ProductionExecutionTaskEntity[]
  ): ExecutionPlanDto {
    return {
      id: plan.id,
      orderId: plan.orderId,
      orderLineId: plan.orderLineId,
      templateId: plan.templateId,
      templateName: plan.templateName,
      templateCode: plan.templateCode,
      templateReferenceNumber: plan.templateReferenceNumber,
      templateDescription: plan.templateDescription,
      lineQuantity: plan.lineQuantity,
      configurationHash: plan.configurationHash,
      patternSummary: plan.patternSummary,
      tasksCount: tasks.length,
      unitsCount: plan.lineQuantity,
      tasks: tasks.map(this.toTaskDto),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  private toTaskDto(task: ProductionExecutionTaskEntity): ExecutionTaskDto {
    return {
      id: task.id,
      planId: task.planId,
      name: task.name,
      description: task.description,
      departmentId: task.departmentId,
      departmentName: task.departmentName,
      sortOrder: task.sortOrder,
      taskSource: task.taskSource,
      sourceStageId: task.sourceStageId,
      sourceTaskId: task.sourceTaskId,
      templatePatternId: task.templatePatternId,
      patternName: task.patternName,
      templatePatternOptionId: task.templatePatternOptionId,
      optionName: task.optionName,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      estimatedCost: task.estimatedCost,
      plannedMaterials: task.plannedMaterials,
      attachments: task.attachments,
      isActive: task.isActive,
      archivedAt: task.archivedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

export const productionExecutionPlanService = new ProductionExecutionPlanService();
