import { Router, Request, Response } from 'express';
import { requireWebAuth, redirectIfAuthenticated } from '../modules/system/auth/auth.middleware.js';
import { requirePermission } from '../modules/system/authorization/authorization.middleware.js';
import { requireProductionAccess } from '../modules/production/authorization/production-authorization.middleware.js';
import { SystemPermission } from '../modules/system/permission/constants/system-permission.enum.js';
import { validateUuidParam } from '../common/middleware/validate-uuid-param.middleware.js';
import { userWebController } from '../modules/system/user/user.web.controller.js';
import { roleWebController } from '../modules/system/role/role.web.controller.js';
import { productionDepartmentWebController } from '../modules/production/department/production-department.web.controller.js';
import { productionYardWebController } from '../modules/production/yard/production-yard.web.controller.js';
import { productionTeamWebController } from '../modules/production/team/production-team.web.controller.js';

import { userPortfolioWebController } from '../modules/system/user/portfolio/user-portfolio.web.controller.js';
import { inventoryCategoryWebController } from '../modules/inventory/category/inventory-category.web.controller.js';
import { inventoryProductWebController } from '../modules/inventory/product/inventory-product.web.controller.js';
import { inventoryHomeWebController } from '../modules/inventory/inventory.web.controller.js';
import { productionTemplateWebController } from '../modules/production/template/production-template.web.controller.js';
import { productionOrderWebController } from '../modules/production/order/production-order.web.controller.js';

const webRouter: Router = Router();


// GET / - Home Applications Launcher Page (Protected)
webRouter.get('/', requireWebAuth, (_req: Request, res: Response) => {
  res.render('dashboard/index', {
    title: 'نظام ERP',
    appName: 'نظام ERP',
    themeColor: '#714B67',
    hasSidebar: false,
    sidebarPath: null,
  });
});

// GET /login - Login Page (Redirect if authenticated)
webRouter.get('/login', redirectIfAuthenticated, (_req: Request, res: Response) => {
  res.render('login', {
    layout: false,
    title: 'تسجيل الدخول - ERP',
  });
});

// GET /system - System Dashboard (Protected)
webRouter.get('/system', requireWebAuth, (_req: Request, res: Response) => {
  res.render('dashboard/system/index', {
    layout: 'dashboard/system/layout',
    title: 'لوحة التحكم | إدارة النظام',
    appName: 'إدارة النظام',
    themeColor: '#714B67',
    hasSidebar: true,
    sidebarPath: 'system/partials/sidebar',
    activeTab: 'dashboard',
  });
});

// GET /system/users - System Users List (Protected)
webRouter.get(
  '/system/users',
  requireWebAuth,
  requirePermission(SystemPermission.USER_VIEW),
  userWebController.renderUsersList
);

// GET /system/users/create - Create User Page (Protected) - Must precede :id routes
webRouter.get(
  '/system/users/create',
  requireWebAuth,
  requirePermission(SystemPermission.USER_CREATE),
  userWebController.renderCreateUserForm
);

// GET /system/users/:id - User Portfolio Overview (Protected)
webRouter.get(
  '/system/users/:id',
  requireWebAuth,
  requirePermission(SystemPermission.USER_VIEW),
  validateUuidParam('id'),
  userPortfolioWebController.renderOverview
);

// GET /system/users/:id/account - User Portfolio Account Details (Protected)
webRouter.get(
  '/system/users/:id/account',
  requireWebAuth,
  requirePermission(SystemPermission.USER_VIEW),
  validateUuidParam('id'),
  userPortfolioWebController.renderAccount
);

// GET /system/users/:id/permissions - User Permissions Page (Protected)
webRouter.get(
  '/system/users/:id/permissions',
  requireWebAuth,
  requirePermission(SystemPermission.USER_VIEW),
  validateUuidParam('id'),
  userWebController.renderUserPermissionsForm
);

// GET /system/users/:id/production - User Production Responsibility (Protected)
webRouter.get(
  '/system/users/:id/production',
  requireWebAuth,
  requirePermission(SystemPermission.USER_VIEW),
  requireProductionAccess(SystemPermission.PRODUCTION_ASSIGNMENT_VIEW),
  validateUuidParam('id'),
  userPortfolioWebController.renderProduction
);

