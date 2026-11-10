import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReadOnlyVisitors1801400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN read_only boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE users SET read_only=true WHERE id IN (SELECT user_id FROM user_roles WHERE role='viewer')`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN read_only`);
  }
}
