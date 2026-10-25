import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository, IsNull, In } from 'typeorm';
import { AppDataSource } from '../../../database/data-source.js';
import {
  ProductionExecutionPlanEntity,
  ExecutionPlanPatternSummaryItem,
  ExecutionPlanSpecificationSnapshot,
} from './production-execution-plan.entity.js';
import {
  ProductionExecutionTaskEntity,
  ExecutionTaskSource,
  ExecutionTaskPlannedMaterialSnapshot,
  ExecutionTaskAttachmentSnapshot,
} from './production-execution-task.entity.js';
import { ProductionOrderEntity } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
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
import { NotFoundError } from '../../../common/errors/not-found.error.js';
import { ForbiddenError } from '../../../common/errors/forbidden.error.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import {
  authorizationService,
  AuthorizationService,
} from '../../system/authorization/authorization.service.js';
import {
  productionAccessPolicyService,
  ProductionAccessPolicyService,
} from '../authorization/production-access-policy.service.js';
import {
  productionResponsibilityResolver,
  ProductionResponsibilityResolver,
} from '../authorization/production-responsibility.resolver.js';
import { ResolvedProductionAccessPolicy } from '../authorization/production-access-policy.types.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';

export class ProductionExecutionPlanService {
  private orderRepo: Repository<ProductionOrderEntity>;
  private planRepo: Repository<ProductionExecutionPlanEntity>;
  private taskRepo: Repository<ProductionExecutionTaskEntity>;

  constructor(
    private dataSource: DataSource = AppDataSource,
    private authzService: AuthorizationService = authorizationService,
    private policyService: ProductionAccessPolicyService = productionAccessPolicyService,
    private respResolver: ProductionResponsibilityResolver = productionResponsibilityResolver
  ) {
    this.orderRepo = this.dataSource.getRepository(ProductionOrderEntity);
    this.planRepo = this.dataSource.getRepository(ProductionExecutionPlanEntity);
    this.taskRepo = this.dataSource.getRepository(ProductionExecutionTaskEntity);
  }

