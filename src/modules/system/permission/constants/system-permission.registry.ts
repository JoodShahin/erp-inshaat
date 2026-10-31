import { SystemPermission } from './system-permission.enum.js';

export interface PermissionDefinition {
  name: SystemPermission;
  description: string;
  module: string;
}

/**
 * Central, exhaustive registry of all System Permissions in code.
 * Using Record<SystemPermission, PermissionDefinition> guarantees compile-time exhaustiveness:
 * If any new permission is added to the SystemPermission enum without being defined here,
 * TypeScript compilation will fail immediately.
 */
export const SYSTEM_PERMISSION_DEFINITIONS: Record<SystemPermission, PermissionDefinition> = {
  // System User Permissions
  [SystemPermission.USER_VIEW]: {
    name: SystemPermission.USER_VIEW,
    description: 'عرض المستخدمين',
    module: 'system',
  },
  [SystemPermission.USER_CREATE]: {
    name: SystemPermission.USER_CREATE,
    description: 'إنشاء مستخدم',
    module: 'system',
  },
  [SystemPermission.USER_UPDATE]: {
    name: SystemPermission.USER_UPDATE,
    description: 'تعديل بيانات المستخدم',
    module: 'system',
  },
  [SystemPermission.USER_DELETE]: {
    name: SystemPermission.USER_DELETE,
    description: 'حذف المستخدم',
    module: 'system',
  },
  [SystemPermission.USER_PERMISSION_MANAGE]: {
    name: SystemPermission.USER_PERMISSION_MANAGE,
    description: 'إدارة الصلاحيات المباشرة للمستخدمين',
    module: 'system',
  },

  // System Role Permissions
  [SystemPermission.ROLE_VIEW]: {
    name: SystemPermission.ROLE_VIEW,
    description: 'عرض الأدوار والصلاحيات',
    module: 'system',
  },
  [SystemPermission.ROLE_CREATE]: {
    name: SystemPermission.ROLE_CREATE,
    description: 'إنشاء دور جديد',
    module: 'system',
  },
  [SystemPermission.ROLE_UPDATE]: {
    name: SystemPermission.ROLE_UPDATE,
    description: 'تعديل بيانات الدور',
    module: 'system',
  },
  [SystemPermission.ROLE_DELETE]: {
    name: SystemPermission.ROLE_DELETE,
    description: 'حذف أو أرشفة الدور',
    module: 'system',
  },
  [SystemPermission.ROLE_PERMISSION_MANAGE]: {
    name: SystemPermission.ROLE_PERMISSION_MANAGE,
    description: 'إدارة وإسناد صلاحيات الدور',
    module: 'system',
  },

  // Production Department Permissions
  [SystemPermission.PRODUCTION_DEPARTMENT_VIEW]: {
    name: SystemPermission.PRODUCTION_DEPARTMENT_VIEW,
    description: 'عرض أقسام الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_DEPARTMENT_CREATE]: {
    name: SystemPermission.PRODUCTION_DEPARTMENT_CREATE,
    description: 'إنشاء قسم إنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_DEPARTMENT_UPDATE]: {
    name: SystemPermission.PRODUCTION_DEPARTMENT_UPDATE,
    description: 'تعديل قسم إنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_DEPARTMENT_DELETE]: {
    name: SystemPermission.PRODUCTION_DEPARTMENT_DELETE,
    description: 'أرشفة قسم إنتاج',
    module: 'production',
  },

  // Production Yard Permissions
  [SystemPermission.PRODUCTION_YARD_VIEW]: {
    name: SystemPermission.PRODUCTION_YARD_VIEW,
    description: 'عرض ساحات الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_CREATE]: {
    name: SystemPermission.PRODUCTION_YARD_CREATE,
    description: 'إنشاء ساحة إنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_UPDATE]: {
    name: SystemPermission.PRODUCTION_YARD_UPDATE,
    description: 'تعديل ساحة إنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_DELETE]: {
    name: SystemPermission.PRODUCTION_YARD_DELETE,
    description: 'أرشفة ساحة إنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW]: {
    name: SystemPermission.PRODUCTION_YARD_TEMPLATE_VIEW,
    description: 'استعراض القوالب المرتبطة بساحات الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD]: {
    name: SystemPermission.PRODUCTION_YARD_TEMPLATE_ADD,
    description: 'ربط قوالب التصنيع بساحات الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_TEMPLATE_UPDATE]: {
    name: SystemPermission.PRODUCTION_YARD_TEMPLATE_UPDATE,
    description: 'تعديل إعدادات ارتباط القوالب بساحات الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE]: {
    name: SystemPermission.PRODUCTION_YARD_TEMPLATE_REMOVE,
    description: 'إزالة ارتباط قوالب التصنيع من ساحات الإنتاج',
    module: 'production',
  },

  // Production Team Assignment Permissions
  [SystemPermission.PRODUCTION_ASSIGNMENT_VIEW]: {
    name: SystemPermission.PRODUCTION_ASSIGNMENT_VIEW,
    description: 'عرض تعيينات فرق الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ASSIGNMENT_MANAGE]: {
    name: SystemPermission.PRODUCTION_ASSIGNMENT_MANAGE,
    description: 'إدارة رؤساء الأقسام والمهندسين وساحات مسؤوليتهم',
    module: 'production',
  },

  // Inventory Category Permissions
  [SystemPermission.INVENTORY_CATEGORY_VIEW]: {
    name: SystemPermission.INVENTORY_CATEGORY_VIEW,
    description: 'عرض فئات المستودعات',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_CATEGORY_CREATE]: {
    name: SystemPermission.INVENTORY_CATEGORY_CREATE,
    description: 'إنشاء فئة مستودعات',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_CATEGORY_UPDATE]: {
    name: SystemPermission.INVENTORY_CATEGORY_UPDATE,
    description: 'تعديل فئة مستودعات',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_CATEGORY_DELETE]: {
    name: SystemPermission.INVENTORY_CATEGORY_DELETE,
    description: 'أرشفة فئة مستودعات',
    module: 'inventory',
  },

  // Inventory Product & Units Permissions
  [SystemPermission.INVENTORY_PRODUCT_VIEW]: {
    name: SystemPermission.INVENTORY_PRODUCT_VIEW,
    description: 'عرض منتجات المستودعات ووحداتها',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_PRODUCT_CREATE]: {
    name: SystemPermission.INVENTORY_PRODUCT_CREATE,
    description: 'إنشاء منتج مستودعات',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_PRODUCT_UPDATE]: {
    name: SystemPermission.INVENTORY_PRODUCT_UPDATE,
    description: 'تعديل منتج مستودعات ووحداته',
    module: 'inventory',
  },
  [SystemPermission.INVENTORY_PRODUCT_DELETE]: {
    name: SystemPermission.INVENTORY_PRODUCT_DELETE,
    description: 'أرشفة منتج مستودعات',
    module: 'inventory',
  },

  // Production Template Permissions
  [SystemPermission.PRODUCTION_TEMPLATE_VIEW]: {
    name: SystemPermission.PRODUCTION_TEMPLATE_VIEW,
    description: 'عرض قوالب التصنيع ومراحلها ومواصفاتها',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_TEMPLATE_CREATE]: {
    name: SystemPermission.PRODUCTION_TEMPLATE_CREATE,
    description: 'إنشاء قوالب التصنيع',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_TEMPLATE_UPDATE]: {
    name: SystemPermission.PRODUCTION_TEMPLATE_UPDATE,
    description: 'تعديل قوالب التصنيع ومراحلها وترتيبها وموادها',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_TEMPLATE_DELETE]: {
    name: SystemPermission.PRODUCTION_TEMPLATE_DELETE,
    description: 'أرشفة قوالب التصنيع ومراحلها',
    module: 'production',
  },

  // Production Order Permissions
  [SystemPermission.PRODUCTION_ORDER_VIEW]: {
    name: SystemPermission.PRODUCTION_ORDER_VIEW,
    description: 'عرض ومتابعة أوامر الإنتاج ومسوداتها',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ORDER_CREATE]: {
    name: SystemPermission.PRODUCTION_ORDER_CREATE,
    description: 'إنشاء أوامر إنتاج جديدة',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ORDER_UPDATE]: {
    name: SystemPermission.PRODUCTION_ORDER_UPDATE,
    description: 'تعديل مسودات أوامر الإنتاج وبنودها وخيارات الأنماط',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ORDER_DELETE]: {
    name: SystemPermission.PRODUCTION_ORDER_DELETE,
    description: 'أرشفة مسودات أوامر الإنتاج',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ORDER_APPROVE]: {
    name: SystemPermission.PRODUCTION_ORDER_APPROVE,
    description: 'اعتماد أوامر الإنتاج الجاهزة وإعادتها للمسودة',
    module: 'production',
  },
  [SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY]: {
    name: SystemPermission.PRODUCTION_ORDER_UPDATE_PRIORITY,
    description: 'تغيير أولوية أمر الإنتاج',
    module: 'production',
  },
};

export const ALL_SYSTEM_PERMISSION_DEFINITIONS: PermissionDefinition[] = Object.values(
  SYSTEM_PERMISSION_DEFINITIONS,
);
