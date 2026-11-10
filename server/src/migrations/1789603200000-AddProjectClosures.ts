import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectClosures1789603200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE projects ADD COLUMN closure_state varchar(16) NOT NULL DEFAULT 'none'`);
    await q.query(`CREATE TABLE project_closures (
      id bigserial PRIMARY KEY, project_id bigint NOT NULL, requester_id bigint NOT NULL,
      approver_id bigint NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending',
      delay_reason text NOT NULL DEFAULT '', overdue_reason text NOT NULL DEFAULT '', review_comment text,
      snapshot jsonb NOT NULL, report jsonb, requested_at timestamptz NOT NULL DEFAULT NOW(), reviewed_at timestamptz
    )`);
    await q.query(`CREATE UNIQUE INDEX uq_project_closure_pending ON project_closures(project_id) WHERE status = 'pending'`);
    await q.query(`CREATE INDEX idx_project_closures_project ON project_closures(project_id)`);
    await q.query(`CREATE TABLE closure_notices (
      id bigserial PRIMARY KEY, event_key varchar(160) NOT NULL, project_id bigint NOT NULL,
      recipient_id bigint NOT NULL, kind varchar(32) NOT NULL, payload jsonb NOT NULL,
      acknowledged_at timestamptz, sent_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
      attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_closure_notice_event_recipient UNIQUE(event_key, recipient_id)
    )`);
    await q.query(`CREATE INDEX idx_closure_notices_project ON closure_notices(project_id)`);
    await q.query(`CREATE TABLE project_delay_records (
      id bigserial PRIMARY KEY, event_key varchar(200) NOT NULL UNIQUE, project_id bigint NOT NULL,
      task_id bigint, kind varchar(32) NOT NULL, snapshot jsonb NOT NULL,
      observed_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await q.query(`CREATE INDEX idx_project_delay_project ON project_delay_records(project_id)`);
    await q.query(`CREATE TABLE closure_access_logs (
      id bigserial PRIMARY KEY, closure_id bigint NOT NULL, user_id bigint NOT NULL,
      action varchar(32) NOT NULL, payload jsonb, created_at timestamptz NOT NULL DEFAULT NOW()
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE closure_access_logs`);
    await q.query(`DROP TABLE project_delay_records`);
    await q.query(`DROP TABLE closure_notices`);
    await q.query(`DROP TABLE project_closures`);
    await q.query(`ALTER TABLE projects DROP COLUMN closure_state`);
  }
}
