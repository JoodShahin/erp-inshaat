import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateProductionYardTemplate1710000000021 implements MigrationInterface {
  name = 'CreateProductionYardTemplate1710000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_yard_template');
    if (!tableExists) {
      await queryRunner.createTable(
        new Table({
          name: 'production_yard_template',
          columns: [
            {
              name: 'id',
              type: 'varchar',
              length: '36',
              isPrimary: true,
            },
            {
              name: 'yard_id',
              type: 'varchar',
              length: '36',
              isNullable: false,
            },
            {
              name: 'template_id',
              type: 'varchar',
              length: '36',
              isNullable: false,
            },
            {
              name: 'created_by_user_id',
              type: 'varchar',
              length: '36',
              isNullable: true,
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
              default: 'CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)',
            },
          ],
          indices: [
            new TableIndex({
              name: 'UQ_production_yard_template_yard_template',
              columnNames: ['yard_id', 'template_id'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'IDX_production_yard_template_yard_id',
              columnNames: ['yard_id'],
            }),
            new TableIndex({
              name: 'IDX_production_yard_template_template_id',
              columnNames: ['template_id'],
            }),
          ],
          foreignKeys: [
            new TableForeignKey({
              name: 'FK_production_yard_template_yard',
              columnNames: ['yard_id'],
              referencedTableName: 'production_yard',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
              onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
              name: 'FK_production_yard_template_template',
              columnNames: ['template_id'],
              referencedTableName: 'production_template',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
              onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
              name: 'FK_production_yard_template_created_by',
              columnNames: ['created_by_user_id'],
              referencedTableName: 'system_user',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
              onUpdate: 'CASCADE',
            }),
          ],
        }),
        true
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_yard_template');
    if (tableExists) {
      await queryRunner.dropTable('production_yard_template', true, true, true);
    }
  }
}
