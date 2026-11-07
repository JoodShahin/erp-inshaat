import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenProductionTemplateFileCleanup1710000000029 implements MigrationInterface {
  name = 'HardenProductionTemplateFileCleanup1710000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_template_file_cleanup_queue');
    if (!tableExists) return;

    // 1. Update ENUM to include 'PROCESSING'
    await queryRunner.query(
      `ALTER TABLE \`production_template_file_cleanup_queue\` 
       MODIFY COLUMN \`status\` ENUM('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED') NOT NULL DEFAULT 'PENDING'`
    );

    // 2. Add claim_id, claimed_at, claim_expires_at columns if not present
    const hasClaimId: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND COLUMN_NAME = 'claim_id'`
    );
    if (hasClaimId.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_file_cleanup_queue\` 
         ADD COLUMN \`claim_id\` VARCHAR(36) NULL AFTER \`attempts\``
      );
    }

    const hasClaimedAt: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND COLUMN_NAME = 'claimed_at'`
    );
    if (hasClaimedAt.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_file_cleanup_queue\` 
         ADD COLUMN \`claimed_at\` DATETIME NULL AFTER \`claim_id\``
      );
    }

    const hasClaimExpiresAt: any[] = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND COLUMN_NAME = 'claim_expires_at'`
    );
    if (hasClaimExpiresAt.length === 0) {
      await queryRunner.query(
        `ALTER TABLE \`production_template_file_cleanup_queue\` 
         ADD COLUMN \`claim_expires_at\` DATETIME NULL AFTER \`claimed_at\``
      );
    }

    // 3. Add indexes for efficient worker claiming and scheduling
    const hasClaimExpiresIdx: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND INDEX_NAME = 'IDX_prod_template_cleanup_claim_expires' LIMIT 1`
    );
    if (hasClaimExpiresIdx.length === 0) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_prod_template_cleanup_claim_expires\` ON \`production_template_file_cleanup_queue\` (\`claim_expires_at\`)`
      );
    }

    const hasSchedulerIdx: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND INDEX_NAME = 'IDX_prod_template_cleanup_scheduler' LIMIT 1`
    );
    if (hasSchedulerIdx.length === 0) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_prod_template_cleanup_scheduler\` ON \`production_template_file_cleanup_queue\` (\`status\`, \`next_retry_at\`, \`claim_expires_at\`)`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('production_template_file_cleanup_queue');
    if (!tableExists) return;

    // Drop indexes
    const hasSchedulerIdx: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND INDEX_NAME = 'IDX_prod_template_cleanup_scheduler' LIMIT 1`
    );
    if (hasSchedulerIdx.length > 0) {
      await queryRunner.query(`DROP INDEX \`IDX_prod_template_cleanup_scheduler\` ON \`production_template_file_cleanup_queue\``);
    }

    const hasClaimExpiresIdx: any[] = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND INDEX_NAME = 'IDX_prod_template_cleanup_claim_expires' LIMIT 1`
    );
    if (hasClaimExpiresIdx.length > 0) {
      await queryRunner.query(`DROP INDEX \`IDX_prod_template_cleanup_claim_expires\` ON \`production_template_file_cleanup_queue\``);
    }

    // Drop columns
    const cols = ['claim_expires_at', 'claimed_at', 'claim_id'];
    for (const col of cols) {
      const hasCol: any[] = await queryRunner.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_template_file_cleanup_queue' AND COLUMN_NAME = ?`,
        [col]
      );
      if (hasCol.length > 0) {
        await queryRunner.query(`ALTER TABLE \`production_template_file_cleanup_queue\` DROP COLUMN \`${col}\``);
      }
    }

    // Revert ENUM
    await queryRunner.query(
      `ALTER TABLE \`production_template_file_cleanup_queue\` 
       MODIFY COLUMN \`status\` ENUM('PENDING', 'FAILED', 'COMPLETED') NOT NULL DEFAULT 'PENDING'`
    );
  }
}
