import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preserve legacy orders by populating the new required title from the
 * former short description, falling back to the generated order number.
 */
export class AddProductionOrderTitle1710000000030 implements MigrationInterface {
  name = 'AddProductionOrderTitle1710000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `production_order` ADD COLUMN `title` VARCHAR(255) NULL AFTER `order_number`'
    );
    await queryRunner.query(
      "UPDATE `production_order` SET `title` = LEFT(COALESCE(NULLIF(TRIM(`description`), ''), `order_number`), 255) WHERE `title` IS NULL"
    );
    await queryRunner.query(
      'ALTER TABLE `production_order` MODIFY COLUMN `title` VARCHAR(255) NOT NULL'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `production_order` DROP COLUMN `title`');
  }
}
