import {
  IsUUID,
  IsArray,
  ArrayNotEmpty,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isMutuallyExclusive', async: false })
export class IsMutuallyExclusiveConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
    // If this property is present, the related property must NOT be present
    if (value !== undefined && relatedValue !== undefined) {
      return false;
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints;
    return `لا يمكن إرسال ${args.property} مع ${relatedPropertyName} معاً، يرجى إرسال أحدهما فقط`;
  }
}

export class AssignTemplatesToYardDto {
  @ValidateIf((o: AssignTemplatesToYardDto) => o.templateId !== undefined || o.templateIds === undefined)
  @Validate(IsMutuallyExclusiveConstraint, ['templateIds'], {
    message: 'لا يمكن إرسال معرف قالب مفرد ومصفوفة قوالب معاً في نفس الطلب',
  })
  @IsUUID('4', { message: 'معرف القالب يجب أن يكون UUID صالحاً' })
  templateId?: string;

  @ValidateIf((o: AssignTemplatesToYardDto) => o.templateIds !== undefined || o.templateId === undefined)
  @Validate(IsMutuallyExclusiveConstraint, ['templateId'], {
    message: 'لا يمكن إرسال مصفوفة قوالب ومعرف قالب مفرد معاً في نفس الطلب',
  })
  @IsArray({ message: 'قائمة معرفات القوالب يجب أن تكون مصفوفة' })
  @ArrayNotEmpty({ message: 'قائمة معرفات القوالب لا يمكن أن تكون فارغة' })
  @IsUUID('4', { each: true, message: 'كل معرف قالب في القائمة يجب أن يكون UUID صالحاً' })
  templateIds?: string[];
}