// GET /system/users/:id/edit - Edit User Page (Protected)
webRouter.get(
  '/system/users/:id/edit',
  requireWebAuth,
  requirePermission(SystemPermission.USER_UPDATE),
  validateUuidParam('id'),
  userWebController.renderEditUserForm
);

// GET /system/roles - System Roles List (Protected)
webRouter.get(
  '/system/roles',
  requireWebAuth,
  requirePermission(SystemPermission.ROLE_VIEW),
  roleWebController.renderRolesList
);

// GET /system/roles/create - Create Role Page (Protected)
webRouter.get(
  '/system/roles/create',
  requireWebAuth,
  requirePermission(SystemPermission.ROLE_CREATE),
  roleWebController.renderCreateRoleForm
);

// GET /system/roles/:id/edit - Edit Role Page (Protected)
webRouter.get(
  '/system/roles/:id/edit',
  requireWebAuth,
  requirePermission(SystemPermission.ROLE_UPDATE),
  validateUuidParam('id'),
  roleWebController.renderEditRoleForm
);

// GET /system/roles/:id/permissions - Role Permissions Page (Protected)
webRouter.get(
  '/system/roles/:id/permissions',
  requireWebAuth,
  requirePermission(SystemPermission.ROLE_VIEW),
  validateUuidParam('id'),
  roleWebController.renderRolePermissionsForm
);

// ==========================================
// PRODUCTION APPLICATION WEB ROUTES
// ==========================================

// GET /production - Production Dashboard (Protected)
webRouter.get('/production', requireWebAuth, (_req: Request, res: Response) => {
  res.render('dashboard/production/index', {
    layout: 'dashboard/production/layout',
    title: 'لوحة التحكم | إدارة الإنتاج',
    appName: 'إدارة الإنتاج',
    themeColor: '#0984E3',
    hasSidebar: true,
    sidebarPath: 'production/partials/sidebar',
    activeTab: 'dashboard',
  });
});

// GET /production/departments - Production Departments List (Protected)
webRouter.get(
  '/production/departments',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_DEPARTMENT_VIEW),
  productionDepartmentWebController.renderDepartmentsList
);

// GET /production/departments/create - Create Production Department Page (Protected)
webRouter.get(
  '/production/departments/create',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_DEPARTMENT_CREATE),
  productionDepartmentWebController.renderCreateDepartmentForm
);

// GET /production/departments/:id/edit - Edit Production Department Page (Protected)
webRouter.get(
  '/production/departments/:id/edit',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_DEPARTMENT_UPDATE),
  validateUuidParam('id'),
  productionDepartmentWebController.renderEditDepartmentForm
);

// GET /production/departments/:departmentId/team - Department Team Management Page (Protected)
webRouter.get(
  '/production/departments/:departmentId/team',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_ASSIGNMENT_VIEW),
  validateUuidParam('departmentId'),
  productionTeamWebController.renderDepartmentTeam
);

// GET /production/departments/:departmentId/team/engineers/create - Add Engineer Page (Protected)
webRouter.get(
  '/production/departments/:departmentId/team/engineers/create',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_ASSIGNMENT_MANAGE),
  validateUuidParam('departmentId'),
  productionTeamWebController.renderAddEngineerForm
);

// GET /production/departments/:departmentId/team/engineers/:assignmentId/edit - Edit Engineer Yards Page (Protected)
webRouter.get(
  '/production/departments/:departmentId/team/engineers/:assignmentId/edit',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_ASSIGNMENT_MANAGE),
  validateUuidParam('departmentId'),
  validateUuidParam('assignmentId'),
  productionTeamWebController.renderEditEngineerYardsForm
);

// GET /production/yards - Production Yards List (Protected)
webRouter.get(
  '/production/yards',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_VIEW),
  productionYardWebController.renderYardsList
);

// GET /production/yards/create - Create Production Yard Page (Protected)
webRouter.get(
  '/production/yards/create',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_CREATE),
  productionYardWebController.renderCreateYardForm
);

