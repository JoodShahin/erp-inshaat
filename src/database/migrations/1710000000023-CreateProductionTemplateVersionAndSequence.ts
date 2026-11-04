import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

export class CreateProductionTemplateVersionAndSequence1710000000023 implements MigrationInterface {
  name = 'CreateProductionTemplateVersionAndSequence1710000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create production_template_sequence table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`production_template_sequence\` (
        \`id\` VARCHAR(50) NOT NULL,
        \`current_value\` BIGINT NOT NULL DEFAULT 0,
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // Determine initial sequence value from any existing PT-XXXXXX codes
    const existingTemplates: Array<{ code: string }> = await queryRunner.query(
      `SELECT \`code\` FROM \`production_template\` WHERE \`code\` LIKE 'PT-%'`
    );
    let maxNum = 0;
    for (const t of existingTemplates) {
      const match = t.code.match(/^PT-(\d+)$/i);
      if (match) {
        const val = parseInt(match[1], 10);
        if (!isNaN(val) && val > maxNum) {
          maxNum = val;
        }
      }
    }

    await queryRunner.query(`
      INSERT INTO \`production_template_sequence\` (\`id\`, \`current_value\`)
      VALUES ('PRODUCTION_TEMPLATE', ?)
      ON DUPLICATE KEY UPDATE \`current_value\` = GREATEST(\`current_value\`, VALUES(\`current_value\`));
    `, [maxNum]);

    // 2. Create production_template_version table matching production_template charset & collation
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`production_template_version\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`template_id\` VARCHAR(36) NOT NULL,
        \`version\` VARCHAR(20) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` DATETIME(6) NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_production_template_version_template_version\` (\`template_id\`, \`version\`),
        KEY \`IDX_production_template_version_template_id\` (\`template_id\`),
        KEY \`IDX_production_template_version_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`FK_prod_template_version_template\` FOREIGN KEY (\`template_id\`)
          REFERENCES \`production_template\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 3. Add version_id column to stage, pattern, and workflow_item
    await queryRunner.query(`
      ALTER TABLE \`production_template_stage\`
      ADD COLUMN \`version_id\` VARCHAR(36) NULL AFTER \`template_id\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`production_template_pattern\`
      ADD COLUMN \`version_id\` VARCHAR(36) NULL AFTER \`template_id\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`production_template_workflow_item\`
      ADD COLUMN \`version_id\` VARCHAR(36) NULL AFTER \`template_id\`;
    `);

    // 4. Migrate existing templates: create 1.0 version for each existing template and link items
    const allTemplates: Array<{ id: string; created_at: Date }> = await queryRunner.query(
      `SELECT \`id\`, \`created_at\` FROM \`production_template\``
    );

    for (const tmpl of allTemplates) {
      const versionId = randomUUID();
      const createdAt = tmpl.created_at ? new Date(tmpl.created_at) : new Date();

      await queryRunner.query(
        `INSERT INTO \`production_template_version\` (\`id\`, \`template_id\`, \`version\`, \`created_at\`, \`updated_at\`)
         VALUES (?, ?, '1.0', ?, ?)`,
        [versionId, tmpl.id, createdAt, createdAt]
      );

      await queryRunner.query(
        `UPDATE \`production_template_stage\` SET \`version_id\` = ? WHERE \`template_id\` = ?`,
        [versionId, tmpl.id]
      );

      await queryRunner.query(
        `UPDATE \`production_template_pattern\` SET \`version_id\` = ? WHERE \`template_id\` = ?`,
        [versionId, tmpl.id]
      );

      await queryRunner.query(
        `UPDATE \`production_template_workflow_item\` SET \`version_id\` = ? WHERE \`template_id\` = ?`,
        [versionId, tmpl.id]
      );
    }

    // 5. Add foreign key constraints & indexes for version_id
    await queryRunner.query(`
      ALTER TABLE \`production_template_stage\`
      ADD KEY \`IDX_production_template_stage_version_id\` (\`version_id\`),
      ADD CONSTRAINT \`FK_prod_template_stage_version\` FOREIGN KEY (\`version_id\`)
        REFERENCES \`production_template_version\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE \`production_template_pattern\`
      ADD KEY \`IDX_production_template_pattern_version_id\` (\`version_id\`),
      ADD CONSTRAINT \`FK_prod_template_pattern_version\` FOREIGN KEY (\`version_id\`)
        REFERENCES \`production_template_version\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE \`production_template_workflow_item\`
      ADD KEY \`IDX_production_template_workflow_item_version_id\` (\`version_id\`),
      ADD CONSTRAINT \`FK_prod_template_workflow_version\` FOREIGN KEY (\`version_id\`)
        REFERENCES \`production_template_version\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys and columns on dependent tables
    await queryRunner.query(`ALTER TABLE \`production_template_workflow_item\` DROP FOREIGN KEY \`FK_prod_template_workflow_version\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_workflow_item\` DROP INDEX \`IDX_production_template_workflow_item_version_id\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_workflow_item\` DROP COLUMN \`version_id\`;`);

    await queryRunner.query(`ALTER TABLE \`production_template_pattern\` DROP FOREIGN KEY \`FK_prod_template_pattern_version\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_pattern\` DROP INDEX \`IDX_production_template_pattern_version_id\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_pattern\` DROP COLUMN \`version_id\`;`);

    await queryRunner.query(`ALTER TABLE \`production_template_stage\` DROP FOREIGN KEY \`FK_prod_template_stage_version\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_stage\` DROP INDEX \`IDX_production_template_stage_version_id\`;`);
    await queryRunner.query(`ALTER TABLE \`production_template_stage\` DROP COLUMN \`version_id\`;`);

    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS \`production_template_version\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`production_template_sequence\`;`);
  }
}
