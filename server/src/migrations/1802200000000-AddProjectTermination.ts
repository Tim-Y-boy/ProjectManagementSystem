import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectTermination1802200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Older deployments may already contain this schema without the migration ledger entry.
    // Complete missing objects without resetting project state or termination history.
    await q.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS termination_state varchar(16) NOT NULL DEFAULT 'none'
      CHECK (termination_state IN ('none','pending','terminated')), ADD COLUMN IF NOT EXISTS terminated_at timestamptz`);
    await q.query(`CREATE TABLE IF NOT EXISTS project_terminations (
      id bigserial PRIMARY KEY, project_id bigint NOT NULL REFERENCES projects(id),
      project_name varchar(128) NOT NULL, requester_id bigint NOT NULL, requester_name varchar(128) NOT NULL,
      reason text NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
      stage varchar(16) NOT NULL CHECK(stage IN ('department','final')),
      department_approver_id bigint NOT NULL, final_approver_id bigint NOT NULL,
      history jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT NOW(), reviewed_at timestamptz
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS project_termination_pending ON project_terminations(project_id) WHERE status='pending'`);
    await q.query(`CREATE INDEX IF NOT EXISTS project_termination_history ON project_terminations(project_id,created_at DESC)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE project_terminations');
    await q.query('ALTER TABLE projects DROP COLUMN termination_state, DROP COLUMN terminated_at');
  }
}
