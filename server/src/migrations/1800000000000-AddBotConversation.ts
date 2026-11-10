import { MigrationInterface, QueryRunner } from 'typeorm';

// 智能体多轮对话上下文：bot_conversation 存最近 N 轮「用户问/助手答」文本对（docs/16 P2）
export class AddBotConversation1800000000000 implements MigrationInterface {
  name = 'AddBotConversation1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bot_conversation" ("id" BIGSERIAL NOT NULL, "feishu_open_id" character varying(64) NOT NULL, "chat_type" character varying(16) NOT NULL, "user_text" text NOT NULL, "assistant_text" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_bot_conversation" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bot_conversation_open" ON "bot_conversation" ("feishu_open_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bot_conversation_open"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bot_conversation"`);
  }
}
