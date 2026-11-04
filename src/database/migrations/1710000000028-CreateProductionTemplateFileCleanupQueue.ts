import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateProductionTemplateFileCleanupQueue1710000000028 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_template_file_cleanup_queue');
    if (!tableExists) {
      await queryRunner.createTable(
        new Table({
          name: 'production_template_file_cleanup_queue',
          columns: [
            {
              name: 'id',
              type: 'varchar',
              length: '36',
              isPrimary: true,
            },
            {
              name: 'file_id',
              type: 'varchar',
              length: '36',
              isNullable: false,
            },
            {
              name: 'storage_key',
              type: 'varchar',
              length: '500',
              isNullable: false,
            },
            {
              name: 'status',
              type: 'enum',
              enum: ['PENDING', 'FAILED', 'COMPLETED'],
              default: "'PENDING'",
              isNullable: false,
            },
            {
              name: 'attempts',
              type: 'int',
              default: 0,
              isNullable: false,
            },
            {
              name: 'last_error',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'next_retry_at',
              type: 'datetime',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'datetime',
              precision: 6,
              default: 'CURRENT_TIMESTAMP(6)',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'datetime',
              precision: 6,
              default: 'CURRENT_TIMESTAMP(6)',
              onUpdate: 'CURRENT_TIMESTAMP(6)',
              isNullable: false,
            },
          ],
        }),
        true
      );

      await queryRunner.createIndices('production_template_file_cleanup_queue', [
        new TableIndex({
          name: 'IDX_prod_template_cleanup_file_id',
          columnNames: ['file_id'],
        }),
        new TableIndex({
          name: 'IDX_prod_template_cleanup_status',
          columnNames: ['status'],
        }),
        new TableIndex({
          name: 'IDX_prod_template_cleanup_next_retry',
          columnNames: ['next_retry_at'],
        }),
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_template_file_cleanup_queue');
    if (tableExists) {
      await queryRunner.dropTable('production_template_file_cleanup_queue', true);
    }
  }
}
