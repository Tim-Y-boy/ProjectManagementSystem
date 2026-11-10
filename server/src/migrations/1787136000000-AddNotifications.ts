import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifications1787136000000 implements MigrationInterface {
  name = 'AddNotifications1787136000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "notifications" ("id" BIGSERIAL NOT NULL, "type" character varying(32) NOT NULL, "recipient_id" bigint, "target" character varying(128), "content" text NOT NULL, "response" jsonb, "success" boolean NOT NULL DEFAULT false, "retry_count" integer NOT NULL DEFAULT '0', "project_id" bigint, "task_id" bigint, "plan_change_id" bigint, "sent_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_type" ON "notifications" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_id" ON "notifications" ("recipient_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_project_id" ON "notifications" ("project_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_task_id" ON "notifications" ("task_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_plan_change_id" ON "notifications" ("plan_change_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_plan_change_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_task_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_project_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_recipient_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
