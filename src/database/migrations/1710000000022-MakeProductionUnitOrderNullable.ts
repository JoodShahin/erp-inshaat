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
    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_line_id` VARCHAR(36) NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE `production_unit` MODIFY COLUMN `order_id` VARCHAR(36) NOT NULL'
    );
  }
}