  /**
   * Generates an immutable, isolated Execution Plan and its Execution Tasks
   * for a specific production order line within a database transaction.
   *
   * Invariants:
   * 1. 1-to-1 unique mapping between line and execution plan.
   * 2. Snapshots all required metadata (including technical specifications)
   *    so future template edits never affect this plan.
   * 3. Extracts only general tasks (stages) and tasks for selected pattern options.
   * 4. Excludes any unselected pattern options and their tasks.
   * 5. Does NOT create empty task execution records for units.
   * 6. Strict fail-closed validation: corrupt/missing workflow entities throw BusinessRuleError.
   * 7. Targeted batch queries: avoids full-table scans.
   */
  async createPlanForLine(
    line: ProductionOrderLineEntity,
    manager: EntityManager
  ): Promise<{ plan: ProductionExecutionPlanEntity; tasks: ProductionExecutionTaskEntity[] }> {
    const planRepo = manager.getRepository(ProductionExecutionPlanEntity);
    const taskRepo = manager.getRepository(ProductionExecutionTaskEntity);
    const templateRepo = manager.getRepository(ProductionTemplateEntity);
    const specRepo = manager.getRepository(ProductionTemplateSpecificationEntity);
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

    // 5. Snapshot technical specifications of the template
    const specifications = await specRepo.find({
      where: { templateId: template.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const specificationsSnapshot: ExecutionPlanSpecificationSnapshot[] = specifications.map((s) => ({
      name: s.name,
      value: s.value,
      unit: s.unit,
      sortOrder: s.sortOrder,
    }));

    // 6. Create Execution Plan Entity
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
      specifications: specificationsSnapshot.length > 0 ? specificationsSnapshot : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await planRepo.save(plan);

    // 7. Load workflow items for template in strict sortOrder
    const workflowItems = await workflowItemRepo.find({
      where: { templateId: template.id, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    // Determine referenced stage IDs and pattern option IDs
    const neededStageIds: string[] = [];
    const neededOptionIds: string[] = [];

    for (const wfItem of workflowItems) {
      if (wfItem.itemType === 'STAGE') {
        if (!wfItem.stageId) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: عنصر سير العمل لا يحتوي على مرحلة صالحة`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }
        neededStageIds.push(wfItem.stageId);
      } else if (wfItem.itemType === 'PATTERN') {
        if (!wfItem.patternId) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: عنصر سير العمل لا يحتوي على نمط صالح`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }
        const selection = selections.find((s) => s.templatePatternId === wfItem.patternId);
        if (!selection) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: لم يتم تحديد خيار للنمط (${wfItem.patternId})`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }
        neededOptionIds.push(selection.selectedOptionId);
      }
    }

    // Load referenced stages and options with fail-closed validation
    const stages = neededStageIds.length > 0
      ? await stageRepo.find({ where: { id: In(neededStageIds), deletedAt: IsNull() } })
      : [];
    const stageMap = new Map(stages.map((s) => [s.id, s]));

    for (const stageId of neededStageIds) {
      if (!stageMap.has(stageId)) {
        throw new BusinessRuleError(
          `بيانات القالب غير متسقة: مرحلة سير العمل (${stageId}) غير موجودة أو معطلة`,
          'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
        );
      }
    }

    const optionTasks = neededOptionIds.length > 0
      ? await optionTaskRepo.find({
          where: { optionId: In(neededOptionIds), deletedAt: IsNull() },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const optionTasksByOptionId = new Map<string, ProductionTemplatePatternOptionTaskEntity[]>();
    for (const ot of optionTasks) {
      const list = optionTasksByOptionId.get(ot.optionId) || [];
      list.push(ot);
      optionTasksByOptionId.set(ot.optionId, list);
    }

    const optionTaskIds = optionTasks.map((t) => t.id);

    // Batch load materials and attachments for referenced stages and option tasks
    const [stageMaterials, stageAttachments, optionTaskMaterials, optionTaskAttachments] = await Promise.all([
      neededStageIds.length > 0
        ? stageMatRepo.find({ where: { stageId: In(neededStageIds) } })
        : Promise.resolve([]),
      neededStageIds.length > 0
        ? stageAttRepo.find({
            where: { stageId: In(neededStageIds), deletedAt: IsNull() },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
          })
        : Promise.resolve([]),
      optionTaskIds.length > 0
        ? optionTaskMatRepo.find({ where: { taskId: In(optionTaskIds) } })
        : Promise.resolve([]),
      optionTaskIds.length > 0
        ? optionTaskAttRepo.find({
            where: { taskId: In(optionTaskIds), deletedAt: IsNull() },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
          })
        : Promise.resolve([]),
    ]);

    // Map materials and attachments by parent
    const stageMaterialsMap = new Map<string, ProductionTemplateStageMaterialEntity[]>();
    for (const sm of stageMaterials) {
      const list = stageMaterialsMap.get(sm.stageId) || [];
      list.push(sm);
      stageMaterialsMap.set(sm.stageId, list);
    }

    const stageAttachmentsMap = new Map<string, ProductionTemplateStageAttachmentEntity[]>();
    for (const sa of stageAttachments) {
      const list = stageAttachmentsMap.get(sa.stageId) || [];
      list.push(sa);
      stageAttachmentsMap.set(sa.stageId, list);
    }

    const optionTaskMaterialsMap = new Map<string, ProductionTemplatePatternOptionTaskMaterialEntity[]>();
    for (const otm of optionTaskMaterials) {
      const list = optionTaskMaterialsMap.get(otm.taskId) || [];
      list.push(otm);
      optionTaskMaterialsMap.set(otm.taskId, list);
    }

    const optionTaskAttachmentsMap = new Map<string, ProductionTemplatePatternOptionTaskAttachmentEntity[]>();
    for (const ota of optionTaskAttachments) {
      const list = optionTaskAttachmentsMap.get(ota.taskId) || [];
      list.push(ota);
      optionTaskAttachmentsMap.set(ota.taskId, list);
    }

    // Collect targeted department IDs, product IDs, and unit IDs (ZERO FULL TABLE SCANS)
    const referencedDeptIds = new Set<string>();
    for (const s of stages) {
      if (s.departmentId) referencedDeptIds.add(s.departmentId);
    }
    for (const ot of optionTasks) {
      if (ot.departmentId) referencedDeptIds.add(ot.departmentId);
    }

    const referencedProductIds = new Set<string>();
    const referencedUnitIds = new Set<string>();
    for (const sm of stageMaterials) {
      if (sm.productId) referencedProductIds.add(sm.productId);
      if (sm.productUnitId) referencedUnitIds.add(sm.productUnitId);
    }
    for (const otm of optionTaskMaterials) {
      if (otm.productId) referencedProductIds.add(otm.productId);
      if (otm.productUnitId) referencedUnitIds.add(otm.productUnitId);
    }

    const [deptRecords, productRecords, unitRecords] = await Promise.all([
      referencedDeptIds.size > 0
        ? deptRepo.find({ where: { id: In(Array.from(referencedDeptIds)) }, withDeleted: true })
        : Promise.resolve([]),
      referencedProductIds.size > 0
        ? productRepo.find({ where: { id: In(Array.from(referencedProductIds)) }, withDeleted: true })
        : Promise.resolve([]),
      referencedUnitIds.size > 0
        ? unitRepo.find({ where: { id: In(Array.from(referencedUnitIds)) }, withDeleted: true })
        : Promise.resolve([]),
    ]);

    const deptMap = new Map(deptRecords.map((d) => [d.id, d.name]));
    const productMap = new Map(productRecords.map((p) => [p.id, p]));
    const unitNameMap = new Map(unitRecords.map((u) => [u.id, u.name]));

    const executionTasks: ProductionExecutionTaskEntity[] = [];
    let taskSequence = 1;

    for (const wfItem of workflowItems) {
      if (wfItem.itemType === 'STAGE' && wfItem.stageId) {
        const stage = stageMap.get(wfItem.stageId);
        if (!stage) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: مرحلة سير العمل (${wfItem.stageId}) غير موجودة أو معطلة`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }

        const materials = stageMaterialsMap.get(stage.id) || [];
        const materialsSnapshot: ExecutionTaskPlannedMaterialSnapshot[] = materials.map((sm) => {
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

        const attachments = stageAttachmentsMap.get(stage.id) || [];
        const attachmentsSnapshot: ExecutionTaskAttachmentSnapshot[] = attachments.map((sa) => ({
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
        const selection = selections.find((s) => s.templatePatternId === wfItem.patternId);
        if (!selection) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: لم يتم تحديد خيار للنمط (${wfItem.patternId})`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }

        const pattern = patternMap.get(wfItem.patternId);
        if (!pattern) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: النمط (${wfItem.patternId}) غير موجود أو معطل`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }

        const option = optionMap.get(selection.selectedOptionId);
        if (!option) {
          throw new BusinessRuleError(
            `بيانات القالب غير متسقة: خيار النمط المعتمد (${selection.selectedOptionId}) غير موجود أو معطل`,
            'PRODUCTION_TEMPLATE_WORKFLOW_INCONSISTENT'
          );
        }

        const tasksForOption = optionTasksByOptionId.get(option.id) || [];
        for (const oTask of tasksForOption) {
          const taskMaterials = optionTaskMaterialsMap.get(oTask.id) || [];
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

          const taskAttachments = optionTaskAttachmentsMap.get(oTask.id) || [];
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
            templatePatternId: pattern.id,
            patternName: pattern.name,
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
   * Throws NotFoundError if the order does not exist or is soft-deleted.
   */
  async getPlansByOrderId(
    orderId: string,
    currentUser?: AuthPrincipal,
    manager?: EntityManager
  ): Promise<ExecutionPlanDto[]> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const planRepo = manager ? manager.getRepository(ProductionExecutionPlanEntity) : this.planRepo;
    const taskRepo = manager ? manager.getRepository(ProductionExecutionTaskEntity) : this.taskRepo;

    const order = await orderRepo.findOne({
      where: { id: orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    let policy: ResolvedProductionAccessPolicy | null = null;
    if (currentUser) {
      const rules = await this.authzService.getApplicableAccessRules(
        currentUser,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      const responsibility = await this.respResolver.resolve(currentUser);
      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError(
          'ليس لديك صلاحية لعرض الخطط التنفيذية لأمر الإنتاج',
          'AUTHORIZATION_DENIED'
        );
      }
    }

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
      let planTasks = tasksByPlanMap.get(p.id) || [];
      if (policy && policy.denyDepartmentIds.length > 0) {
        planTasks = planTasks.filter(
          (t) => !t.departmentId || !policy!.denyDepartmentIds.includes(t.departmentId)
        );
      }
      return this.toPlanDto(p, planTasks);
    });
  }

  /**
   * Retrieves an execution plan by its ID and validates resource ownership against orderId.
   * Throws NotFoundError if the order does not exist or is soft-deleted.
   */
  async getPlanById(
    orderIdOrPlanId: string,
    maybePlanIdOrUser?: string | AuthPrincipal,
    maybeUser?: AuthPrincipal,
    manager?: EntityManager
  ): Promise<ExecutionPlanDto | null> {
    const orderRepo = manager ? manager.getRepository(ProductionOrderEntity) : this.orderRepo;
    const planRepo = manager ? manager.getRepository(ProductionExecutionPlanEntity) : this.planRepo;
    const taskRepo = manager ? manager.getRepository(ProductionExecutionTaskEntity) : this.taskRepo;

    let targetPlanId: string;
    let expectedOrderId: string | null = null;
    let currentUser: AuthPrincipal | undefined;

    if (typeof maybePlanIdOrUser === 'string') {
      expectedOrderId = orderIdOrPlanId;
      targetPlanId = maybePlanIdOrUser;
      currentUser = maybeUser;
    } else {
      targetPlanId = orderIdOrPlanId;
      if (maybePlanIdOrUser && typeof maybePlanIdOrUser === 'object' && 'id' in maybePlanIdOrUser) {
        currentUser = maybePlanIdOrUser as AuthPrincipal;
      }
    }

    const plan = await planRepo.findOne({
      where: {
        id: targetPlanId,
        ...(expectedOrderId ? { orderId: expectedOrderId } : {}),
        deletedAt: IsNull(),
      },
    });

    if (!plan) return null;

    const order = await orderRepo.findOne({
      where: { id: plan.orderId, deletedAt: IsNull() },
    });
    if (!order) {
      throw new NotFoundError('طلب الإنتاج غير موجود أو تم أرشفته', 'PRODUCTION_ORDER_NOT_FOUND');
    }

    let policy: ResolvedProductionAccessPolicy | null = null;
    if (currentUser) {
      const rules = await this.authzService.getApplicableAccessRules(
        currentUser,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      const responsibility = await this.respResolver.resolve(currentUser);
      policy = this.policyService.resolvePolicy(
        rules,
        responsibility,
        SystemPermission.PRODUCTION_ORDER_VIEW
      );
      if (policy.denyAll || !policy.hasAnyAccess) {
        throw new ForbiddenError(
          'ليس لديك صلاحية لعرض الخطة التنفيذية لأمر الإنتاج',
          'AUTHORIZATION_DENIED'
        );
      }
    }

    const tasks = await taskRepo.find({
      where: { planId: plan.id, deletedAt: IsNull() },
      order: { sortOrder: 'ASC' },
    });

    let visibleTasks = tasks;
    if (policy && policy.denyDepartmentIds.length > 0) {
      visibleTasks = tasks.filter(
        (t) => !t.departmentId || !policy!.denyDepartmentIds.includes(t.departmentId)
      );
    }

    return this.toPlanDto(plan, visibleTasks);
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
      specifications: plan.specifications,
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
