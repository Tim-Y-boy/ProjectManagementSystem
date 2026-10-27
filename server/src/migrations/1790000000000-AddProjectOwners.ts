import { MigrationInterface, QueryRunner } from 'typeorm';

// 项目负责人单选→多选：新建 project_owners 关联表 + 存量 owner_id 回填。
// projects.owner_id 保留为「主负责人」，运行时由 service 写时同步成关联表首项。
export class AddProjectOwners1790000000000 implements MigrationInterface {
  name = 'AddProjectOwners1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_owners" ("id" BIGSERIAL NOT NULL, "project_id" bigint NOT NULL, "user_id" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_project_owners" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_project_owners_proj_user" ON "project_owners" ("project_id", "user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_project_owners_user" ON "project_owners" ("user_id")`,
    );
    // 存量回填：owner_id → 关联表（首行即主负责人）
    await queryRunner.query(
      `INSERT INTO "project_owners" ("project_id", "user_id") SELECT "id", "owner_id" FROM "projects" WHERE "owner_id" IS NOT NULL ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_project_owners_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_project_owners_proj_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_owners"`);
  }
}
