import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateProductionTemplateDto {
  @IsString({ message: 'اسم القالب يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'اسم القالب مطلوب' })
  @MaxLength(150, { message: 'اسم القالب يجب ألا يتجاوز 150 حرفاً' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsOptional()
  @IsString({ message: 'الرقم المرجعي يجب أن يكون نصاً' })
  @MaxLength(100, { message: 'الرقم المرجعي يجب ألا يتجاوز 100 حرف' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  referenceNumber?: string | null;

  @IsOptional()
  @IsString({ message: 'وصف القالب يجب أن يكون نصاً' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  description?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return value;
  })
  @IsBoolean({ message: 'حالة نشاط القالب يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
