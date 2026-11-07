import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductionTemplateEditingIdempotencyAndTokens1710000000026 implements MigrationInterface {
  name = 'CreateProductionTemplateEditingIdempotencyAndTokens1710000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create production_template_editing_idempotency
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`production_template_editing_idempotency\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`template_id\` VARCHAR(36) NOT NULL,
        \`idempotency_key\` VARCHAR(128) NOT NULL,
        \`response_json\` LONGTEXT NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_template_editing_idempotency\` (\`template_id\`, \`idempotency_key\`),
        KEY \`IDX_template_editing_idempotency_template\` (\`template_id\`),
        CONSTRAINT \`FK_editing_idempotency_template\` FOREIGN KEY (\`template_id\`)
          REFERENCES \`production_template\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Create production_template_upload_token
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`production_template_upload_token\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`template_id\` VARCHAR(36) NOT NULL,
        \`user_id\` VARCHAR(36) NOT NULL,
        \`storage_key\` VARCHAR(500) NOT NULL,
        \`original_file_name\` VARCHAR(255) NOT NULL,
        \`mime_type\` VARCHAR(100) NOT NULL,
        \`size_bytes\` BIGINT NOT NULL,
        \`expires_at\` DATETIME(6) NOT NULL,
        \`is_used\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_template_upload_token_template\` (\`template_id\`),
        KEY \`IDX_template_upload_token_user\` (\`user_id\`),
        KEY \`IDX_template_upload_token_expires\` (\`expires_at\`),
        CONSTRAINT \`FK_upload_token_template\` FOREIGN KEY (\`template_id\`)
          REFERENCES \`production_template\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_upload_token_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`system_user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`production_template_upload_token\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`production_template_editing_idempotency\`;`);
  }
}
