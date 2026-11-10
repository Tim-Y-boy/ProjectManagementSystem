import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClosureApplicationFiles1800500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE closure_application_files (
      id bigserial PRIMARY KEY, project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      uploaded_by bigint NOT NULL REFERENCES users(id), original_name varchar(255) NOT NULL,
      file_path text NOT NULL, file_size bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await q.query(`CREATE INDEX idx_closure_application_files_project ON closure_application_files(project_id)`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE closure_application_files'); }
}
