import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectCategory1787184000000 implements MigrationInterface {
  name = 'AddProjectCategory1787184000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "categories" ("name", "emoji", "color", "sort")
      VALUES
        ('未分类', '📁', '#94a3b8', 0)
      ON CONFLICT ("name") DO NOTHING
    `);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "category" character varying(32) NOT NULL DEFAULT '未分类'`);
    await queryRunner.query(`UPDATE "projects" SET "category" = '未分类' WHERE "category" IS NULL OR trim("category") = ''`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "category"`);
  }
}
