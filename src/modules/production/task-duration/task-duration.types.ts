export enum TaskDurationUnit {
  MINUTES = 'MINUTES',
  HOURS = 'HOURS',
  DAYS = 'DAYS',
}

export const TASK_DURATION_MULTIPLIERS: Record<TaskDurationUnit, number> = {
  [TaskDurationUnit.MINUTES]: 1,
  [TaskDurationUnit.HOURS]: 60,
  [TaskDurationUnit.DAYS]: 1440,
};

export const TASK_DURATION_UNIT_LABELS_AR: Record<TaskDurationUnit, string> = {
  [TaskDurationUnit.MINUTES]: 'دقائق',
  [TaskDurationUnit.HOURS]: 'ساعات',
  [TaskDurationUnit.DAYS]: 'أيام',
};

export interface TaskDurationInput {
  estimatedDurationValue?: number | null;
  estimatedDurationUnit?: TaskDurationUnit | string | null;
  estimatedDurationMinutes?: number | null;
}

export interface ResolvedTaskDuration {
  estimatedDurationValue: number | null;
  estimatedDurationUnit: TaskDurationUnit | null;
  estimatedDurationMinutes: number | null;
}