// GET /production/yards/:id/edit - Edit Production Yard Page (Protected)
webRouter.get(
  '/production/yards/:id/edit',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_UPDATE),
  validateUuidParam('id'),
  productionYardWebController.renderEditYardForm
);

// GET /production/yards/:id - Show Production Yard & Assigned Templates (Protected)
webRouter.get(
  '/production/yards/:id',
  requireWebAuth,
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_VIEW),
  validateUuidParam('id'),
  productionYardWebController.renderYardShow
);

// ==========================================
// INVENTORY MODULE WEB ROUTES (/inventory)
// ==========================================

// GET /inventory - Inventory Dashboard (Protected)
webRouter.get(
  '/inventory',
  requireWebAuth,
  inventoryHomeWebController.renderInventoryHome
);

// GET /inventory/categories - Inventory Categories Tree (Protected)
webRouter.get(
  '/inventory/categories',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_CATEGORY_VIEW),
  inventoryCategoryWebController.renderCategoryTree
);

// GET /inventory/categories/create - Create Category Page (Protected)
webRouter.get(
  '/inventory/categories/create',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_CATEGORY_CREATE),
  inventoryCategoryWebController.renderCategoryCreate
);

// GET /inventory/categories/:id/edit - Edit Category Page (Protected)
webRouter.get(
  '/inventory/categories/:id/edit',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_CATEGORY_UPDATE),
  validateUuidParam('id'),
  inventoryCategoryWebController.renderCategoryEdit
);

// GET /inventory/products - Products List (Protected)
webRouter.get(
  '/inventory/products',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_PRODUCT_VIEW),
  inventoryProductWebController.renderProductList
);

// GET /inventory/products/create - Create Product Page (Protected)
webRouter.get(
  '/inventory/products/create',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_PRODUCT_CREATE),
  inventoryProductWebController.renderProductCreate
);

// GET /inventory/products/:id - Product Detail Page (Protected)
webRouter.get(
  '/inventory/products/:id',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_PRODUCT_VIEW),
  validateUuidParam('id'),
  inventoryProductWebController.renderProductShow
);

// GET /inventory/products/:id/edit - Edit Product Page (Protected)
webRouter.get(
  '/inventory/products/:id/edit',
  requireWebAuth,
  requirePermission(SystemPermission.INVENTORY_PRODUCT_UPDATE),
  validateUuidParam('id'),
  inventoryProductWebController.renderProductEdit
);

// ==========================================
// Production Templates Web Routes (/production/templates)
// ==========================================

// GET /production/templates - Templates List (Protected)
webRouter.get(
  '/production/templates',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  productionTemplateWebController.renderTemplatesList
);

// GET /production/templates/create - Create Template Page (Protected)
webRouter.get(
  '/production/templates/create',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_CREATE),
  productionTemplateWebController.renderTemplateCreate
);

// GET /production/templates/:id - Template Details Page (Protected)
webRouter.get(
  '/production/templates/:id',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  productionTemplateWebController.renderTemplateShow
);

// ==========================================
// Production Orders Web Routes (/production/orders)
// ==========================================

// GET /production/orders - Orders List (Protected)
webRouter.get(
  '/production/orders',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  productionOrderWebController.renderOrdersList
);

// GET /production/orders/create - Create Order Page (Protected) - Must precede :id
webRouter.get(
  '/production/orders/create',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_ORDER_CREATE),
  productionOrderWebController.renderOrderCreate
);

// GET /production/orders/:id/edit - Order Editor Page (Protected)
webRouter.get(
  '/production/orders/:id/edit',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_ORDER_UPDATE),
  validateUuidParam('id'),
  productionOrderWebController.renderOrderEdit
);

// GET /production/orders/:id - Order Read-Only Details Page (Protected)
webRouter.get(
  '/production/orders/:id',
  requireWebAuth,
  requirePermission(SystemPermission.PRODUCTION_ORDER_VIEW),
  validateUuidParam('id'),
  productionOrderWebController.renderOrderShow
);

export { webRouter };



