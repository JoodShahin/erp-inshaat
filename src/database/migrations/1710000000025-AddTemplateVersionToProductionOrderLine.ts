import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddTemplateVersionToProductionOrderLine1710000000025 implements MigrationInterface {
  name = 'AddTemplateVersionToProductionOrderLine1710000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('production_order_line');
    if (table && !table.findColumnByName('template_version_id')) {
      await queryRunner.addColumn(
        'production_order_line',
        new TableColumn({
          name: 'template_version_id',
          type: 'varchar',
          length: '36',
          isNullable: true,
        })
      );

      await queryRunner.createIndex(
        'production_order_line',
        new TableIndex({
          name: 'IDX_production_order_line_template_version_id',
          columnNames: ['template_version_id'],
        })
      );

      await queryRunner.createForeignKey(
        'production_order_line',
        new TableForeignKey({
          name: 'FK_order_line_template_version',
          columnNames: ['template_version_id'],
          referencedTableName: 'production_template_version',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
        })
      );

      // Backfill existing production_order_line records to the latest version of their template
      await queryRunner.query(`
        UPDATE \`production_order_line\` pol
        JOIN (
          SELECT v1.\`id\` AS \`version_id\`, v1.\`template_id\`
          FROM \`production_template_version\` v1
          JOIN (
            SELECT \`template_id\`, MAX(\`created_at\`) AS \`max_created_at\`
            FROM \`production_template_version\`
            WHERE \`deleted_at\` IS NULL
            GROUP BY \`template_id\`
          ) v2 ON v1.\`template_id\` = v2.\`template_id\` AND v1.\`created_at\` = v2.\`max_created_at\`
        ) latest ON latest.\`template_id\` = pol.\`template_id\`
        SET pol.\`template_version_id\` = latest.\`version_id\`
        WHERE pol.\`template_version_id\` IS NULL;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('production_order_line');
    if (table) {
      const fk = table.foreignKeys.find((k) => k.columnNames.includes('template_version_id'));
      if (fk) await queryRunner.dropForeignKey('production_order_line', fk);
      const idx = table.indices.find((i) => i.columnNames.includes('template_version_id'));
      if (idx) await queryRunner.dropIndex('production_order_line', idx);
      if (table.findColumnByName('template_version_id')) {
        await queryRunner.dropColumn('production_order_line', 'template_version_id');
      }
    }
  }
}
