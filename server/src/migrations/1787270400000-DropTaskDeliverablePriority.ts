import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropTaskDeliverablePriority1787270400000 implements MigrationInterface {
  name = 'DropTaskDeliverablePriority1787270400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "deliverable"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "priority"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "priority" character varying(10) NOT NULL DEFAULT 'medium'`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deliverable" text`);
  }
}
