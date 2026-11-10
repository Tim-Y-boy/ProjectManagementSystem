import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHolidayConfig1788763272547 implements MigrationInterface {
  name = 'CreateHolidayConfig1788763272547';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "holidays" ("id" BIGSERIAL NOT NULL, "date" date NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), CONSTRAINT "UQ_holidays_date" UNIQUE ("date"), CONSTRAINT "PK_holidays" PRIMARY KEY ("id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "holidays"`);
  }
}
