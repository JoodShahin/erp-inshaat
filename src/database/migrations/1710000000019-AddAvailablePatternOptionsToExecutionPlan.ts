import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddAvailablePatternOptionsToExecutionPlan1710000000019
  implements MigrationInterface
{
  name = 'AddAvailablePatternOptionsToExecutionPlan1710000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('production_execution_plan');
    if (!table) {
      throw new Error(
        "Migration 1710000000019 up failed: Base table 'production_execution_plan' does not exist."
      );
    }

    const col = table.findColumnByName('available_pattern_options');
    if (!col) {
      await queryRunner.addColumn(
        'production_execution_plan',
        new TableColumn({
          name: 'available_pattern_options',
          type: 'json',
          isNullable: true,
          default: null,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('production_execution_plan');
    if (!table) {
      return;
    }

    const col = table.findColumnByName('available_pattern_options');
    if (col) {
      await queryRunner.dropColumn('production_execution_plan', 'available_pattern_options');
    }
  }
}
