import { MigrationInterface, QueryRunner } from 'typeorm';
import { initialReviewRules } from '../modules/closures/closure-department-rules';

export class AddClosureIntelligence1800600000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE closure_rule_config (id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL,rules jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW())`);
    const departments=await q.query('SELECT id,name FROM departments');
    const rules=initialReviewRules().map(r=>{const matches=departments.filter(d=>d.name.replace(/\s/g,'')===r.departmentName.replace(/\s/g,''));return {...r,departmentId:matches.length===1?Number(matches[0].id):null};});
    await q.query('INSERT INTO closure_rule_config(id,version,rules) VALUES(1,1,$1)',[JSON.stringify(rules)]);
    await q.query(`CREATE TABLE closure_rule_history (version integer PRIMARY KEY,rules jsonb NOT NULL,actor_id bigint REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT NOW())`);
    await q.query('INSERT INTO closure_rule_history(version,rules) VALUES(1,$1)',[JSON.stringify(rules)]);
    await q.query(`CREATE TABLE closure_analysis_jobs (
      id bigserial PRIMARY KEY,project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,requested_by bigint NOT NULL REFERENCES users(id),
      file_ids jsonb NOT NULL,config_version integer NOT NULL,project_dept_id bigint NOT NULL,rules jsonb NOT NULL,scope_identity varchar(64) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'queued',result jsonb,error text,fingerprint varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),started_at timestamptz,finished_at timestamptz
    )`);
    await q.query(`CREATE INDEX closure_analysis_queue ON closure_analysis_jobs(status,created_at)`);
    await q.query(`CREATE UNIQUE INDEX closure_analysis_active ON closure_analysis_jobs(project_id,fingerprint) WHERE status IN ('queued','processing')`);
    await q.query(`CREATE TABLE closure_application_drafts(project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id bigint NOT NULL REFERENCES users(id),version integer NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(project_id,user_id))`);
  }
  async down(q: QueryRunner) { await q.query('DROP TABLE closure_application_drafts,closure_analysis_jobs,closure_rule_history,closure_rule_config'); }
}
