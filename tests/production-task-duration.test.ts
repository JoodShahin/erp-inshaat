import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  TaskDurationUnit,
  TASK_DURATION_MULTIPLIERS,
} from '../src/modules/production/task-duration/task-duration.types.js';
import {
  calculateTaskDurationMinutes,
  resolveTaskDuration,
  formatTaskDurationArabic,
  isValidTaskDurationUnit,
} from '../src/modules/production/task-duration/task-duration.helper.js';
import { CreateTemplateStageDto } from '../src/modules/production/template-stage/dto/create-stage.dto.js';
import { UpdateTemplateStageDto } from '../src/modules/production/template-stage/dto/update-stage.dto.js';
import { CreateTemplatePatternOptionTaskDto } from '../src/modules/production/template-pattern-option-task/dto/create-pattern-option-task.dto.js';
import { UpdateTemplatePatternOptionTaskDto } from '../src/modules/production/template-pattern-option-task/dto/update-pattern-option-task.dto.js';
import { AddTaskDurationUnitFields1710000000020 } from '../src/database/migrations/1710000000020-AddTaskDurationUnitFields.js';
import { databaseConfig } from '../src/config/database.config.js';

describe('Production Task Duration & Duration Units System', () => {
  // ==========================================
  // 1. STANDARD DURATION CALCULATION & CONVERSION
  // ==========================================
  describe('1. Standard Calculations & Conversions', () => {
    it('calculates 30 minutes -> 30 standard minutes', () => {
      const minutes = calculateTaskDurationMinutes(30, TaskDurationUnit.MINUTES);
      assert.equal(minutes, 30);
    });

    it('calculates 2 hours -> 120 standard minutes', () => {
      const minutes = calculateTaskDurationMinutes(2, TaskDurationUnit.HOURS);
      assert.equal(minutes, 120);
    });

    it('calculates 10 days -> 14400 standard minutes (24h continuous per day)', () => {
      const minutes = calculateTaskDurationMinutes(10, TaskDurationUnit.DAYS);
      assert.equal(minutes, 14400);
    });

    it('rejects negative duration value with error', () => {
      assert.throws(
        () => calculateTaskDurationMinutes(-5, TaskDurationUnit.MINUTES),
        (err: any) => err.code === 'INVALID_TASK_DURATION_VALUE'
      );
    });

    it('rejects zero duration value with error', () => {
      assert.throws(
        () => calculateTaskDurationMinutes(0, TaskDurationUnit.HOURS),
        (err: any) => err.code === 'INVALID_TASK_DURATION_VALUE'
      );
    });

    it('rejects invalid duration unit with error', () => {
      assert.throws(
        () => calculateTaskDurationMinutes(5, 'WEEKS' as any),
        (err: any) => err.code === 'INVALID_TASK_DURATION_UNIT'
      );
    });
  });

  // ==========================================
  // 2. CENTRAL RESOLVE TASK DURATION LOGIC
  // ==========================================
  describe('2. resolveTaskDuration Resolution Logic', () => {
    it('resolves task without duration -> all null', () => {
      const res = resolveTaskDuration({});
      assert.deepEqual(res, {
        estimatedDurationValue: null,
        estimatedDurationUnit: null,
        estimatedDurationMinutes: null,
      });
    });

    it('resolves legacy task with estimatedDurationMinutes = 90 -> 90 minutes', () => {
      const res = resolveTaskDuration({ estimatedDurationMinutes: 90 });
      assert.deepEqual(res, {
        estimatedDurationValue: 90,
        estimatedDurationUnit: TaskDurationUnit.MINUTES,
        estimatedDurationMinutes: 90,
      });
    });

    it('resolves legacy task from existing entity when input is empty', () => {
      const existing = {
        estimatedDurationValue: null,
        estimatedDurationUnit: null,
        estimatedDurationMinutes: 90,
      };
      const res = resolveTaskDuration({}, existing);
      assert.deepEqual(res, {
        estimatedDurationValue: 90,
        estimatedDurationUnit: TaskDurationUnit.MINUTES,
        estimatedDurationMinutes: 90,
      });
    });

    it('resolves modifying 10 days to 12 days -> 17280 minutes', () => {
      const existing = {
        estimatedDurationValue: 10,
        estimatedDurationUnit: TaskDurationUnit.DAYS,
        estimatedDurationMinutes: 14400,
      };
      const res = resolveTaskDuration({ estimatedDurationValue: 12 }, existing);
      assert.deepEqual(res, {
        estimatedDurationValue: 12,
        estimatedDurationUnit: TaskDurationUnit.DAYS,
        estimatedDurationMinutes: 17280,
      });
    });

    it('resolves changing 3 hours to 1 day -> 1440 minutes', () => {
      const existing = {
        estimatedDurationValue: 3,
        estimatedDurationUnit: TaskDurationUnit.HOURS,
        estimatedDurationMinutes: 180,
      };
      const res = resolveTaskDuration(
        { estimatedDurationValue: 1, estimatedDurationUnit: TaskDurationUnit.DAYS },
        existing
      );
      assert.deepEqual(res, {
        estimatedDurationValue: 1,
        estimatedDurationUnit: TaskDurationUnit.DAYS,
        estimatedDurationMinutes: 1440,
      });
    });

    it('resolves changing only unit from HOURS to DAYS for value 3 -> 4320 minutes', () => {
      const existing = {
        estimatedDurationValue: 3,
        estimatedDurationUnit: TaskDurationUnit.HOURS,
        estimatedDurationMinutes: 180,
      };
      const res = resolveTaskDuration(
        { estimatedDurationUnit: TaskDurationUnit.DAYS },
        existing
      );
      assert.deepEqual(res, {
        estimatedDurationValue: 3,
        estimatedDurationUnit: TaskDurationUnit.DAYS,
        estimatedDurationMinutes: 4320,
      });
    });

    it('resolves deleting duration from task (value: null) -> clears all fields to null', () => {
      const existing = {
        estimatedDurationValue: 5,
        estimatedDurationUnit: TaskDurationUnit.DAYS,
        estimatedDurationMinutes: 7200,
      };
      const res = resolveTaskDuration({ estimatedDurationValue: null }, existing);
      assert.deepEqual(res, {
        estimatedDurationValue: null,
        estimatedDurationUnit: null,
        estimatedDurationMinutes: null,
      });
    });

    it('resolves duration value without unit -> defaults to MINUTES', () => {
      const res = resolveTaskDuration({ estimatedDurationValue: 45 });
      assert.deepEqual(res, {
        estimatedDurationValue: 45,
        estimatedDurationUnit: TaskDurationUnit.MINUTES,
        estimatedDurationMinutes: 45,
      });
    });

    it('rejects conflicting duration value/unit and standard minutes', () => {
      assert.throws(
        () =>
          resolveTaskDuration({
            estimatedDurationValue: 2,
            estimatedDurationUnit: TaskDurationUnit.HOURS,
            estimatedDurationMinutes: 50, // Conflict: 2 hours is 120, not 50!
          }),
        (err: any) => err.code === 'TASK_DURATION_MISMATCH'
      );
    });

    it('accepts matching duration value/unit and standard minutes', () => {
      const res = resolveTaskDuration({
        estimatedDurationValue: 2,
        estimatedDurationUnit: TaskDurationUnit.HOURS,
        estimatedDurationMinutes: 120,
      });
      assert.equal(res.estimatedDurationMinutes, 120);
    });
  });

  // ==========================================
  // 3. HUMAN-READABLE ARABIC PRESENTATION
  // ==========================================
  describe('3. Arabic Presentation Formatting', () => {
    it('formats 30 minutes as 30 دقيقة', () => {
      assert.equal(formatTaskDurationArabic(30, TaskDurationUnit.MINUTES), '30 دقيقة');
    });

    it('formats 5 hours as 5 ساعات', () => {
      assert.equal(formatTaskDurationArabic(5, TaskDurationUnit.HOURS), '5 ساعات');
    });

    it('formats 2 hours as 2 ساعة', () => {
      assert.equal(formatTaskDurationArabic(2, TaskDurationUnit.HOURS), '2 ساعة');
    });

    it('formats 10 days as 10 أيام', () => {
      assert.equal(formatTaskDurationArabic(10, TaskDurationUnit.DAYS), '10 أيام');
    });

    it('formats 1 day as 1 يوم', () => {
      assert.equal(formatTaskDurationArabic(1, TaskDurationUnit.DAYS), '1 يوم');
    });

    it('formats 15 days as 15 يوم', () => {
      assert.equal(formatTaskDurationArabic(15, TaskDurationUnit.DAYS), '15 يوم');
    });

    it('formats null duration as —', () => {
      assert.equal(formatTaskDurationArabic(null, null), '—');
    });

    it('formats fallback minutes when value/unit are missing', () => {
      assert.equal(formatTaskDurationArabic(null, null, 90), '90 دقيقة');
    });
  });

  // ==========================================
  // 4. DTO VALIDATIONS
  // ==========================================
  describe('4. DTO Validations for Stages and Tasks', () => {
    it('CreateTemplateStageDto: accepts valid duration value and unit', async () => {
      const dto = plainToInstance(CreateTemplateStageDto, {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'صب خرسانة',
        estimatedDurationValue: 10,
        estimatedDurationUnit: 'DAYS',
      });
      const errors = await validate(dto);
      assert.equal(errors.length, 0);
      assert.equal(dto.estimatedDurationValue, 10);
      assert.equal(dto.estimatedDurationUnit, TaskDurationUnit.DAYS);
    });

    it('CreateTemplateStageDto: rejects negative estimatedDurationValue', async () => {
      const dto = plainToInstance(CreateTemplateStageDto, {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'مهمة',
        estimatedDurationValue: -5,
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'estimatedDurationValue'));
    });

    it('CreateTemplateStageDto: rejects zero estimatedDurationValue (must be at least 1)', async () => {
      const dto = plainToInstance(CreateTemplateStageDto, {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'مهمة',
        estimatedDurationValue: 0,
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'estimatedDurationValue'));
    });

    it('CreateTemplateStageDto: rejects invalid estimatedDurationUnit', async () => {
      const dto = plainToInstance(CreateTemplateStageDto, {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'مهمة',
        estimatedDurationValue: 10,
        estimatedDurationUnit: 'MONTHS',
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'estimatedDurationUnit'));
    });

    it('UpdateTemplateStageDto: accepts null to delete duration', async () => {
      const dto = plainToInstance(UpdateTemplateStageDto, {
        estimatedDurationValue: null,
      });
      const errors = await validate(dto);
      assert.equal(errors.length, 0);
      assert.equal(dto.estimatedDurationValue, null);
    });

    it('CreateTemplatePatternOptionTaskDto: accepts valid hours duration', async () => {
      const dto = plainToInstance(CreateTemplatePatternOptionTaskDto, {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'تركيب باب',
        estimatedDurationValue: 3,
        estimatedDurationUnit: 'HOURS',
      });
      const errors = await validate(dto);
      assert.equal(errors.length, 0);
      assert.equal(dto.estimatedDurationValue, 3);
      assert.equal(dto.estimatedDurationUnit, TaskDurationUnit.HOURS);
    });

    it('UpdateTemplatePatternOptionTaskDto: rejects invalid non-numeric duration', async () => {
      const dto = plainToInstance(UpdateTemplatePatternOptionTaskDto, {
        estimatedDurationValue: 'invalid-number' as any,
      });
      const errors = await validate(dto);
      assert.ok(errors.some((e) => e.property === 'estimatedDurationValue'));
    });
  });

  // ==========================================
  // 5. MIGRATION 20 REGISTRATION & INTEGRITY
  // ==========================================
  describe('5. Migration 20 Registration', () => {
    it('databaseConfig registers AddTaskDurationUnitFields1710000000020', () => {
      const isRegistered = (databaseConfig.migrations as any[]).includes(
        AddTaskDurationUnitFields1710000000020
      );
      assert.ok(isRegistered, 'Migration 20 must be registered in databaseConfig.migrations');
    });

    it('Migration 20 executes up() safely on tables with missing columns', async () => {
      const migration = new AddTaskDurationUnitFields1710000000020();
      const addedCols: Array<{ table: string; col: string }> = [];
      const queries: string[] = [];

      const fakeTable = {
        findColumnByName: (_col: string) => null,
      };

      const fakeQueryRunner = {
        getTable: async (_table: string) => fakeTable,
        addColumn: async (table: string, column: any) => {
          addedCols.push({ table, col: column.name });
        },
        dropColumn: async () => {},
        query: async (sql: string) => {
          queries.push(sql);
        },
      } as any;

      await migration.up(fakeQueryRunner);

      // Verify columns were added to all 3 tables
      assert.equal(addedCols.length, 6);
      assert.ok(addedCols.some((c) => c.table === 'production_template_stage' && c.col === 'estimated_duration_value'));
      assert.ok(addedCols.some((c) => c.table === 'production_template_stage' && c.col === 'estimated_duration_unit'));
      assert.ok(addedCols.some((c) => c.table === 'production_template_pattern_option_task' && c.col === 'estimated_duration_value'));
      assert.ok(addedCols.some((c) => c.table === 'production_template_pattern_option_task' && c.col === 'estimated_duration_unit'));
      assert.ok(addedCols.some((c) => c.table === 'production_execution_task' && c.col === 'estimated_duration_value'));
      assert.ok(addedCols.some((c) => c.table === 'production_execution_task' && c.col === 'estimated_duration_unit'));

      // Verify UPDATE queries ran for existing rows
      assert.equal(queries.length, 3);
      assert.ok(queries[0].includes('SET `estimated_duration_value` = `estimated_duration_minutes`'));
      assert.ok(queries[0].includes("`estimated_duration_unit` = 'MINUTES'"));
    });
  });
});
