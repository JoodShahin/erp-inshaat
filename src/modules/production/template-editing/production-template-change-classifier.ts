import { TemplateEditingOperationDto } from './dto/commit-template-editing-session.dto.js';

export type TemplateChangeClassification = 'STRUCTURAL' | 'MINOR' | 'NONE';

export interface ClassificationResult {
  classification: TemplateChangeClassification;
  reasons: string[];
  structuralCount: number;
  minorCount: number;
}

export class ProductionTemplateChangeClassifier {
  /**
   * Classifies a list of editing operations into STRUCTURAL, MINOR, or NONE.
   */
  classify(operations: TemplateEditingOperationDto[]): ClassificationResult {
    if (!operations || operations.length === 0) {
      return {
        classification: 'NONE',
        reasons: ['لا توجد عمليات تعديل'],
        structuralCount: 0,
        minorCount: 0,
      };
    }

    const reasons: string[] = [];
    let structuralCount = 0;
    let minorCount = 0;

    for (const op of operations) {
      switch (op.type) {
        // 1. Structural Stage Operations
        case 'ADD_STAGE':
          structuralCount++;
          reasons.push(`إضافة مرحلة جديدة (${op.payload?.name || op.tempClientId})`);
          break;

        case 'DELETE_STAGE':
          structuralCount++;
          reasons.push(`حذف مرحلة (${op.targetId})`);
          break;

        case 'UPDATE_STAGE': {
          const payload = op.payload || {};
          let isStructural = false;
          if (payload.departmentId !== undefined) {
            isStructural = true;
            reasons.push(`تغيير قسم المرحلة (${op.targetId})`);
          }
          if (
            payload.estimatedDurationValue !== undefined ||
            payload.estimatedDurationUnit !== undefined ||
            payload.estimatedDurationMinutes !== undefined
          ) {
            isStructural = true;
            reasons.push(`تغيير مدة المرحلة (${op.targetId})`);
          }

          if (isStructural) {
            structuralCount++;
          } else {
            minorCount++;
            reasons.push(`تعديل بيانات وصفية للمرحلة (${op.targetId})`);
          }
          break;
        }

        // 2. Structural Pattern Operations
        case 'ADD_PATTERN':
          structuralCount++;
          reasons.push(`إضافة نمط جديد (${op.payload?.name || op.tempClientId})`);
          break;

        case 'DELETE_PATTERN':
          structuralCount++;
          reasons.push(`حذف نمط (${op.targetId})`);
          break;

        case 'UPDATE_PATTERN':
          minorCount++;
          reasons.push(`تعديل اسم النمط (${op.targetId})`);
          break;

        // 3. Structural Option Operations
        case 'ADD_OPTION':
          structuralCount++;
          reasons.push(`إضافة خيار نمط جديد (${op.payload?.name || op.tempClientId})`);
          break;

        case 'DELETE_OPTION':
          structuralCount++;
          reasons.push(`حذف خيار نمط (${op.targetId})`);
          break;

        case 'UPDATE_OPTION':
          minorCount++;
          reasons.push(`تعديل اسم خيار النمط (${op.targetId})`);
          break;

        // 4. Structural Task Operations
        case 'ADD_TASK':
          structuralCount++;
          reasons.push(`إضافة مهمة جديدة (${op.payload?.name || op.tempClientId})`);
          break;

        case 'DELETE_TASK':
          structuralCount++;
          reasons.push(`حذف مهمة (${op.targetId})`);
          break;

        case 'UPDATE_TASK': {
          const payload = op.payload || {};
          let isStructural = false;
          if (payload.departmentId !== undefined) {
            isStructural = true;
            reasons.push(`تغيير قسم المهمة (${op.targetId})`);
          }
          if (
            payload.estimatedDurationValue !== undefined ||
            payload.estimatedDurationUnit !== undefined ||
            payload.estimatedDurationMinutes !== undefined
          ) {
            isStructural = true;
            reasons.push(`تغيير مدة المهمة (${op.targetId})`);
          }

          if (isStructural) {
            structuralCount++;
          } else {
            minorCount++;
            reasons.push(`تعديل بيانات وصفية للمهمة (${op.targetId})`);
          }
          break;
        }

        // 5. Materials (Planned consumption formulas are structural)
        case 'ADD_STAGE_MATERIAL':
        case 'DELETE_STAGE_MATERIAL':
        case 'ADD_TASK_MATERIAL':
        case 'DELETE_TASK_MATERIAL':
          structuralCount++;
          reasons.push(`تعديل المواد المخططة (${op.type})`);
          break;

        // 6. Minor Operations (Reordering, Specs, Attachments)
        case 'REORDER_WORKFLOW':
        case 'REORDER_PATTERN_OPTIONS':
        case 'REORDER_OPTION_TASKS':
          minorCount++;
          reasons.push(`إعادة ترتيب عناصر سير العمل (${op.type})`);
          break;

        case 'ADD_SPEC':
        case 'UPDATE_SPEC':
        case 'DELETE_SPEC':
          minorCount++;
          reasons.push(`تعديل المواصفات الهندسية الأساسية (${op.type})`);
          break;

        case 'ADD_STAGE_ATTACHMENT':
        case 'DELETE_STAGE_ATTACHMENT':
        case 'ADD_TASK_ATTACHMENT':
        case 'DELETE_TASK_ATTACHMENT':
          minorCount++;
          reasons.push(`تعديل المرفقات (${op.type})`);
          break;

        default:
          minorCount++;
          break;
      }
    }

    if (structuralCount > 0) {
      return {
        classification: 'STRUCTURAL',
        reasons,
        structuralCount,
        minorCount,
      };
    }

    if (minorCount > 0) {
      return {
        classification: 'MINOR',
        reasons,
        structuralCount,
        minorCount,
      };
    }

    return {
      classification: 'NONE',
      reasons: ['لا توجد تغييرات مؤثرة'],
      structuralCount: 0,
      minorCount: 0,
    };
  }
}

export const productionTemplateChangeClassifier = new ProductionTemplateChangeClassifier();
