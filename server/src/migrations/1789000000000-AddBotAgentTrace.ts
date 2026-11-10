import { MigrationInterface, QueryRunner } from 'typeorm';

// 智能体查询日志：bot_query_logs 加 agent_trace(jsonb) 列，记录工具调用序列（docs/16 §8）
export class AddBotAgentTrace1789000000000 implements MigrationInterface {
  name = 'AddBotAgentTrace1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bot_query_logs" ADD COLUMN IF NOT EXISTS "agent_trace" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bot_query_logs" DROP COLUMN IF NOT EXISTS "agent_trace"`,
    );
  }
}
