import { Router } from 'express';
import { productionTemplateController } from './production-template.controller.js';
import { requireApiAuth } from '../../system/auth/auth.middleware.js';
import { requirePermission, requireAnyPermission } from '../../system/authorization/authorization.middleware.js';
import { SystemPermission } from '../../system/permission/constants/system-permission.enum.js';
import { validateDto } from '../../../common/middleware/validate-dto.middleware.js';
import { validateQueryDto } from '../../../common/middleware/validate-query-dto.middleware.js';
import { validateUuidParam } from '../../../common/middleware/validate-uuid-param.middleware.js';
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
import { upload } from '../../../config/multer.config.js';
import { CommitTemplateEditingSessionDto } from '../template-editing/dto/commit-template-editing-session.dto.js';

const productionTemplateApiRouter: Router = Router();

productionTemplateApiRouter.use(requireApiAuth);

// ==========================================
// 1. TEMPLATES CORE ENDPOINTS
// ==========================================

// GET /api/production/templates - List templates (paginated, filtered)
productionTemplateApiRouter.get(
  '/',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateQueryDto(ListProductionTemplatesQueryDto),
  productionTemplateController.listTemplates
);

// GET /api/production/templates/reference-options - List active templates for reference picker
productionTemplateApiRouter.get(
  '/reference-options',
  requireAnyPermission([
    SystemPermission.PRODUCTION_ORDER_VIEW,
    SystemPermission.PRODUCTION_ORDER_CREATE,
    SystemPermission.PRODUCTION_ORDER_UPDATE,
    SystemPermission.PRODUCTION_TEMPLATE_VIEW,
  ]),
  productionTemplateController.getReferenceOptions
);

// GET /api/production/templates/:id/order-configuration - Get template pattern & options configuration for order line preview
productionTemplateApiRouter.get(
  '/:id/order-configuration',
  requireAnyPermission([
    SystemPermission.PRODUCTION_ORDER_VIEW,
    SystemPermission.PRODUCTION_ORDER_CREATE,
    SystemPermission.PRODUCTION_ORDER_UPDATE,
    SystemPermission.PRODUCTION_TEMPLATE_VIEW,
  ]),
  validateUuidParam('id'),
  productionTemplateController.getOrderConfiguration
);

// POST /api/production/templates/:id/editing/commit - Commit atomic editing session
productionTemplateApiRouter.post(
  '/:id/editing/commit',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(CommitTemplateEditingSessionDto),
  productionTemplateController.commitEditingSession
);

// POST /api/production/templates/:id/editing/preview - Preview atomic editing session
productionTemplateApiRouter.post(
  '/:id/editing/preview',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateDto(CommitTemplateEditingSessionDto),
  productionTemplateController.previewEditingSession
);

// POST /api/production/templates/:id/editing/upload - Upload file for editing session
productionTemplateApiRouter.post(
  '/:id/editing/upload',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  upload.single('file'),
  productionTemplateController.uploadEditingAttachment
);

// GET /api/production/templates/:id/versions - List template versions
productionTemplateApiRouter.get(
  '/:id/versions',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  productionTemplateController.listTemplateVersions
);

// GET /api/production/templates/:id/versions/:versionId - Get template details for a specific version
productionTemplateApiRouter.get(
  '/:id/versions/:versionId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('versionId'),
  productionTemplateController.getTemplateVersionById
);

// GET /api/production/templates/:id - Get template details with stages & specifications
productionTemplateApiRouter.get(
  '/:id',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  productionTemplateController.getTemplateById
);

// POST /api/production/templates - Create template
productionTemplateApiRouter.post(
  '/',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_CREATE),
  validateDto(CreateProductionTemplateDto),
  productionTemplateController.createTemplate
);

// PUT /api/production/templates/:id - Update template
productionTemplateApiRouter.put(
  '/:id',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(UpdateProductionTemplateDto),
  productionTemplateController.updateTemplate
);

// DELETE /api/production/templates/:id - Soft delete template
productionTemplateApiRouter.delete(
  '/:id',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_DELETE),
  validateUuidParam('id'),
  productionTemplateController.deleteTemplate
);

// ==========================================
// 2. SPECIFICATIONS ENDPOINTS
// ==========================================

// POST /api/production/templates/:id/specifications - Add specification
productionTemplateApiRouter.post(
  '/:id/specifications',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(CreateTemplateSpecificationDto),
  productionTemplateController.addSpecification
);

// PATCH /api/production/templates/:id/specifications/reorder - Reorder specifications
productionTemplateApiRouter.patch(
  '/:id/specifications/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(ReorderTemplateSpecificationsDto),
  productionTemplateController.reorderSpecifications
);

// PUT /api/production/templates/:id/specifications/:specId - Update specification
productionTemplateApiRouter.put(
  '/:id/specifications/:specId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('specId'),
  validateDto(UpdateTemplateSpecificationDto),
  productionTemplateController.updateSpecification
);

