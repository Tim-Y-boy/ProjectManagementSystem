import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureFallbackCategory1787363200000 implements MigrationInterface {
  name = 'EnsureFallbackCategory1787363200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "categories" ("name", "emoji", "color", "sort")
      VALUES ('未分类', '📁', '#94a3b8', 0)
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(): Promise<void> {
    // 兜底分类不在回滚时删除，避免已有项目/模板失去分类归属。
  }
}
