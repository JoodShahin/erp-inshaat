import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateProductionExecutionPlansAndUnits1710000000017
  implements MigrationInterface
{
  name = 'CreateProductionExecutionPlansAndUnits1710000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // =========================================================================
    // 1. Create table: production_execution_plan
    // =========================================================================
    await queryRunner.createTable(
      new Table({
        name: 'production_execution_plan',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'order_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'order_line_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'template_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'template_name',
            type: 'varchar',
            length: '150',
            isNullable: false,
          },
          {
            name: 'template_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'template_reference_number',
            type: 'varchar',
            length: '100',
            isNullable: true,
            default: null,
          },
          {
            name: 'template_description',
            type: 'text',
            isNullable: true,
            default: null,
          },
          {
            name: 'line_quantity',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'configuration_hash',
            type: 'char',
            length: '64',
            isNullable: false,
          },
          {
            name: 'pattern_summary',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'datetime',
            precision: 6,
            isNullable: true,
            default: null,
          },
        ],
        indices: [
          new TableIndex({
            name: 'IDX_prod_exec_plan_order_id',
            columnNames: ['order_id'],
          }),
          new TableIndex({
            name: 'UQ_prod_exec_plan_order_line_id',
            columnNames: ['order_line_id'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'IDX_prod_exec_plan_template_id',
            columnNames: ['template_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_exec_plan_deleted_at',
            columnNames: ['deleted_at'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_prod_exec_plan_order',
            columnNames: ['order_id'],
            referencedTableName: 'production_order',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_exec_plan_order_line',
            columnNames: ['order_line_id'],
            referencedTableName: 'production_order_line',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_exec_plan_template',
            columnNames: ['template_id'],
            referencedTableName: 'production_template',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
        ],
      }),
      true
    );

    // =========================================================================
    // 2. Create table: production_execution_task
    // =========================================================================
    await queryRunner.createTable(
      new Table({
        name: 'production_execution_task',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'plan_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '150',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
            default: null,
          },
          {
            name: 'department_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'department_name',
            type: 'varchar',
            length: '150',
            isNullable: true,
            default: null,
          },
          {
            name: 'sort_order',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'task_source',
            type: 'varchar',
            length: '30',
            isNullable: false,
            default: "'GENERAL'",
          },
          {
            name: 'source_stage_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'source_task_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'template_pattern_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'pattern_name',
            type: 'varchar',
            length: '150',
            isNullable: true,
            default: null,
          },
          {
            name: 'template_pattern_option_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'option_name',
            type: 'varchar',
            length: '150',
            isNullable: true,
            default: null,
          },
          {
            name: 'estimated_duration_minutes',
            type: 'int',
            isNullable: true,
            default: null,
          },
          {
            name: 'estimated_cost',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
            default: null,
          },
          {
            name: 'planned_materials',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'attachments',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'archived_at',
            type: 'datetime',
            precision: 6,
            isNullable: true,
            default: null,
          },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'datetime',
            precision: 6,
            isNullable: true,
            default: null,
          },
        ],
        indices: [
          new TableIndex({
            name: 'IDX_prod_exec_task_plan_id',
            columnNames: ['plan_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_exec_task_department_id',
            columnNames: ['department_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_exec_task_sort_order',
            columnNames: ['sort_order'],
          }),
          new TableIndex({
            name: 'IDX_prod_exec_task_is_active',
            columnNames: ['is_active'],
          }),
          new TableIndex({
            name: 'IDX_prod_exec_task_deleted_at',
            columnNames: ['deleted_at'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_prod_exec_task_plan',
            columnNames: ['plan_id'],
            referencedTableName: 'production_execution_plan',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_exec_task_department',
            columnNames: ['department_id'],
            referencedTableName: 'production_department',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
        ],
      }),
      true
    );

    // =========================================================================
    // 3. Create table: production_unit
    // =========================================================================
    await queryRunner.createTable(
      new Table({
        name: 'production_unit',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'order_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'order_line_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'plan_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'unit_sequence',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'unit_number',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'code',
            type: 'varchar',
            length: '100',
            isNullable: true,
            default: null,
          },
          {
            name: 'current_yard_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '30',
            default: "'CREATED'",
          },
          {
            name: 'is_cancelled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'cancelled_at',
            type: 'datetime',
            precision: 6,
            isNullable: true,
            default: null,
          },
          {
            name: 'cancellation_reason',
            type: 'text',
            isNullable: true,
            default: null,
          },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'datetime',
            precision: 6,
            isNullable: true,
            default: null,
          },
        ],
        indices: [
          new TableIndex({
            name: 'UQ_prod_unit_line_sequence',
            columnNames: ['order_line_id', 'unit_sequence'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'IDX_prod_unit_order_id',
            columnNames: ['order_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_order_line_id',
            columnNames: ['order_line_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_plan_id',
            columnNames: ['plan_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_code',
            columnNames: ['code'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_current_yard_id',
            columnNames: ['current_yard_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_status',
            columnNames: ['status'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_is_cancelled',
            columnNames: ['is_cancelled'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_deleted_at',
            columnNames: ['deleted_at'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_prod_unit_order',
            columnNames: ['order_id'],
            referencedTableName: 'production_order',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_order_line',
            columnNames: ['order_line_id'],
            referencedTableName: 'production_order_line',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_plan',
            columnNames: ['plan_id'],
            referencedTableName: 'production_execution_plan',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_yard',
            columnNames: ['current_yard_id'],
            referencedTableName: 'production_yard',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          }),
        ],
      }),
      true
    );

    // =========================================================================
    // 4. Create table: production_unit_event
    // =========================================================================
    await queryRunner.createTable(
      new Table({
        name: 'production_unit_event',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'unit_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'event_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'created_by_user_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'occurred_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'department_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'execution_task_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'previous_data',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'new_data',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'correlation_id',
            type: 'varchar',
            length: '36',
            isNullable: true,
            default: null,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
            default: null,
          },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
        ],
        indices: [
          new TableIndex({
            name: 'IDX_prod_unit_event_unit_id',
            columnNames: ['unit_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_event_type',
            columnNames: ['event_type'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_event_created_by',
            columnNames: ['created_by_user_id'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_event_occurred_at',
            columnNames: ['occurred_at'],
          }),
          new TableIndex({
            name: 'IDX_prod_unit_event_correlation_id',
            columnNames: ['correlation_id'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_prod_unit_event_unit',
            columnNames: ['unit_id'],
            referencedTableName: 'production_unit',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_event_user',
            columnNames: ['created_by_user_id'],
            referencedTableName: 'system_user',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_event_dept',
            columnNames: ['department_id'],
            referencedTableName: 'production_department',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'FK_prod_unit_event_task',
            columnNames: ['execution_task_id'],
            referencedTableName: 'production_execution_task',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          }),
        ],
      }),
      true
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Safety Guard: Check if execution plans or units exist before dropping
    const planCount: Array<{ count: string | number }> = await queryRunner.query(
      `SELECT COUNT(*) as count FROM production_execution_plan`
    );
    if (Number(planCount[0]?.count ?? 0) > 0) {
      throw new Error(
        `Migration 1710000000017 down failed: Cannot revert because production_execution_plan rows exist. Archive or delete execution data before reverting.`
      );
    }

    // 2. Drop tables in reverse dependency order
    await queryRunner.dropTable('production_unit_event', true);
    await queryRunner.dropTable('production_unit', true);
    await queryRunner.dropTable('production_execution_task', true);
    await queryRunner.dropTable('production_execution_plan', true);
  }
}
