import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddSpecificationsToExecutionPlan1710000000018
  implements MigrationInterface
{
  name = 'AddSpecificationsToExecutionPlan1710000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('production_execution_plan');
    if (!table) {
      throw new Error(
        "Migration 1710000000018 up failed: Base table 'production_execution_plan' does not exist."
      );
    }

    const specCol = table.findColumnByName('specifications');
    if (!specCol) {
      await queryRunner.addColumn(
        'production_execution_plan',
        new TableColumn({
          name: 'specifications',
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

    const specCol = table.findColumnByName('specifications');
    if (specCol) {
      await queryRunner.dropColumn('production_execution_plan', 'specifications');
    }
  }
}
