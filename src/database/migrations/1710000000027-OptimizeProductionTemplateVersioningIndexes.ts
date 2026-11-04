import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeProductionTemplateVersioningIndexes1710000000027 implements MigrationInterface {
  name = 'OptimizeProductionTemplateVersioningIndexes1710000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add request_hash and user_id columns to production_template_editing_idempotency if not existing
    const hasRequestHash: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND COLUMN_NAME = 'request_hash'`
    );
    if (hasRequestHash.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` 
         ADD COLUMN \`request_hash\` VARCHAR(64) NULL AFTER \`idempotency_key\``
      );
    }

    const hasUserId: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND COLUMN_NAME = 'user_id'`
    );
    if (hasUserId.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` 
         ADD COLUMN \`user_id\` VARCHAR(36) NULL AFTER \`request_hash\``
      );
    }

    // Add foreign key for idempotency user_id
    const hasUserFk: any[] = await queryRunner.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND CONSTRAINT_NAME = 'FK_template_editing_idempotency_user'`
    );
    if (hasUserFk.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` 
         ADD CONSTRAINT \`FK_template_editing_idempotency_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`system_user\` (\`id\`) ON DELETE SET NULL`
      );
    }

    // 2. Composite indexes for high-frequency queries
    await this.createIndexIfNotExists(queryRunner, 'production_template', 'IDX_prod_template_deleted_active', [
      'deleted_at',
      'is_active',
    ]);

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_version',
      'IDX_prod_template_ver_template_deleted',
      ['template_id', 'deleted_at']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_stage',
      'IDX_prod_template_stage_ver_deleted',
      ['version_id', 'deleted_at']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_pattern',
      'IDX_prod_template_pattern_ver_deleted',
      ['version_id', 'deleted_at']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_workflow_item',
      'IDX_prod_template_wf_ver_deleted_sort',
      ['version_id', 'deleted_at', 'sort_order']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_pattern_option',
      'IDX_prod_template_opt_pattern_deleted_sort',
      ['pattern_id', 'deleted_at', 'sort_order']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_pattern_option_task',
      'IDX_prod_template_task_opt_deleted_sort',
      ['option_id', 'deleted_at', 'sort_order']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_stage_attachment',
      'IDX_prod_stage_att_stage_deleted_sort',
      ['stage_id', 'deleted_at', 'sort_order']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_pattern_option_task_attachment',
      'IDX_prod_task_att_task_deleted_sort',
      ['task_id', 'deleted_at', 'sort_order']
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'production_template_upload_token',
      'IDX_prod_upload_token_template_used_expires',
      ['template_id', 'is_used', 'expires_at']
    );

    await this.createIndexIfNotExists(queryRunner, 'production_template_upload_token', 'IDX_prod_upload_token_cleanup', [
      'expires_at',
      'is_used',
    ]);

    await this.createIndexIfNotExists(
      queryRunner,
      'production_order_line',
      'IDX_prod_order_line_template_ver_deleted',
      ['template_id', 'template_version_id', 'deleted_at']
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfExists(queryRunner, 'production_order_line', 'IDX_prod_order_line_template_ver_deleted');
    await this.dropIndexIfExists(queryRunner, 'production_template_upload_token', 'IDX_prod_upload_token_cleanup');
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_upload_token',
      'IDX_prod_upload_token_template_used_expires'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_pattern_option_task_attachment',
      'IDX_prod_task_att_task_deleted_sort'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_stage_attachment',
      'IDX_prod_stage_att_stage_deleted_sort'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_pattern_option_task',
      'IDX_prod_template_task_opt_deleted_sort'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_pattern_option',
      'IDX_prod_template_opt_pattern_deleted_sort'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_workflow_item',
      'IDX_prod_template_wf_ver_deleted_sort'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_pattern',
      'IDX_prod_template_pattern_ver_deleted'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_stage',
      'IDX_prod_template_stage_ver_deleted'
    );
    await this.dropIndexIfExists(
      queryRunner,
      'production_template_version',
      'IDX_prod_template_ver_template_deleted'
    );
    await this.dropIndexIfExists(queryRunner, 'production_template', 'IDX_prod_template_deleted_active');

    const hasUserFk: any[] = await queryRunner.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND CONSTRAINT_NAME = 'FK_template_editing_idempotency_user'`
    );
    if (hasUserFk.length > 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` DROP FOREIGN KEY \`FK_template_editing_idempotency_user\``
      );
    }

    const hasUserId: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND COLUMN_NAME = 'user_id'`
    );
    if (hasUserId.length > 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` DROP COLUMN \`user_id\``
      );
    }

    const hasRequestHash: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_editing_idempotency' AND COLUMN_NAME = 'request_hash'`
    );
    if (hasRequestHash.length > 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_editing_idempotency\` DROP COLUMN \`request_hash\``
      );
    }
  }

  private async createIndexIfNotExists(
    queryRunner: QueryRunner,
    table: string,
    indexName: string,
    columns: string[]
  ): Promise<void> {
    const existingByName: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [table, indexName]
    );
    if (existingByName.length > 0) {
      return;
    }

    // Fetch existing indexes on this table to prevent functionally redundant indexes
    const existingStats: any[] = await queryRunner.query(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
       FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? 
       ORDER BY INDEX_NAME, SEQ_IN_INDEX ASC`,
      [table]
    );

    const indexColsMap: Record<string, string[]> = {};
    for (const row of existingStats) {
      if (!indexColsMap[row.INDEX_NAME]) {
        indexColsMap[row.INDEX_NAME] = [];
      }
      indexColsMap[row.INDEX_NAME].push(row.COLUMN_NAME);
    }

    // Check if any existing index already covers `columns` via exact match or leftmost prefix
    for (const [, cols] of Object.entries(indexColsMap)) {
      if (cols.length >= columns.length) {
        const isPrefixCovered = columns.every((col, i) => col.toLowerCase() === cols[i].toLowerCase());
        if (isPrefixCovered) {
          return;
        }
      }
    }

    const colList = columns.map((c) => `\`${c}\``).join(', ');
    await queryRunner.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${colList});`);
  }

  private async dropIndexIfExists(
    queryRunner: QueryRunner,
    table: string,
    indexName: string
  ): Promise<void> {
    const existing: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [table, indexName]
    );
    if (existing.length > 0) {
      await queryRunner.query(`DROP INDEX \`${indexName}\` ON \`${table}\`;`);
    }
  }
}
