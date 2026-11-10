import { MigrationInterface, QueryRunner } from 'typeorm';

// Early installations already recorded AddClosureIntelligence before that
// migration included scope_identity. Editing the original cannot upgrade them.
export class AddClosureAnalysisScopeIdentity1801100000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE closure_analysis_jobs ADD COLUMN IF NOT EXISTS scope_identity varchar(64)');
    // Never infer a historical requester's approval context from today's heads.
    // Empty identity makes old results stale under the existing service checks.
    await q.query("UPDATE closure_analysis_jobs SET scope_identity='' WHERE scope_identity IS NULL");
    await q.query(`UPDATE closure_analysis_jobs SET status='failed',
      error='审批身份校验已升级，请重新解析立项书',finished_at=NOW()
      WHERE scope_identity='' AND status IN ('queued','processing')`);
    await q.query('ALTER TABLE closure_analysis_jobs ALTER COLUMN scope_identity SET NOT NULL');
  }

  async down(_q: QueryRunner) {
    // Retain this additive column: the current baseline migration also owns it,
    // and dropping it would break databases created with that baseline.
  }
}
