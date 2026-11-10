import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProgressNoMaterialReason1800300000000 implements MigrationInterface {
  name = 'AddProgressNoMaterialReason1800300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_daily_updates ADD COLUMN IF NOT EXISTS no_material_reason text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_daily_updates DROP COLUMN IF EXISTS no_material_reason`);
  }
}
