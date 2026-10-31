import { Request, Response, NextFunction } from 'express';
import { ProductionYardService, productionYardService } from './production-yard.service.js';
import { ProductionDepartmentService, productionDepartmentService } from '../department/production-department.service.js';
import {
  ProductionYardTemplateService,
  productionYardTemplateService,
} from '../yard-template/production-yard-template.service.js';
import { ListProductionYardsQueryDto } from './dto/list-production-yards-query.dto.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';
import { getProductionAccessPolicy } from '../authorization/production-authorization-context.js';
import { canAccessYard } from '../authorization/production-access-query.helper.js';

export class ProductionYardWebController {
  private readonly yardService: ProductionYardService;
  private readonly departmentService: ProductionDepartmentService;
  private readonly yardTemplateService: ProductionYardTemplateService;

  constructor(
    yardService: ProductionYardService = productionYardService,
    deptService: ProductionDepartmentService = productionDepartmentService,
    yardTemplateService: ProductionYardTemplateService = productionYardTemplateService
  ) {
    this.yardService = yardService;
    this.departmentService = deptService;
    this.yardTemplateService = yardTemplateService;
  }

  renderYardsList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
      const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId.trim() !== ''
        ? req.query.departmentId.trim()
        : undefined;

      const currentUser = req.user as AuthPrincipal;
      const viewPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_VIEW
      );
      const createPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_CREATE
      );
      const updatePolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_UPDATE
      );
      const deletePolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_DELETE
      );

      const queryDto: ListProductionYardsQueryDto = { page, limit, search, departmentId };
      const yardsData = await this.yardService.listYards(queryDto, viewPolicy);
      const accessibleDepartments = await this.yardService.listAccessibleDepartmentOptions(viewPolicy);
      const creatableDepartments = await this.departmentService.listActiveDepartmentsForPolicy(createPolicy);

      const yards = yardsData.items.map((yard) => ({
        ...yard,
        canUpdate: canAccessYard(updatePolicy, yard),
        canDelete: canAccessYard(deletePolicy, yard),
      }));

      res.render('dashboard/production/yards/index', {
        layout: 'dashboard/production/layout',
        title: 'ساحات الإنتاج',
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'yards',
        yards,
        departments: accessibleDepartments,
        selectedDepartmentId: departmentId || '',
        pagination: {
          page: yardsData.page,
          limit: yardsData.limit,
          total: yardsData.total,
          totalPages: yardsData.totalPages,
        },
        search: search || '',
        canCreate: creatableDepartments.length > 0,
      });
    } catch (error) {
      next(error);
    }
  };

  renderCreateYardForm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUser = req.user as AuthPrincipal;
      const createPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_CREATE
      );

      const permittedDepartments = await this.departmentService.listActiveDepartmentsForPolicy(createPolicy);

      res.render('dashboard/production/yards/create', {
        layout: 'dashboard/production/layout',
        title: 'إنشاء ساحة إنتاج جديدة',
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'yards',
        departments: permittedDepartments,
      });
    } catch (error) {
      next(error);
    }
  };

  renderEditYardForm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const currentUser = req.user as AuthPrincipal;
      const updatePolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_UPDATE
      );
      const yard = await this.yardService.getYardById(id as string, updatePolicy);
      const permittedDepartments = await this.departmentService.listActiveDepartmentsForPolicy(updatePolicy);

      // Ensure the current department is in the list even if user does not have department-level access to it
      const hasCurrentDept = permittedDepartments.some((d) => d.id === yard.departmentId);
      if (!hasCurrentDept && yard.departmentId) {
        permittedDepartments.push({
          id: yard.departmentId,
          name: yard.departmentName,
          code: '',
        });
      }

      res.render('dashboard/production/yards/edit', {
        layout: 'dashboard/production/layout',
        title: `تعديل ساحة الإنتاج: ${yard.name}`,
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'yards',
        yard,
        departments: permittedDepartments,
      });
    } catch (error) {
      next(error);
    }
  };

  renderYardShow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const currentUser = req.user as AuthPrincipal;

      const yardViewPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_VIEW
      );
      const yardUpdatePolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_UPDATE
      );
      const templatesViewPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW
      );
      const templatesAddPolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD
      );
      const templatesRemovePolicy = await getProductionAccessPolicy(
        req,
        currentUser,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE
      );

      const yard = await this.yardService.getYardById(id as string, yardViewPolicy);

      const canUpdate = canAccessYard(yardUpdatePolicy, yard);
      const canViewTemplates = canAccessYard(templatesViewPolicy, yard);
      const canAddTemplates = canAccessYard(templatesAddPolicy, yard);
      const canRemoveTemplates = canAccessYard(templatesRemovePolicy, yard);

      const assignedTemplates = canViewTemplates
        ? await this.yardTemplateService.listYardTemplates(yard.id, templatesViewPolicy)
        : [];

      res.render('dashboard/production/yards/show', {
        layout: 'dashboard/production/layout',
        title: `تفاصيل ساحة الإنتاج: ${yard.name}`,
        appName: 'إدارة الإنتاج',
        themeColor: '#0984E3',
        hasSidebar: true,
        sidebarPath: 'production/partials/sidebar',
        activeTab: 'yards',
        yard,
        canUpdate,
        canViewTemplates,
        canAddTemplates,
        canRemoveTemplates,
        assignedTemplates,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const productionYardWebController = new ProductionYardWebController();