// DELETE /api/production/templates/:id/specifications/:specId - Delete specification
productionTemplateApiRouter.delete(
  '/:id/specifications/:specId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('specId'),
  productionTemplateController.deleteSpecification
);

// ==========================================
// 3. STAGES ENDPOINTS
// ==========================================

// POST /api/production/templates/:id/stages - Add stage
productionTemplateApiRouter.post(
  '/:id/stages',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(CreateTemplateStageDto),
  productionTemplateController.addStage
);

// PATCH /api/production/templates/:id/stages/reorder - Reorder stages densely
productionTemplateApiRouter.patch(
  '/:id/stages/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(ReorderTemplateStagesDto),
  productionTemplateController.reorderStages
);

// PUT /api/production/templates/:id/stages/:stageId - Update stage
productionTemplateApiRouter.put(
  '/:id/stages/:stageId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateDto(UpdateTemplateStageDto),
  productionTemplateController.updateStage
);

// DELETE /api/production/templates/:id/stages/:stageId - Soft delete stage (requires update permission)
productionTemplateApiRouter.delete(
  '/:id/stages/:stageId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  productionTemplateController.softDeleteStage
);

// ==========================================
// 4. PLANNED MATERIALS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/stages/:stageId/materials - List stage materials
productionTemplateApiRouter.get(
  '/:id/stages/:stageId/materials',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  productionTemplateController.listStageMaterials
);

// POST /api/production/templates/:id/stages/:stageId/materials - Add planned material
productionTemplateApiRouter.post(
  '/:id/stages/:stageId/materials',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateDto(AddTemplateStageMaterialDto),
  productionTemplateController.addStageMaterial
);

// PUT /api/production/templates/:id/stages/:stageId/materials/:materialId - Update planned material
productionTemplateApiRouter.put(
  '/:id/stages/:stageId/materials/:materialId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateUuidParam('materialId'),
  validateDto(UpdateTemplateStageMaterialDto),
  productionTemplateController.updateStageMaterial
);

// DELETE /api/production/templates/:id/stages/:stageId/materials/:materialId - Remove planned material
productionTemplateApiRouter.delete(
  '/:id/stages/:stageId/materials/:materialId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateUuidParam('materialId'),
  productionTemplateController.removeStageMaterial
);

// ==========================================
// 5. STAGE REFERENCE ATTACHMENTS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/stages/:stageId/attachments - List reference attachments
productionTemplateApiRouter.get(
  '/:id/stages/:stageId/attachments',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  productionTemplateController.listStageAttachments
);

// POST /api/production/templates/:id/stages/:stageId/attachments - Upload reference attachment
productionTemplateApiRouter.post(
  '/:id/stages/:stageId/attachments',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  upload.single('file'),
  productionTemplateController.addStageAttachment
);

// PATCH /api/production/templates/:id/stages/:stageId/attachments/reorder - Reorder attachments
productionTemplateApiRouter.patch(
  '/:id/stages/:stageId/attachments/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateDto(ReorderStageAttachmentsDto),
  productionTemplateController.reorderStageAttachments
);

// PUT /api/production/templates/:id/stages/:stageId/attachments/:attachmentId - Update attachment metadata (description)
productionTemplateApiRouter.put(
  '/:id/stages/:stageId/attachments/:attachmentId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateUuidParam('attachmentId'),
  validateDto(UpdateStageAttachmentDto),
  productionTemplateController.updateStageAttachment
);

// DELETE /api/production/templates/:id/stages/:stageId/attachments/:attachmentId - Soft delete reference attachment
productionTemplateApiRouter.delete(
  '/:id/stages/:stageId/attachments/:attachmentId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('stageId'),
  validateUuidParam('attachmentId'),
  productionTemplateController.softDeleteStageAttachment
);

// ==========================================
// 6. WORKFLOW ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/workflow - List workflow items
productionTemplateApiRouter.get(
  '/:id/workflow',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  productionTemplateController.listWorkflowItems
);

// PATCH /api/production/templates/:id/workflow/reorder - Reorder workflow items densely
productionTemplateApiRouter.patch(
  '/:id/workflow/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(ReorderWorkflowItemsDto),
  productionTemplateController.reorderWorkflow
);

// ==========================================
// 7. PATTERNS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/patterns - List patterns
productionTemplateApiRouter.get(
  '/:id/patterns',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  productionTemplateController.listPatterns
);

// GET /api/production/templates/:id/patterns/:patternId - Get pattern by ID
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  productionTemplateController.getPatternById
);

// POST /api/production/templates/:id/patterns - Add pattern
productionTemplateApiRouter.post(
  '/:id/patterns',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateDto(CreateTemplatePatternDto),
  productionTemplateController.addPattern
);

// PUT /api/production/templates/:id/patterns/:patternId - Update pattern
productionTemplateApiRouter.put(
  '/:id/patterns/:patternId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateDto(UpdateTemplatePatternDto),
  productionTemplateController.updatePattern
);

