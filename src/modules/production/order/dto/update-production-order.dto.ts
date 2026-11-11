import { IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class UpdateProductionOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'عنوان أمر الإنتاج لا يمكن أن يكون فارغاً' })
  @MaxLength(255, { message: 'العنوان لا يمكن أن يتجاوز 255 حرفاً' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصاً' })
  @MaxLength(2000, { message: 'الوصف لا يمكن أن يتجاوز 2000 حرف' })
  description?: string | null;

  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  @MaxLength(2000, { message: 'الملاحظات لا يمكن أن تتجاوز 2000 حرف' })
  notes?: string | null;
}
