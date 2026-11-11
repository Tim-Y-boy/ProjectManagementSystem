import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskAssetVersions1803200000000 implements MigrationInterface {
  name = 'TaskAssetVersions1803200000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE task_asset_versions (
      id BIGSERIAL PRIMARY KEY, asset_id BIGINT NOT NULL REFERENCES task_assets(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL CHECK(version_no > 0), title VARCHAR(200) NOT NULL,
      original_name VARCHAR(255), file_path TEXT NOT NULL, mime_type VARCHAR(120), file_size BIGINT,
      uploader_id BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reason TEXT,
      UNIQUE(asset_id, version_no), UNIQUE(asset_id,id))`);
    await q.query(`ALTER TABLE task_assets ADD COLUMN current_version_id BIGINT`);
    await q.query(`INSERT INTO task_asset_versions(asset_id,version_no,title,original_name,file_path,mime_type,file_size,uploader_id,created_at)
      SELECT id,1,title,original_name,file_path,mime_type,file_size,uploader_id,created_at FROM task_assets WHERE file_path IS NOT NULL`);
    await q.query(`UPDATE task_assets a SET current_version_id=v.id FROM task_asset_versions v WHERE v.asset_id=a.id`);
    await q.query(`ALTER TABLE task_assets ADD CONSTRAINT task_assets_current_version_fk FOREIGN KEY(id,current_version_id)
      REFERENCES task_asset_versions(asset_id,id) DEFERRABLE INITIALLY DEFERRED`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE task_assets DROP CONSTRAINT task_assets_current_version_fk`);
    await q.query(`ALTER TABLE task_assets DROP COLUMN current_version_id`);
    await q.query(`DROP TABLE task_asset_versions`);
  }
}
