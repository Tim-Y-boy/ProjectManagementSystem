import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteClosureWorkflow1789689600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE project_plan_baselines(project_id bigint PRIMARY KEY, snapshot jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT NOW())`);
    // Existing projects may have been unlocked manually: never invent their first plan.
    await q.query(`INSERT INTO project_plan_baselines(project_id,snapshot) SELECT id,'{"historicalUnknown":true}'::jsonb FROM projects`);
    await q.query(`CREATE TABLE closure_reopens(id bigserial PRIMARY KEY, closure_id bigint NOT NULL, project_id bigint NOT NULL,
      requester_id bigint NOT NULL, approver_id bigint NOT NULL, reason text NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending',
      comment text, created_at timestamptz NOT NULL DEFAULT NOW(), reviewed_at timestamptz)`);
    await q.query(`CREATE UNIQUE INDEX uq_closure_reopen_pending ON closure_reopens(project_id) WHERE status='pending'`);
    await q.query(`CREATE TABLE closure_hr_grants(id bigserial PRIMARY KEY,user_id bigint NOT NULL,dept_id bigint,
      granted_by bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),revoked_at timestamptz)`);
    await q.query(`CREATE UNIQUE INDEX uq_closure_hr_grant ON closure_hr_grants(user_id,COALESCE(dept_id,0)) WHERE revoked_at IS NULL`);
    await q.query(`CREATE TABLE closure_followups(id bigserial PRIMARY KEY,project_id bigint NOT NULL,kind varchar(24) NOT NULL,
      target_id bigint NOT NULL,status varchar(16) NOT NULL,comment text NOT NULL,user_id bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW())`);
    await q.query(`CREATE INDEX idx_closure_followups_target ON closure_followups(kind,target_id,id DESC)`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['closure_followups','closure_hr_grants','closure_reopens','project_plan_baselines']) await q.query(`DROP TABLE ${table}`);
  }
}
