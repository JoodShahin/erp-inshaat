import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { AppDataSource } from '../../../database/data-source.js';
import { ApiResponse } from '../../../common/responses/api-response.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import { ProductionTemplateService, productionTemplateService } from './production-template.service.js';
import {
  ProductionTemplateVersionService,
  productionTemplateVersionService,
} from '../template-version/production-template-version.service.js';
import {
  ProductionTemplateEditingService,
  productionTemplateEditingService,
} from '../template-editing/production-template-editing.service.js';
import { ProductionTemplateUploadTokenEntity } from '../template-editing/production-template-upload-token.entity.js';
import { CommitTemplateEditingSessionDto } from '../template-editing/dto/commit-template-editing-session.dto.js';
import {
  ProductionTemplateSpecificationService,
  productionTemplateSpecificationService,
} from '../template-specification/production-template-specification.service.js';
import {
  ProductionTemplateStageService,
  productionTemplateStageService,
} from '../template-stage/production-template-stage.service.js';
import {
  ProductionTemplateStageMaterialService,
  productionTemplateStageMaterialService,
} from '../template-stage-material/production-template-stage-material.service.js';
import {
  ProductionTemplateStageAttachmentService,
  productionTemplateStageAttachmentService,
} from '../template-stage-attachment/production-template-stage-attachment.service.js';
import {
  ProductionTemplateWorkflowService,
  productionTemplateWorkflowService,
} from '../template-workflow-item/production-template-workflow.service.js';
import {
  ProductionTemplatePatternService,
  productionTemplatePatternService,
} from '../template-pattern/production-template-pattern.service.js';
import {
  ProductionTemplatePatternOptionService,
  productionTemplatePatternOptionService,
} from '../template-pattern-option/production-template-pattern-option.service.js';
import {
  ProductionTemplatePatternOptionTaskService,
  productionTemplatePatternOptionTaskService,
} from '../template-pattern-option-task/production-template-pattern-option-task.service.js';
import {
  ProductionTemplatePatternOptionTaskMaterialService,
  productionTemplatePatternOptionTaskMaterialService,
} from '../template-pattern-option-task-material/production-template-pattern-option-task-material.service.js';
import {
  ProductionTemplatePatternOptionTaskAttachmentService,
  productionTemplatePatternOptionTaskAttachmentService,
} from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.service.js';
import { CreateProductionTemplateDto } from './dto/create-template.dto.js';
import { UpdateProductionTemplateDto } from './dto/update-template.dto.js';
import { ListProductionTemplatesQueryDto } from './dto/list-templates-query.dto.js';
import { CreateTemplateSpecificationDto } from '../template-specification/dto/create-specification.dto.js';
import { UpdateTemplateSpecificationDto } from '../template-specification/dto/update-specification.dto.js';
import { ReorderTemplateSpecificationsDto } from '../template-specification/dto/reorder-specifications.dto.js';
import { CreateTemplateStageDto } from '../template-stage/dto/create-stage.dto.js';
import { UpdateTemplateStageDto } from '../template-stage/dto/update-stage.dto.js';
import { ReorderTemplateStagesDto } from '../template-stage/dto/reorder-stages.dto.js';
import { AddTemplateStageMaterialDto } from '../template-stage-material/dto/add-stage-material.dto.js';
import { UpdateTemplateStageMaterialDto } from '../template-stage-material/dto/update-stage-material.dto.js';
import { UpdateStageAttachmentDto } from '../template-stage-attachment/dto/update-stage-attachment.dto.js';
import { ReorderStageAttachmentsDto } from '../template-stage-attachment/dto/reorder-stage-attachments.dto.js';
import { ReorderWorkflowItemsDto } from '../template-workflow-item/dto/reorder-workflow-items.dto.js';
import { CreateTemplatePatternDto } from '../template-pattern/dto/create-pattern.dto.js';
import { UpdateTemplatePatternDto } from '../template-pattern/dto/update-pattern.dto.js';
import { CreateTemplatePatternOptionDto } from '../template-pattern-option/dto/create-pattern-option.dto.js';
import { UpdateTemplatePatternOptionDto } from '../template-pattern-option/dto/update-pattern-option.dto.js';
import { ReorderPatternOptionsDto } from '../template-pattern-option/dto/reorder-pattern-options.dto.js';
import { CreateTemplatePatternOptionTaskDto } from '../template-pattern-option-task/dto/create-pattern-option-task.dto.js';
import { UpdateTemplatePatternOptionTaskDto } from '../template-pattern-option-task/dto/update-pattern-option-task.dto.js';
import { ReorderPatternOptionTasksDto } from '../template-pattern-option-task/dto/reorder-pattern-option-tasks.dto.js';
import { AddTemplatePatternOptionTaskMaterialDto } from '../template-pattern-option-task-material/dto/add-task-material.dto.js';
import { UpdateTemplatePatternOptionTaskMaterialDto } from '../template-pattern-option-task-material/dto/update-task-material.dto.js';
import { UpdatePatternOptionTaskAttachmentDto } from '../template-pattern-option-task-attachment/dto/update-task-attachment.dto.js';
import { ReorderPatternOptionTaskAttachmentsDto } from '../template-pattern-option-task-attachment/dto/reorder-task-attachments.dto.js';

