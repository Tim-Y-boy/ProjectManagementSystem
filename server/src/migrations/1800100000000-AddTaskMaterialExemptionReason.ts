import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskMaterialExemptionReason1800100000000 implements MigrationInterface {
  name = 'AddTaskMaterialExemptionReason1800100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "material_exemption_reason" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "material_exemption_reason"`);
  }
}
