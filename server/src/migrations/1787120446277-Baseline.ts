import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1787120446277 implements MigrationInterface {
    name = 'Baseline1787120446277'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "categories" ("id" BIGSERIAL NOT NULL, "name" character varying(32) NOT NULL, "emoji" character varying(16) NOT NULL DEFAULT '📁', "color" character varying(16) NOT NULL DEFAULT '#64748b', "sort" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "UQ_8b0be371d28245da6e4f4b61878" UNIQUE ("name"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "users" ("id" BIGSERIAL NOT NULL, "feishu_user_id" character varying(64) NOT NULL, "open_id" character varying(64), "union_id" character varying(64), "name" character varying(64) NOT NULL, "employee_id" character varying(64), "email" character varying(128), "job_title" character varying(128), "avatar_url" character varying(512), "dept_id" bigint, "is_active" boolean NOT NULL DEFAULT true, "synced_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_839828d8776b32be32ea1a8095" ON "users" ("feishu_user_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "departments" ("id" BIGSERIAL NOT NULL, "feishu_dept_id" character varying(64) NOT NULL, "name" character varying(128) NOT NULL, "parent_feishu_id" character varying(64), "head_feishu_user_id" character varying(64), "head_user_id" bigint, "synced_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_b4c044a33c68d3cb2c1e34c230" ON "departments" ("feishu_dept_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "feishu_sync_logs" ("id" BIGSERIAL NOT NULL, "type" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "dept_count" integer NOT NULL DEFAULT '0', "user_count" integer NOT NULL DEFAULT '0', "error" text, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_db13971ca2861a497ac7a9fe83d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "projects" ("id" BIGSERIAL NOT NULL, "name" character varying(128) NOT NULL, "category" character varying(32) NOT NULL DEFAULT '未分类', "dept_id" bigint, "status" character varying(16) NOT NULL DEFAULT 'active', "start_at" date, "end_at" date, "created_by" bigint NOT NULL, "archived_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "description" character varying(255), "owner_id" bigint, "plan_locked" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "project_templates" ("id" BIGSERIAL NOT NULL, "name" character varying(128) NOT NULL, "category" character varying(32) NOT NULL, "description" character varying(255), "skeleton" jsonb NOT NULL, "is_preset" boolean NOT NULL DEFAULT false, "created_by" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_8ad4477f22e9b6e0880f1053449" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "plan_changes" ("id" BIGSERIAL NOT NULL, "project_id" bigint NOT NULL, "reason" text NOT NULL, "requester_id" bigint NOT NULL, "approver_id" bigint, "approver_comment" text, "status" character varying(16) NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "reviewed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_fef9d45e83ae50ee0f4b7cc20ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_787d7a5b151031acb0029d4683" ON "plan_changes" ("project_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "plan_change_items" ("id" BIGSERIAL NOT NULL, "change_id" bigint NOT NULL, "task_id" bigint, "change_type" character varying(20) NOT NULL, "before" jsonb NOT NULL, "after" jsonb NOT NULL, CONSTRAINT "PK_c7ffd895ac82e46fa916f09cb29" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ec53e92b93469bb359349e6dcf" ON "plan_change_items" ("change_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "tasks" ("id" BIGSERIAL NOT NULL, "project_id" bigint NOT NULL, "parent_id" bigint, "title" character varying(128) NOT NULL, "description" text, "creator_id" bigint NOT NULL, "assignee_id" bigint, "acceptor_id" bigint, "status" character varying(20) NOT NULL DEFAULT 'pending_confirm', "start_at" date, "due_at" date, "sort_order" integer NOT NULL DEFAULT '0', "completed_at" TIMESTAMP WITH TIME ZONE, "is_lagging" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_9eecdb5b1ed8c7c2a1b392c28d" ON "tasks" ("project_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_b03c99063a4eaf084f069a4d5a" ON "tasks" ("parent_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "task_assignees" ("id" BIGSERIAL NOT NULL, "task_id" bigint NOT NULL, "role" character varying(16) NOT NULL, "user_id" bigint NOT NULL, CONSTRAINT "PK_e23bc1438f7bb32f41e8d493e78" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_300681c1ca7550cdbbaea6fc04" ON "task_assignees" ("task_id", "role", "user_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "task_assets" ("id" BIGSERIAL NOT NULL, "project_id" bigint NOT NULL, "task_id" bigint, "daily_update_id" bigint, "asset_type" character varying(32) NOT NULL, "title" character varying(200) NOT NULL, "url" text, "file_path" text, "original_name" character varying(255), "mime_type" character varying(120), "file_size" bigint, "description" text, "uploader_id" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_fd7839d73c5df8d8f52c699c472" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_c051150957d8a86fc713116060" ON "task_assets" ("project_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cda232b0d1cf177f0e7c154098" ON "task_assets" ("task_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_09d2b5b2c5794550cfe0e64a07" ON "task_assets" ("daily_update_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_93047c3b16b3d8acb445c7f9a6" ON "task_assets" ("uploader_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "task_daily_updates" ("id" BIGSERIAL NOT NULL, "project_id" bigint NOT NULL, "task_id" bigint NOT NULL, "user_id" bigint NOT NULL, "work_date" date NOT NULL, "content" text NOT NULL, "risk" text, "next_plan" text, "affect_due_date" boolean NOT NULL DEFAULT false, "status" character varying(20) NOT NULL DEFAULT 'normal', "exempt_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1ad7ba442bc08019fdfe0e7d2f8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bba71ec3b0f6b5d26eafe9af87" ON "task_daily_updates" ("project_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_12ac7fb1ce33f0b7e34ef4e737" ON "task_daily_updates" ("task_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_9d1348eb70612f5037e1a7b134" ON "task_daily_updates" ("user_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_722619cbf613f0ac852220ef42" ON "task_daily_updates" ("work_date") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_70d77d73793aab51b139dc4e31" ON "task_daily_updates" ("task_id", "work_date", "user_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "task_logs" ("id" BIGSERIAL NOT NULL, "task_id" bigint NOT NULL, "project_id" bigint, "operator_id" bigint NOT NULL, "action" character varying(32) NOT NULL, "from_status" character varying(20), "to_status" character varying(20), "payload" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "PK_9754457a29b4ffbb772e8a3039c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_fdafd5e130ca3d2a7c12f957c5" ON "task_logs" ("task_id") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_841b3d117bddfc6925efc1c162" ON "task_logs" ("project_id") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user_roles" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "role" character varying(32) NOT NULL, CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_87b8888186ca9769c960e92687" ON "user_roles" ("user_id") `);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_70d668d8fe420a27a64f6a989a5') THEN ALTER TABLE "users" ADD CONSTRAINT "FK_70d668d8fe420a27a64f6a989a5" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION; END IF; END $$;`);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ad56c1268186fb36cb745443f07') THEN ALTER TABLE "departments" ADD CONSTRAINT "FK_ad56c1268186fb36cb745443f07" FOREIGN KEY ("head_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; END IF; END $$;`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "departments" DROP CONSTRAINT "FK_ad56c1268186fb36cb745443f07"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_70d668d8fe420a27a64f6a989a5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87b8888186ca9769c960e92687"`);
        await queryRunner.query(`DROP TABLE "user_roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_841b3d117bddfc6925efc1c162"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fdafd5e130ca3d2a7c12f957c5"`);
        await queryRunner.query(`DROP TABLE "task_logs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_70d77d73793aab51b139dc4e31"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_722619cbf613f0ac852220ef42"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d1348eb70612f5037e1a7b134"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_12ac7fb1ce33f0b7e34ef4e737"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bba71ec3b0f6b5d26eafe9af87"`);
        await queryRunner.query(`DROP TABLE "task_daily_updates"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_93047c3b16b3d8acb445c7f9a6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_09d2b5b2c5794550cfe0e64a07"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cda232b0d1cf177f0e7c154098"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c051150957d8a86fc713116060"`);
        await queryRunner.query(`DROP TABLE "task_assets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_300681c1ca7550cdbbaea6fc04"`);
        await queryRunner.query(`DROP TABLE "task_assignees"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b03c99063a4eaf084f069a4d5a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9eecdb5b1ed8c7c2a1b392c28d"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ec53e92b93469bb359349e6dcf"`);
        await queryRunner.query(`DROP TABLE "plan_change_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_787d7a5b151031acb0029d4683"`);
        await queryRunner.query(`DROP TABLE "plan_changes"`);
        await queryRunner.query(`DROP TABLE "project_templates"`);
        await queryRunner.query(`DROP TABLE "projects"`);
        await queryRunner.query(`DROP TABLE "feishu_sync_logs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b4c044a33c68d3cb2c1e34c230"`);
        await queryRunner.query(`DROP TABLE "departments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_839828d8776b32be32ea1a8095"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "categories"`);
    }

}
