import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBotQueryLogs1788246000000 implements MigrationInterface {
  name = 'AddBotQueryLogs1788246000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bot_query_logs" ("id" BIGSERIAL NOT NULL, "feishu_open_id" character varying(64) NOT NULL, "user_id" bigint, "chat_type" character varying(16) NOT NULL, "intent" character varying(32) NOT NULL DEFAULT 'unknown', "raw_text" text NOT NULL, "reply_summary" text, "success" boolean NOT NULL DEFAULT true, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_bot_query_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bot_query_logs_feishu_open_id" ON "bot_query_logs" ("feishu_open_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bot_query_logs_user_id" ON "bot_query_logs" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bot_query_logs_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bot_query_logs_feishu_open_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bot_query_logs"`);
  }
}
