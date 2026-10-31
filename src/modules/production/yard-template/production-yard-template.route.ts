import { Router } from 'express';
import { productionYardTemplateController } from './production-yard-template.controller.js';
import { requireApiAuth } from '../../system/auth/auth.middleware.js';
import { requireProductionAccess } from '../authorization/production-authorization.middleware.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { validateDto } from '../../../common/middleware/validate-dto.middleware.js';
import { validateUuidParam } from '../../../common/middleware/validate-uuid-param.middleware.js';
import { AssignTemplatesToYardDto } from './dto/assign-templates-to-yard.dto.js';

const yardTemplateApiRouter: Router = Router({ mergeParams: true });

yardTemplateApiRouter.use(requireApiAuth);

// GET /api/production/yards/:yardId/templates - List templates assigned to a yard
yardTemplateApiRouter.get(
  '/:yardId/templates',
  validateUuidParam('yardId'),
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW),
  productionYardTemplateController.listYardTemplates
);

// GET /api/production/yards/:yardId/templates/available - List templates available for assignment
yardTemplateApiRouter.get(
  '/:yardId/templates/available',
  validateUuidParam('yardId'),
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW),
  productionYardTemplateController.getAvailableTemplates
);

// POST /api/production/yards/:yardId/templates - Assign templates to a yard
yardTemplateApiRouter.post(
  '/:yardId/templates',
  validateUuidParam('yardId'),
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD),
  validateDto(AssignTemplatesToYardDto),
  productionYardTemplateController.assignTemplates
);

// DELETE /api/production/yards/:yardId/templates/:templateId - Remove template assignment
yardTemplateApiRouter.delete(
  '/:yardId/templates/:templateId',
  validateUuidParam('yardId'),
  validateUuidParam('templateId'),
  requireProductionAccess(SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE),
  productionYardTemplateController.removeTemplate
);

export { yardTemplateApiRouter };