export class ProductionTemplateController {
  constructor(
    private templateService: ProductionTemplateService = productionTemplateService,
    private specService: ProductionTemplateSpecificationService = productionTemplateSpecificationService,
    private stageService: ProductionTemplateStageService = productionTemplateStageService,
    private materialService: ProductionTemplateStageMaterialService = productionTemplateStageMaterialService,
    private attachmentService: ProductionTemplateStageAttachmentService = productionTemplateStageAttachmentService,
    private workflowService: ProductionTemplateWorkflowService = productionTemplateWorkflowService,
    private patternService: ProductionTemplatePatternService = productionTemplatePatternService,
    private optionService: ProductionTemplatePatternOptionService = productionTemplatePatternOptionService,
    private taskService: ProductionTemplatePatternOptionTaskService = productionTemplatePatternOptionTaskService,
    private taskMaterialService: ProductionTemplatePatternOptionTaskMaterialService = productionTemplatePatternOptionTaskMaterialService,
    private taskAttachmentService: ProductionTemplatePatternOptionTaskAttachmentService = productionTemplatePatternOptionTaskAttachmentService,
    private versionService: ProductionTemplateVersionService = productionTemplateVersionService,
    private editingService: ProductionTemplateEditingService = productionTemplateEditingService
  ) {}

  // ==========================================
  // 1. TEMPLATES
  // ==========================================

  listTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = (req.validatedQuery ?? req.query) as unknown as ListProductionTemplatesQueryDto;
      const result = await this.templateService.listTemplates(query);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  };

  getTemplateById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : undefined;
      const template = await this.templateService.getTemplateById(id as string, versionId);
      res.status(200).json(ApiResponse.success(template));
    } catch (error) {
      next(error);
    }
  };

  createTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as CreateProductionTemplateDto;
      const template = await this.templateService.createTemplate(dto);
      res.status(201).json(ApiResponse.success(template, 'تم إنشاء قالب التصنيع بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  updateTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const dto = req.body as UpdateProductionTemplateDto;
      const template = await this.templateService.updateTemplate(id as string, dto);
      res.status(200).json(ApiResponse.success(template, 'تم تحديث بيانات القالب بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  deleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      await this.templateService.softDeleteTemplate(id as string);
      res.status(200).json(ApiResponse.success(null, 'تم أرشفة قالب التصنيع بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  getReferenceOptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const result = await this.templateService.getReferenceOptions({ page, limit, search });
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  };

  commitEditingSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const dto = req.body as CommitTemplateEditingSessionDto;
      const userId = (req as any).user?.id;
      const result = await this.editingService.commitEditingSession(id as string, dto, userId);
      const msg = result.createdNewVersion
        ? `تم حفظ التعديلات في إصدار جديد (${result.targetVersionNumber}) بنجاح`
        : 'تم حفظ التعديلات بنجاح';
      res.status(200).json(ApiResponse.success(result, msg));
    } catch (error) {
      next(error);
    }
  };

  uploadEditingAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!req.file) {
        throw new BusinessRuleError('الملف مطلوب', 'FILE_REQUIRED');
      }
      const userId = (req as any).user?.id || 'system';
      const storageKey = req.file.path.replace(/\\/g, '/');

      const tokenRepo = AppDataSource.getRepository(ProductionTemplateUploadTokenEntity);
      const token = tokenRepo.create({
        id: crypto.randomUUID(),
        templateId: id as string,
        userId,
        storageKey,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        isUsed: false,
      });
      await tokenRepo.save(token);

      res.status(200).json(
        ApiResponse.success({
          uploadToken: token.id,
          originalFileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        }, 'تم رفع الملف بنجاح')
      );
    } catch (error) {
      next(error);
    }
  };

  listTemplateVersions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const versions = await this.versionService.listVersions(id as string);
      res.status(200).json(ApiResponse.success(versions));
    } catch (error) {
      next(error);
    }
  };

  getTemplateVersionById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, versionId } = req.params;
      const template = await this.templateService.getTemplateById(id as string, versionId as string);
      res.status(200).json(ApiResponse.success(template));
    } catch (error) {
      next(error);
    }
  };

  getOrderConfiguration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : undefined;
      const config = await this.templateService.getOrderConfiguration(id as string, versionId);
      res.status(200).json(ApiResponse.success(config));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 2. SPECIFICATIONS
  // ==========================================

  addSpecification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const dto = req.body as CreateTemplateSpecificationDto;
      const spec = await this.specService.addSpecification(id as string, dto);
      res.status(201).json(ApiResponse.success(spec, 'تمت إضافة الخاصية الهندسية بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  reorderSpecifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const dto = req.body as ReorderTemplateSpecificationsDto;
      const specs = await this.specService.reorderSpecifications(id as string, dto);
      res.status(200).json(ApiResponse.success(specs, 'تم إعادة ترتيب المواصفات بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  updateSpecification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, specId } = req.params;
      const dto = req.body as UpdateTemplateSpecificationDto;
      const spec = await this.specService.updateSpecification(id as string, specId as string, dto);
      res.status(200).json(ApiResponse.success(spec, 'تم تعديل الخاصية الهندسية بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  deleteSpecification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, specId } = req.params;
      await this.specService.deleteSpecification(id as string, specId as string);
      res.status(200).json(ApiResponse.success(null, 'تم حذف الخاصية الهندسية بنجاح'));
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 3. STAGES
  // ==========================================

  addStage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  reorderStages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateStage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  softDeleteStage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 4. STAGE PLANNED MATERIALS
  // ==========================================

  listStageMaterials = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, stageId } = req.params;
      const materials = await this.materialService.listStageMaterials(id as string, stageId as string);
      res.status(200).json(ApiResponse.success(materials));
    } catch (error) {
      next(error);
    }
  };

  addStageMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateStageMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  removeStageMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 5. STAGE REFERENCE ATTACHMENTS
  // ==========================================

  listStageAttachments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, stageId } = req.params;
      const attachments = await this.attachmentService.listStageAttachments(id as string, stageId as string);
      res.status(200).json(ApiResponse.success(attachments));
    } catch (error) {
      next(error);
    }
  };

  addStageAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateStageAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  softDeleteStageAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  reorderStageAttachments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  downloadStageAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, stageId, attachmentId } = req.params;
      const { attachment, absoluteFilePath } = await this.attachmentService.getAttachmentForDownload(
        id as string,
        stageId as string,
        attachmentId as string
      );

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', attachment.mimeType);
      const encodedFilename = encodeURIComponent(attachment.originalFileName);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.sendFile(absoluteFilePath);
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 6. WORKFLOW ITEMS
  // ==========================================

  listWorkflowItems = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const items = await this.workflowService.listWorkflowItems(id as string);
      res.status(200).json(ApiResponse.success(items));
    } catch (error) {
      next(error);
    }
  };

  reorderWorkflow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 7. PATTERNS
  // ==========================================

  listPatterns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const patterns = await this.patternService.listPatterns(id as string);
      res.status(200).json(ApiResponse.success(patterns));
    } catch (error) {
      next(error);
    }
  };

  getPatternById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId } = req.params;
      const pattern = await this.patternService.getPatternById(id as string, patternId as string);
      res.status(200).json(ApiResponse.success(pattern));
    } catch (error) {
      next(error);
    }
  };

  addPattern = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updatePattern = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  archivePattern = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 8. PATTERN OPTIONS
  // ==========================================

  listOptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId } = req.params;
      const options = await this.optionService.listOptions(id as string, patternId as string);
      res.status(200).json(ApiResponse.success(options));
    } catch (error) {
      next(error);
    }
  };

  addOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  archiveOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  reorderOptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 9. PATTERN OPTION TASKS
  // ==========================================

  listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId, optionId } = req.params;
      const tasks = await this.taskService.listTasks(
        id as string,
        patternId as string,
        optionId as string
      );
      res.status(200).json(ApiResponse.success(tasks));
    } catch (error) {
      next(error);
    }
  };

  getTaskById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId, optionId, taskId } = req.params;
      const task = await this.taskService.getTaskById(
        id as string,
        patternId as string,
        optionId as string,
        taskId as string
      );
      res.status(200).json(ApiResponse.success(task));
    } catch (error) {
      next(error);
    }
  };

  addTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  archiveTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  reorderTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 10. TASK PLANNED MATERIALS
  // ==========================================

  listTaskMaterials = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId, optionId, taskId } = req.params;
      const materials = await this.taskMaterialService.listTaskMaterials(
        id as string,
        patternId as string,
        optionId as string,
        taskId as string
      );
      res.status(200).json(ApiResponse.success(materials));
    } catch (error) {
      next(error);
    }
  };

  addTaskMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateTaskMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  removeTaskMaterial = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // 11. TASK REFERENCE ATTACHMENTS
  // ==========================================

  listTaskAttachments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId, optionId, taskId } = req.params;
      const attachments = await this.taskAttachmentService.listTaskAttachments(
        id as string,
        patternId as string,
        optionId as string,
        taskId as string
      );
      res.status(200).json(ApiResponse.success(attachments));
    } catch (error) {
      next(error);
    }
  };

  addTaskAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  updateTaskAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  softDeleteTaskAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  reorderTaskAttachments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      throw new BusinessRuleError(
        'تعديل البنية الإنتاجية للقالب يجب أن يتم عبر جلسات التحرير الذرية',
        'PRODUCTION_TEMPLATE_DIRECT_MUTATION_DISABLED'
      );
    } catch (error) {
      next(error);
    }
  };

  downloadTaskAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, patternId, optionId, taskId, attachmentId } = req.params;
      const { absolutePath, originalFileName, mimeType } =
        await this.taskAttachmentService.getTaskAttachmentForDownload(
          id as string,
          patternId as string,
          optionId as string,
          taskId as string,
          attachmentId as string
        );

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', mimeType);
      const encodedFilename = encodeURIComponent(originalFileName);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.sendFile(absolutePath);
    } catch (error) {
      next(error);
    }
  };
}

export const productionTemplateController = new ProductionTemplateController();
