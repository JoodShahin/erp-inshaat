import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../../system/authorization/authorization.service.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import { productionTemplateService, ProductionTemplateService } from './production-template.service.js';
import {
  productionDepartmentService,
  ProductionDepartmentService,
} from '../department/production-department.service.js';
import {
  deriveConsecutiveDepartmentGroups,
  deriveMixedWorkflowGroups,
} from '../template-stage/consecutive-department-grouping.helper.js';
import { ProductionTemplateStageBrowserDto } from '../template-stage/production-template-stage.types.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';
import { safeJsonStringify } from './production-template.types.js';

export class ProductionTemplateWebController {
  constructor(
    private templateService: ProductionTemplateService = productionTemplateService,
    private departmentService: ProductionDepartmentService = productionDepartmentService
  ) {}

  renderTemplatesList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUser = req.user as AuthPrincipal;

      const canCreateTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_CREATE
      );
      const canUpdateTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_UPDATE
      );
      const canDeleteTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_DELETE
      );

      res.render('dashboard/production/templates/index', {
        layout: 'dashboard/production/layout',
        title: 'قوالب التصنيع - نظام ERP',
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'templates',
        user: currentUser,
        canCreateTemplate,
        canUpdateTemplate,
        canDeleteTemplate,
      });
    } catch (error) {
      next(error);
    }
  };

  renderTemplateCreate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUser = req.user as AuthPrincipal;

      const canCreateTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_CREATE
      );

      res.render('dashboard/production/templates/create', {
        layout: 'dashboard/production/layout',
        title: 'إنشاء قالب تصنيع جديد',
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'templates',
        user: currentUser,
        canCreateTemplate,
      });
    } catch (error) {
      next(error);
    }
  };

  renderTemplateShow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUser = req.user as AuthPrincipal;
      const { id } = req.params;

      const template = await this.templateService.getTemplateById(id as string);

      const canUpdateTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_UPDATE
      );
      const canDeleteTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_DELETE
      );

      // Load active production department references via service boundary (minimal { id, name, code })
      const departments = await this.departmentService.listActiveDepartments();

      // Transform stages to minimal browser DTO
      const rawStages = template.stages || [];
      const initialStages: ProductionTemplateStageBrowserDto[] = rawStages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        departmentId: stage.departmentId,
        departmentName: stage.departmentName || 'قسم غير محدد',
        departmentCode: stage.departmentCode || 'N/A',
        sortOrder: stage.sortOrder,
        estimatedDurationValue: stage.estimatedDurationValue ?? stage.estimatedDurationMinutes ?? null,
        estimatedDurationUnit: stage.estimatedDurationUnit ?? (stage.estimatedDurationMinutes ? TaskDurationUnit.MINUTES : null),
        estimatedDurationMinutes: stage.estimatedDurationMinutes,
        estimatedCost: stage.estimatedCost,
        plannedMaterialsCount: stage.plannedMaterialsCount || 0,
        attachmentsCount: stage.attachmentsCount || 0,
      }));

      // Calculate consecutive groups for presentation
      const consecutiveGroups = deriveConsecutiveDepartmentGroups(initialStages);
      const mixedGroups = deriveMixedWorkflowGroups(template.workflowItems || []);

      res.render('dashboard/production/templates/show', {
        layout: 'dashboard/production/layout',
        title: `${template.name} - تفاصيل قالب التصنيع`,
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'templates',
        user: currentUser,
        template,
        consecutiveGroups,
        mixedGroups,
        workflowItems: template.workflowItems || [],
        patterns: template.patterns || [],
        departments,
        initialStages,
        canUpdateTemplate,
        canDeleteTemplate,
        safeJsonStringify,
      });
    } catch (error) {
      next(error);
    }
  };

  renderTemplateEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUser = req.user as AuthPrincipal;
      const { id } = req.params;

      const template = await this.templateService.getTemplateById(id as string);

      const canUpdateTemplate = await authorizationService.hasPermission(
        currentUser,
        SystemPermission.PRODUCTION_TEMPLATE_UPDATE
      );

      res.render('dashboard/production/templates/edit', {
        layout: 'dashboard/production/layout',
        title: `تعديل قالب ${template.name}`,
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'templates',
        user: currentUser,
        template,
        canUpdateTemplate,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const productionTemplateWebController = new ProductionTemplateWebController();
