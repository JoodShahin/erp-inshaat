import {
  IsUUID,
  IsArray,
  IsOptional,
  ArrayNotEmpty,
  ValidateIf,
} from 'class-validator';

export class AssignTemplatesToYardDto {
  @ValidateIf((o) => !o.templateIds || (Array.isArray(o.templateIds) && o.templateIds.length === 0))
  @IsUUID('4', { message: 'معرف القالب يجب أن يكون UUID صالحاً' })
  templateId?: string;

  @ValidateIf((o) => !o.templateId)
  @IsArray({ message: 'قائمة معرفات القوالب يجب أن تكون مصفوفة' })
  @ArrayNotEmpty({ message: 'قائمة معرفات القوالب لا يمكن أن تكون فارغة' })
  @IsUUID('4', { each: true, message: 'كل معرف قالب في القائمة يجب أن يكون UUID صالحاً' })
  templateIds?: string[];
}
