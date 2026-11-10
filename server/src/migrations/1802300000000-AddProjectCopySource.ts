import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectCopySource1802300000000 implements MigrationInterface {
  name = 'AddProjectCopySource1802300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Historical reference intentionally survives deletion of the source project.
    await queryRunner.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_project_id bigint, ADD COLUMN IF NOT EXISTS source_copied_at timestamptz');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE projects DROP COLUMN IF EXISTS source_copied_at, DROP COLUMN IF EXISTS source_project_id');
  }
}