// DELETE /api/production/templates/:id/patterns/:patternId - Archive pattern
productionTemplateApiRouter.delete(
  '/:id/patterns/:patternId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  productionTemplateController.archivePattern
);

// ==========================================
// 8. PATTERN OPTIONS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/patterns/:patternId/options - List options
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  productionTemplateController.listOptions
);

// POST /api/production/templates/:id/patterns/:patternId/options - Add option
productionTemplateApiRouter.post(
  '/:id/patterns/:patternId/options',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateDto(CreateTemplatePatternOptionDto),
  productionTemplateController.addOption
);

// PATCH /api/production/templates/:id/patterns/:patternId/options/reorder - Reorder options
productionTemplateApiRouter.patch(
  '/:id/patterns/:patternId/options/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateDto(ReorderPatternOptionsDto),
  productionTemplateController.reorderOptions
);

// PUT /api/production/templates/:id/patterns/:patternId/options/:optionId - Update option
productionTemplateApiRouter.put(
  '/:id/patterns/:patternId/options/:optionId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateDto(UpdateTemplatePatternOptionDto),
  productionTemplateController.updateOption
);

// DELETE /api/production/templates/:id/patterns/:patternId/options/:optionId - Archive option
productionTemplateApiRouter.delete(
  '/:id/patterns/:patternId/options/:optionId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  productionTemplateController.archiveOption
);

// ==========================================
// 9. PATTERN OPTION TASKS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks - List tasks
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options/:optionId/tasks',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  productionTemplateController.listTasks
);

// GET /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId - Get task by ID
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  productionTemplateController.getTaskById
);

// POST /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks - Add task
productionTemplateApiRouter.post(
  '/:id/patterns/:patternId/options/:optionId/tasks',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateDto(CreateTemplatePatternOptionTaskDto),
  productionTemplateController.addTask
);

// PATCH /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/reorder - Reorder tasks
productionTemplateApiRouter.patch(
  '/:id/patterns/:patternId/options/:optionId/tasks/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateDto(ReorderPatternOptionTasksDto),
  productionTemplateController.reorderTasks
);

// PUT /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId - Update task
productionTemplateApiRouter.put(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateDto(UpdateTemplatePatternOptionTaskDto),
  productionTemplateController.updateTask
);

// DELETE /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId - Archive task
productionTemplateApiRouter.delete(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  productionTemplateController.archiveTask
);

// ==========================================
// 10. TASK PLANNED MATERIALS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials - List task materials
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  productionTemplateController.listTaskMaterials
);

// POST /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials - Add task material
productionTemplateApiRouter.post(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateDto(AddTemplatePatternOptionTaskMaterialDto),
  productionTemplateController.addTaskMaterial
);

// PUT /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials/:materialId - Update task material
productionTemplateApiRouter.put(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials/:materialId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateUuidParam('materialId'),
  validateDto(UpdateTemplatePatternOptionTaskMaterialDto),
  productionTemplateController.updateTaskMaterial
);

// DELETE /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials/:materialId - Remove task material
productionTemplateApiRouter.delete(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/materials/:materialId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateUuidParam('materialId'),
  productionTemplateController.removeTaskMaterial
);

// ==========================================
// 11. TASK REFERENCE ATTACHMENTS ENDPOINTS
// ==========================================

// GET /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments - List task attachments
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  productionTemplateController.listTaskAttachments
);

// POST /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments - Upload task attachment
productionTemplateApiRouter.post(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  upload.single('file'),
  productionTemplateController.addTaskAttachment
);

// PATCH /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/reorder - Reorder task attachments
productionTemplateApiRouter.patch(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/reorder',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateDto(ReorderPatternOptionTaskAttachmentsDto),
  productionTemplateController.reorderTaskAttachments
);

// PUT /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId - Update task attachment metadata
productionTemplateApiRouter.put(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateUuidParam('attachmentId'),
  validateDto(UpdatePatternOptionTaskAttachmentDto),
  productionTemplateController.updateTaskAttachment
);

// DELETE /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId - Soft delete task attachment
productionTemplateApiRouter.delete(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_UPDATE),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateUuidParam('attachmentId'),
  productionTemplateController.softDeleteTaskAttachment
);

// GET /api/production/templates/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId/file - Download task attachment file
productionTemplateApiRouter.get(
  '/:id/patterns/:patternId/options/:optionId/tasks/:taskId/attachments/:attachmentId/file',
  requirePermission(SystemPermission.PRODUCTION_TEMPLATE_VIEW),
  validateUuidParam('id'),
  validateUuidParam('patternId'),
  validateUuidParam('optionId'),
  validateUuidParam('taskId'),
  validateUuidParam('attachmentId'),
  productionTemplateController.downloadTaskAttachment
);

export { productionTemplateApiRouter };
