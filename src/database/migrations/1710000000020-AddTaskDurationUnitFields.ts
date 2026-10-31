import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddTaskDurationUnitFields1710000000020
  implements MigrationInterface
{
  name = 'AddTaskDurationUnitFields1710000000020';

  private readonly tables = [
    'production_template_stage',
    'production_template_pattern_option_task',
    'production_execution_task',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of this.tables) {
      const table = await queryRunner.getTable(tableName);
      if (!table) {
        continue;
      }

      const valCol = table.findColumnByName('estimated_duration_value');
      if (!valCol) {
        await queryRunner.addColumn(
          tableName,
          new TableColumn({
            name: 'estimated_duration_value',
            type: 'int',
            isNullable: true,
            default: null,
          })
        );
      }

      const unitCol = table.findColumnByName('estimated_duration_unit');
      if (!unitCol) {
        await queryRunner.addColumn(
          tableName,
          new TableColumn({
            name: 'estimated_duration_unit',
            type: 'varchar',
            length: '20',
            isNullable: true,
            default: null,
          })
        );
      }

      // Backfill existing rows that have estimated_duration_minutes
      await queryRunner.query(`
        UPDATE \`${tableName}\`
        SET \`estimated_duration_value\` = \`estimated_duration_minutes\`,
            \`estimated_duration_unit\` = 'MINUTES'
        WHERE \`estimated_duration_minutes\` IS NOT NULL
          AND \`estimated_duration_value\` IS NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of this.tables) {
      const table = await queryRunner.getTable(tableName);
      if (!table) {
        continue;
      }

      const unitCol = table.findColumnByName('estimated_duration_unit');
      if (unitCol) {
        await queryRunner.dropColumn(tableName, 'estimated_duration_unit');
      }

      const valCol = table.findColumnByName('estimated_duration_value');
      if (valCol) {
        await queryRunner.dropColumn(tableName, 'estimated_duration_value');
      }
    }
  }
}
