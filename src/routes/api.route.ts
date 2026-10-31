import { Router, Request, Response } from 'express';
import { authRouter } from '../modules/system/auth/auth.route.js';
import { userApiRouter } from '../modules/system/user/user.route.js';
import { roleApiRouter } from '../modules/system/role/role.route.js';
import { departmentApiRouter } from '../modules/production/department/production-department.route.js';
import { yardApiRouter } from '../modules/production/yard/production-yard.route.js';
import { yardTemplateApiRouter } from '../modules/production/yard-template/production-yard-template.route.js';
import { productionTeamApiRouter } from '../modules/production/team/production-team.route.js';
import { inventoryCategoryApiRouter } from '../modules/inventory/category/inventory-category.route.js';
import { inventoryProductApiRouter } from '../modules/inventory/product/inventory-product.route.js';
import { productionTemplateApiRouter } from '../modules/production/template/production-template.route.js';
import { productionOrderApiRouter } from '../modules/production/order/production-order.route.js';

const apiRouter: Router = Router();

// Public Health Check
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Authentication Routes (/api/auth)
apiRouter.use('/auth', authRouter);

// System Users Routes (/api/system/users)
apiRouter.use('/system/users', userApiRouter);

// System Roles Routes (/api/system/roles)
apiRouter.use('/system/roles', roleApiRouter);

// Production Departments Routes (/api/production/departments)
apiRouter.use('/production/departments', departmentApiRouter);
apiRouter.use('/production/departments', productionTeamApiRouter);

// Production Yards Routes (/api/production/yards)
apiRouter.use('/production/yards', yardTemplateApiRouter);
apiRouter.use('/production/yards', yardApiRouter);

// Inventory Categories Routes (/api/inventory/categories)
apiRouter.use('/inventory/categories', inventoryCategoryApiRouter);

// Inventory Products Routes (/api/inventory/products)
apiRouter.use('/inventory/products', inventoryProductApiRouter);

// Production Templates Routes (/api/production/templates)
apiRouter.use('/production/templates', productionTemplateApiRouter);

// Production Orders Routes (/api/production/orders)
apiRouter.use('/production/orders', productionOrderApiRouter);

export { apiRouter };




