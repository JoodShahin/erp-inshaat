import { IsOptional, IsInt, Min, Max, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductionUnitStatus } from '../production-unit.entity.js';

export class ListProductionUnitsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'رقم الصفحة يجب أن يكون عدداً صحيحاً' })
  @Min(1, { message: 'رقم الصفحة يجب ألا يقل عن 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'عدد السجلات يجب أن يكون عدداً صحيحاً' })
  @Min(1, { message: 'عدد السجلات يجب ألا يقل عن 1' })
  @Max(100, { message: 'الحد الأقصى لعدد السجلات هو 100' })
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ProductionUnitStatus, { message: 'حالة الغرفة غير صالحة' })
  status?: ProductionUnitStatus;

  @IsOptional()
  @IsUUID('4', { message: 'معرف البند يجب أن يكون بصيغة UUID صالحة' })
  orderLineId?: string;
}
