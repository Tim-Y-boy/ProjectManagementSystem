import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSharedProgressAssets1800400000000 implements MigrationInterface {
  name = 'AddSharedProgressAssets1800400000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "task_assets" ADD COLUMN "linked_daily_update_ids" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "task_assets" DROP COLUMN "linked_daily_update_ids"`);
  }
}
