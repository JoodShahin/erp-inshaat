import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';
import {
  TaskDurationUnit,
  TASK_DURATION_MULTIPLIERS,
  TaskDurationInput,
  ResolvedTaskDuration,
} from './task-duration.types.js';

export const MAX_SAFE_DURATION_VALUE = 1_000_000;
export const MAX_SAFE_DURATION_MINUTES = 2_147_483_647; // Max signed 32-bit int

/**
 * Checks if a given string is a valid TaskDurationUnit enum member.
 */
export function isValidTaskDurationUnit(unit: unknown): unit is TaskDurationUnit {
  return (
    typeof unit === 'string' &&
    Object.values(TaskDurationUnit).includes(unit as TaskDurationUnit)
  );
}

/**
 * Calculates standard duration in minutes based on unit.
 * Conversion standard:
 * - MINUTES: value * 1
 * - HOURS: value * 60
 * - DAYS: value * 1440 (24 continuous hours)
 */
export function calculateTaskDurationMinutes(
  value: number,
  unit: TaskDurationUnit
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BusinessRuleError(
      'مدة المهمة يجب أن تكون رقماً موجباً أكبر من الصفر',
      'INVALID_TASK_DURATION_VALUE'
    );
  }

  const multiplier = TASK_DURATION_MULTIPLIERS[unit];
  if (!multiplier) {
    throw new BusinessRuleError(
      `وحدة مدة المهمة غير مدعومة: ${unit}`,
      'INVALID_TASK_DURATION_UNIT'
    );
  }

  const minutes = Math.round(value * multiplier);
  if (minutes > MAX_SAFE_DURATION_MINUTES) {
    throw new BusinessRuleError(
      'المدة المحسوبة بالدقائق تتجاوز الحد الأقصى المسموح به في النظام',
      'TASK_DURATION_OVERFLOW'
    );
  }

  return minutes;
}

/**
 * Resolves input duration fields (value, unit, minutes) into a validated, deterministic state.
 *
 * Rules:
 * 1. If estimatedDurationValue is explicitly null -> duration is cleared (all 3 fields null).
 * 2. If estimatedDurationValue is provided:
 *    - Validates positive finite number and upper bounds.
 *    - Defaults unit to MINUTES if not specified.
 *    - Calculates standard minutes.
 *    - If estimatedDurationMinutes is also provided, ensures it matches calculated minutes.
 * 3. If estimatedDurationValue is undefined, but estimatedDurationUnit is provided:
 *    - If existing duration exists, recalculates minutes using existing value and new unit.
 * 4. If estimatedDurationValue is undefined, but legacy estimatedDurationMinutes is provided:
 *    - If null -> cleared.
 *    - If positive number -> value: minutes, unit: MINUTES, minutes: minutes.
 * 5. If all fields are undefined -> preserves existing duration if provided, else all null.
 */
