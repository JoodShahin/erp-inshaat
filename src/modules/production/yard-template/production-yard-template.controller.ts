import { Request, Response, NextFunction } from 'express';
import {
  ProductionYardTemplateService,
  productionYardTemplateService,
} from './production-yard-template.service.js';
import { ApiResponse } from '../../../common/responses/api-response.js';
import { AssignTemplatesToYardDto } from './dto/assign-templates-to-yard.dto.js';
import { getProductionAccessPolicy } from '../authorization/production-authorization-context.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';

export class ProductionYardTemplateController {
  private readonly yardTemplateService: ProductionYardTemplateService;

  constructor(service: ProductionYardTemplateService = productionYardTemplateService) {
    this.yardTemplateService = service;
  }

  listYardTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { yardId } = req.params;
      const policy = await getProductionAccessPolicy(
        req,
        req.user!,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW
      );
      const result = await this.yardTemplateService.listYardTemplates(yardId as string, policy);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  };

  getAvailableTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { yardId } = req.params;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const policy = await getProductionAccessPolicy(
        req,
        req.user!,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW
      );
      const result = await this.yardTemplateService.getAvailableTemplatesForYard(
        yardId as string,
        policy,
        search
      );
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  };

  assignTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { yardId } = req.params;
      const dto = req.body as AssignTemplatesToYardDto;
      const policy = await getProductionAccessPolicy(
        req,
        req.user!,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD
      );

      const templateIds = dto.templateIds && dto.templateIds.length > 0
        ? dto.templateIds
        : dto.templateId
        ? [dto.templateId]
        : [];

      const result = await this.yardTemplateService.addTemplatesToYard(
        yardId as string,
        templateIds,
        policy,
        req.user?.id
      );

      res.status(201).json(ApiResponse.success(result, 'تم ربط القوالب بالساحة بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  removeTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { yardId, templateId } = req.params;
      const policy = await getProductionAccessPolicy(
        req,
        req.user!,
        SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE
      );
      await this.yardTemplateService.removeTemplateFromYard(
        yardId as string,
        templateId as string,
        policy
      );
      res.status(200).json(ApiResponse.success(null, 'تم فك ارتباط القالب من الساحة بنجاح'));
    } catch (error) {
      next(error);
    }
  };
}

export const productionYardTemplateController = new ProductionYardTemplateController();
