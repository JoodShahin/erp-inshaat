import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeProductionUnitOrderNullable1710000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_id` VARCHAR(36) NULL'
    );
    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_line_id` VARCHAR(36) NULL'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const nullRows: Array<{ count: number | string }> = await queryRunner.query(
      'SELECT COUNT(*) as count FROM `production_unit` WHERE `order_id` IS NULL OR `order_line_id` IS NULL'
    );
    const nullCount = Number(nullRows[0]?.count || 0);
    if (nullCount > 0) {
      throw new Error(
        `Cannot revert migration MakeProductionUnitOrderNullable1710000000022: Table 'production_unit' contains ${nullCount} row(s) with NULL order_id or order_line_id. Reverting to NOT NULL would cause data loss or corruption.`
      );
    }

    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_line_id` VARCHAR(36) NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_id` VARCHAR(36) NOT NULL'
    );
  }
}