export function resolveTaskDuration(
  input: TaskDurationInput,
  existing?: {
    estimatedDurationValue?: number | null;
    estimatedDurationUnit?: TaskDurationUnit | string | null;
    estimatedDurationMinutes?: number | null;
  }
): ResolvedTaskDuration {
  // Case 1: Explicit deletion (value is null)
  if (input.estimatedDurationValue === null) {
    return {
      estimatedDurationValue: null,
      estimatedDurationUnit: null,
      estimatedDurationMinutes: null,
    };
  }

  // Case 2: User provided a new estimatedDurationValue
  if (input.estimatedDurationValue !== undefined) {
    const rawVal = input.estimatedDurationValue;
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal <= 0) {
      throw new BusinessRuleError(
        'قيمة مدة المهمة يجب أن تكون رقماً موجباً أكبر من الصفر',
        'INVALID_TASK_DURATION_VALUE'
      );
    }
    if (rawVal > MAX_SAFE_DURATION_VALUE) {
      throw new BusinessRuleError(
        'قيمة مدة المهمة تتجاوز الحد الأقصى المسموح به',
        'TASK_DURATION_VALUE_TOO_LARGE'
      );
    }

    // Determine unit
    let unit: TaskDurationUnit = TaskDurationUnit.MINUTES;
    if (input.estimatedDurationUnit !== undefined && input.estimatedDurationUnit !== null) {
      if (!isValidTaskDurationUnit(input.estimatedDurationUnit)) {
        throw new BusinessRuleError(
          `وحدة مدة المهمة غير صالحة: ${input.estimatedDurationUnit}`,
          'INVALID_TASK_DURATION_UNIT'
        );
      }
      unit = input.estimatedDurationUnit;
    } else if (existing?.estimatedDurationUnit && isValidTaskDurationUnit(existing.estimatedDurationUnit)) {
      unit = existing.estimatedDurationUnit;
    }

    const calculatedMinutes = calculateTaskDurationMinutes(rawVal, unit);

    // If estimatedDurationMinutes is also explicitly sent, verify consistency
    if (
      input.estimatedDurationMinutes !== undefined &&
      input.estimatedDurationMinutes !== null
    ) {
      if (input.estimatedDurationMinutes !== calculatedMinutes) {
        throw new BusinessRuleError(
          `قيمة المدة المعيارية بالدقائق (${input.estimatedDurationMinutes}) لا تتطابق مع القيمة والوحدة المدخلة (${rawVal} ${unit} = ${calculatedMinutes} دقيقة)`,
          'TASK_DURATION_MISMATCH'
        );
      }
    }

    return {
      estimatedDurationValue: rawVal,
      estimatedDurationUnit: unit,
      estimatedDurationMinutes: calculatedMinutes,
    };
  }

  // Case 3: Value was not provided, but unit was changed for an existing task
  if (
    input.estimatedDurationUnit !== undefined &&
    input.estimatedDurationUnit !== null &&
    existing?.estimatedDurationValue != null &&
    existing.estimatedDurationValue > 0
  ) {
    if (!isValidTaskDurationUnit(input.estimatedDurationUnit)) {
      throw new BusinessRuleError(
        `وحدة مدة المهمة غير صالحة: ${input.estimatedDurationUnit}`,
        'INVALID_TASK_DURATION_UNIT'
      );
    }
    const unit = input.estimatedDurationUnit;
    const value = existing.estimatedDurationValue;
    const calculatedMinutes = calculateTaskDurationMinutes(value, unit);

    return {
      estimatedDurationValue: value,
      estimatedDurationUnit: unit,
      estimatedDurationMinutes: calculatedMinutes,
    };
  }

  // Case 4: Legacy estimatedDurationMinutes sent alone
  if (input.estimatedDurationMinutes !== undefined) {
    if (input.estimatedDurationMinutes === null) {
      return {
        estimatedDurationValue: null,
        estimatedDurationUnit: null,
        estimatedDurationMinutes: null,
      };
    }

    const mins = input.estimatedDurationMinutes;
    if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) {
      throw new BusinessRuleError(
        'المدة التقديرية بالدقائق يجب أن تكون رقماً موجباً',
        'INVALID_TASK_DURATION_VALUE'
      );
    }
    if (mins > MAX_SAFE_DURATION_MINUTES) {
      throw new BusinessRuleError(
        'المدة التقديرية بالدقائق تتجاوز الحد الأقصى المسموح به',
        'TASK_DURATION_OVERFLOW'
      );
    }

    return {
      estimatedDurationValue: mins,
      estimatedDurationUnit: TaskDurationUnit.MINUTES,
      estimatedDurationMinutes: mins,
    };
  }

  // Case 5: Preserve existing duration if present
  if (existing) {
    const value = existing.estimatedDurationValue ?? existing.estimatedDurationMinutes ?? null;
    const unit = existing.estimatedDurationUnit && isValidTaskDurationUnit(existing.estimatedDurationUnit)
      ? existing.estimatedDurationUnit
      : (value !== null ? TaskDurationUnit.MINUTES : null);
    const minutes = existing.estimatedDurationMinutes ?? (value !== null && unit ? calculateTaskDurationMinutes(value, unit) : null);

    return {
      estimatedDurationValue: value,
      estimatedDurationUnit: unit,
      estimatedDurationMinutes: minutes,
    };
  }

  return {
    estimatedDurationValue: null,
    estimatedDurationUnit: null,
    estimatedDurationMinutes: null,
  };
}

/**
 * Formats task duration for human-readable Arabic presentation.
 */
export function formatTaskDurationArabic(
  value?: number | null,
  unit?: TaskDurationUnit | string | null,
  fallbackMinutes?: number | null
): string {
  if (value != null && unit && isValidTaskDurationUnit(unit)) {
    if (unit === TaskDurationUnit.DAYS) {
      return value >= 3 && value <= 10 ? `${value} أيام` : `${value} يوم`;
    }
    if (unit === TaskDurationUnit.HOURS) {
      return value >= 3 && value <= 10 ? `${value} ساعات` : `${value} ساعة`;
    }
    if (unit === TaskDurationUnit.MINUTES) {
      return `${value} دقيقة`;
    }
  }

  if (fallbackMinutes != null && fallbackMinutes > 0) {
    return `${fallbackMinutes} دقيقة`;
  }

  return '—';
}
