import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsEnum,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TaskDurationUnit } from '../../task-duration/task-duration.types.js';

export class CreateTemplatePatternOptionTaskDto {
  @IsUUID('4', { message: 'معرف القسم يجب أن يكون UUID صالحاً' })
  @IsNotEmpty({ message: 'القسم مطلوب للمهمة' })
  departmentId!: string;

  @IsString({ message: 'اسم المهمة يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'اسم المهمة مطلوب' })
  @MaxLength(150, { message: 'اسم المهمة يجب ألا يتجاوز 150 حرفاً' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsOptional()
  @IsString({ message: 'وصف المهمة يجب أن يكون نصاً' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ترتيب المهمة يجب أن يكون عدداً صحيحاً' })
  @Min(1, { message: 'ترتيب المهمة يجب ألا يقل عن 1' })
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? Number(value.trim()) : value;
  })
  @IsInt({ message: 'قيمة المدة التقديرية يجب أن تكون عدداً صحيحاً موجباً' })
  @Min(1, { message: 'قيمة المدة التقديرية يجب ألا تقل عن 1' })
  @Max(1000000, { message: 'قيمة المدة التقديرية كبيرة جداً' })
  estimatedDurationValue?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? value.trim().toUpperCase() : value;
  })
  @IsEnum(TaskDurationUnit, { message: 'وحدة المدة يجب أن تكون إما MINUTES أو HOURS أو DAYS' })
  estimatedDurationUnit?: TaskDurationUnit | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'المدة التقديرية بالدقائق يجب أن تكون عدداً صحيحاً' })
  @Min(0, { message: 'المدة التقديرية بالدقائق لا يمكن أن تكون سالبة' })
  estimatedDurationMinutes?: number | null;

  @IsOptional()
  @Matches(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/, {
    message: 'التكلفة التقديرية يجب أن تكون رقماً عشرياً موجباً وبحد أقصى 14 خانة صحيحة و4 خانات عشرية',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : value;
  })
  estimatedCost?: string | null;
}
