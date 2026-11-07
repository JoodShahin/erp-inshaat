import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsIn,
  IsNumber,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export type TemplateEditingDecision = 'AUTO' | 'NEW_VERSION' | 'OVERWRITE_CURRENT';

export class TemplateEditingOperationDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([
    'ADD_STAGE',
    'UPDATE_STAGE',
    'DELETE_STAGE',
    'ADD_PATTERN',
    'UPDATE_PATTERN',
    'DELETE_PATTERN',
    'ADD_OPTION',
    'UPDATE_OPTION',
    'DELETE_OPTION',
    'ADD_TASK',
    'UPDATE_TASK',
    'DELETE_TASK',
    'REORDER_WORKFLOW',
    'REORDER_PATTERN_OPTIONS',
    'REORDER_OPTION_TASKS',
    'ADD_SPEC',
    'UPDATE_SPEC',
    'DELETE_SPEC',
    'ADD_STAGE_MATERIAL',
    'DELETE_STAGE_MATERIAL',
    'ADD_TASK_MATERIAL',
    'DELETE_TASK_MATERIAL',
    'ADD_STAGE_ATTACHMENT',
    'DELETE_STAGE_ATTACHMENT',
    'ADD_TASK_ATTACHMENT',
    'DELETE_TASK_ATTACHMENT',
  ])
  type!: string;

  /**
   * Client-generated temporary ID (e.g. "client-stg-1", "temp-pat-2")
   * Used to reference newly added items before they receive database UUIDs.
   */
  @IsOptional()
  @IsString()
  tempClientId?: string;

  /**
   * Target DB entity ID for updates/deletions.
   */
  @IsOptional()
  @IsString()
  targetId?: string;

  /**
   * Parent ID or parent tempClientId (e.g. patternId for ADD_OPTION, optionId for ADD_TASK, stageId for material/attachment).
   */
  @IsOptional()
  @IsString()
  parentId?: string;

  /**
   * Additional polymorphic payload for the operation.
   */
  @IsOptional()
  payload?: any;
}

export class CommitTemplateEditingSessionDto {
  @IsUUID('4', { message: 'معرف الإصدار الأساسي يجب أن يكون UUID صالح' })
  @IsNotEmpty({ message: 'معرف الإصدار الأساسي مطلوب' })
  baseVersionId!: string;

  @IsNotEmpty({ message: 'مراجعة الإصدار الأساسية (baseRevision) مطلوبة للتحقق من التحرير المتزامن' })
  @IsString({ message: 'مراجعة الإصدار الأساسية يجب أن تكون نصاً' })
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'مراجعة الإصدار الأساسية يجب أن تكون تجزئة SHA-256 صالحة بطول 64 حرفاً',
  })
  baseRevision!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(['AUTO', 'NEW_VERSION', 'OVERWRITE_CURRENT'], {
    message: 'قرار الحفظ يجب أن يكون AUTO أو NEW_VERSION أو OVERWRITE_CURRENT',
  })
  commitDecision?: TemplateEditingDecision;

  @IsArray({ message: 'قائمة العمليات يجب أن تكون مصفوفة' })
  @ArrayMinSize(1, { message: 'يجب تقديم عملية واحدة على الأقل في جلسة التحرير' })
  @ArrayMaxSize(200, { message: 'الحد الأقصى للعمليات في جلسة التحرير الواحدة هو 200 عملية' })
  @ValidateNested({ each: true })
  @Type(() => TemplateEditingOperationDto)
  operations!: TemplateEditingOperationDto[];
}
