import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateProductionTemplateStoredFiles1710000000024 implements MigrationInterface {
  name = 'CreateProductionTemplateStoredFiles1710000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create production_template_stored_file table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`production_template_stored_file\` (
        \`id\` varchar(36) NOT NULL,
        \`template_id\` varchar(36) NOT NULL,
        \`storage_key\` varchar(500) NOT NULL,
        \`original_file_name\` varchar(255) NOT NULL,
        \`mime_type\` varchar(100) NOT NULL,
        \`size_bytes\` bigint NOT NULL,
        \`created_by_user_id\` varchar(36) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_production_template_stored_file_storage_key\` (\`storage_key\`),
        INDEX \`IDX_production_template_stored_file_template_id\` (\`template_id\`),
        INDEX \`IDX_production_template_stored_file_created_by\` (\`created_by_user_id\`),
        INDEX \`IDX_production_template_stored_file_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`FK_stored_file_template\` FOREIGN KEY (\`template_id\`) REFERENCES \`production_template\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`FK_stored_file_user\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`system_user\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 2. Add file_id to production_template_stage_attachment
    const stageAttTable = await queryRunner.getTable('production_template_stage_attachment');
    if (stageAttTable && !stageAttTable.findColumnByName('file_id')) {
      await queryRunner.addColumn(
        'production_template_stage_attachment',
        new TableColumn({
          name: 'file_id',
          type: 'varchar',
          length: '36',
          isNullable: true,
        })
      );

      await queryRunner.createIndex(
        'production_template_stage_attachment',
        new TableIndex({
          name: 'IDX_production_template_stage_attachment_file_id',
          columnNames: ['file_id'],
        })
      );

      await queryRunner.createForeignKey(
        'production_template_stage_attachment',
        new TableForeignKey({
          name: 'FK_stage_attachment_stored_file',
          columnNames: ['file_id'],
          referencedTableName: 'production_template_stored_file',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
        })
      );
    }

    // 3. Drop unique index on storage_key in production_template_stage_attachment if unique
    if (stageAttTable) {
      const uniqueIndices = stageAttTable.indices.filter(
        (i) => i.isUnique && i.columnNames.length === 1 && i.columnNames[0] === 'storage_key'
      );
      for (const idx of uniqueIndices) {
        await queryRunner.dropIndex('production_template_stage_attachment', idx);
      }
    }

    // Ensure non-unique index on storage_key in production_template_stage_attachment
    const refreshedStageAtt = await queryRunner.getTable('production_template_stage_attachment');
    if (refreshedStageAtt && !refreshedStageAtt.indices.some((i) => i.columnNames.includes('storage_key'))) {
      await queryRunner.createIndex(
        'production_template_stage_attachment',
        new TableIndex({
          name: 'IDX_production_template_stage_attachment_storage_key',
          columnNames: ['storage_key'],
        })
      );
    }

    // 4. Add file_id to production_template_pattern_option_task_attachment
    const taskAttTable = await queryRunner.getTable('production_template_pattern_option_task_attachment');
    if (taskAttTable && !taskAttTable.findColumnByName('file_id')) {
      await queryRunner.addColumn(
        'production_template_pattern_option_task_attachment',
        new TableColumn({
          name: 'file_id',
          type: 'varchar',
          length: '36',
          isNullable: true,
        })
      );

      await queryRunner.createIndex(
        'production_template_pattern_option_task_attachment',
        new TableIndex({
          name: 'IDX_production_pattern_task_attachment_file_id',
          columnNames: ['file_id'],
        })
      );

      await queryRunner.createForeignKey(
        'production_template_pattern_option_task_attachment',
        new TableForeignKey({
          name: 'FK_task_attachment_stored_file',
          columnNames: ['file_id'],
          referencedTableName: 'production_template_stored_file',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
        })
      );
    }

    // 5. Drop unique index on storage_key in production_template_pattern_option_task_attachment if unique
    if (taskAttTable) {
      const uniqueIndices = taskAttTable.indices.filter(
        (i) => i.isUnique && i.columnNames.length === 1 && i.columnNames[0] === 'storage_key'
      );
      for (const idx of uniqueIndices) {
        await queryRunner.dropIndex('production_template_pattern_option_task_attachment', idx);
      }
    }

    // Ensure non-unique index on storage_key in production_template_pattern_option_task_attachment
    const refreshedTaskAtt = await queryRunner.getTable('production_template_pattern_option_task_attachment');
    if (refreshedTaskAtt && !refreshedTaskAtt.indices.some((i) => i.columnNames.includes('storage_key'))) {
      await queryRunner.createIndex(
        'production_template_pattern_option_task_attachment',
        new TableIndex({
          name: 'IDX_production_pattern_task_attachment_storage_key',
          columnNames: ['storage_key'],
        })
      );
    }

    // 6. Data Migration / Backfill:
    // Backfill from production_template_stage_attachment
    await queryRunner.query(`
      INSERT INTO \`production_template_stored_file\`
        (\`id\`, \`template_id\`, \`storage_key\`, \`original_file_name\`, \`mime_type\`, \`size_bytes\`, \`created_by_user_id\`, \`created_at\`)
      SELECT
        (UUID()),
        s.\`template_id\`,
        a.\`storage_key\`,
        a.\`original_file_name\`,
        a.\`mime_type\`,
        a.\`size_bytes\`,
        a.\`created_by_user_id\`,
        a.\`created_at\`
      FROM \`production_template_stage_attachment\` a
      JOIN \`production_template_stage\` s ON s.\`id\` = a.\`stage_id\`
      ON DUPLICATE KEY UPDATE \`production_template_stored_file\`.\`id\` = \`production_template_stored_file\`.\`id\`;
    `);

    await queryRunner.query(`
      UPDATE \`production_template_stage_attachment\` a
      JOIN \`production_template_stored_file\` f ON f.\`storage_key\` = a.\`storage_key\`
      SET a.\`file_id\` = f.\`id\`
      WHERE a.\`file_id\` IS NULL;
    `);

    // Backfill from production_template_pattern_option_task_attachment
    await queryRunner.query(`
      INSERT INTO \`production_template_stored_file\`
        (\`id\`, \`template_id\`, \`storage_key\`, \`original_file_name\`, \`mime_type\`, \`size_bytes\`, \`created_by_user_id\`, \`created_at\`)
      SELECT
        (UUID()),
        p.\`template_id\`,
        a.\`storage_key\`,
        a.\`original_file_name\`,
        a.\`mime_type\`,
        a.\`size_bytes\`,
        a.\`created_by_user_id\`,
        a.\`created_at\`
      FROM \`production_template_pattern_option_task_attachment\` a
      JOIN \`production_template_pattern_option_task\` t ON t.\`id\` = a.\`task_id\`
      JOIN \`production_template_pattern_option\` o ON o.\`id\` = t.\`option_id\`
      JOIN \`production_template_pattern\` p ON p.\`id\` = o.\`pattern_id\`
      ON DUPLICATE KEY UPDATE \`production_template_stored_file\`.\`id\` = \`production_template_stored_file\`.\`id\`;
    `);

    await queryRunner.query(`
      UPDATE \`production_template_pattern_option_task_attachment\` a
      JOIN \`production_template_stored_file\` f ON f.\`storage_key\` = a.\`storage_key\`
      SET a.\`file_id\` = f.\`id\`
      WHERE a.\`file_id\` IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove FK and file_id from task attachment
    const taskAtt = await queryRunner.getTable('production_template_pattern_option_task_attachment');
    if (taskAtt) {
      const fk = taskAtt.foreignKeys.find((k) => k.columnNames.includes('file_id'));
      if (fk) await queryRunner.dropForeignKey('production_template_pattern_option_task_attachment', fk);
      const idx = taskAtt.indices.find((i) => i.columnNames.includes('file_id'));
      if (idx) await queryRunner.dropIndex('production_template_pattern_option_task_attachment', idx);
      if (taskAtt.findColumnByName('file_id')) {
        await queryRunner.dropColumn('production_template_pattern_option_task_attachment', 'file_id');
      }
    }

    // 2. Remove FK and file_id from stage attachment
    const stageAtt = await queryRunner.getTable('production_template_stage_attachment');
    if (stageAtt) {
      const fk = stageAtt.foreignKeys.find((k) => k.columnNames.includes('file_id'));
      if (fk) await queryRunner.dropForeignKey('production_template_stage_attachment', fk);
      const idx = stageAtt.indices.find((i) => i.columnNames.includes('file_id'));
      if (idx) await queryRunner.dropIndex('production_template_stage_attachment', idx);
      if (stageAtt.findColumnByName('file_id')) {
        await queryRunner.dropColumn('production_template_stage_attachment', 'file_id');
      }
    }

    // 3. Drop production_template_stored_file
    await queryRunner.dropTable('production_template_stored_file', true);
  }
}
