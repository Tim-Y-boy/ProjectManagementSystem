import { MigrationInterface, QueryRunner } from "typeorm";

// 计划变更改为两级审批链（执行人发起 → 项目负责人 → 总经办负责人终审；负责人/管理角色发起 → 总经办）
// 旧数据 stage 默认 'final'、final_approver_id 为空 → 仍走"存量照旧"单级逻辑。
export class PlanChangeApprovalStages1788400000000 implements MigrationInterface {
    name = 'PlanChangeApprovalStages1788400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "stage" character varying(12) NOT NULL DEFAULT 'final'`);
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "final_approver_id" bigint`);
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "owner_approver_id" bigint`);
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "owner_approved_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "owner_comment" text`);
        await queryRunner.query(`ALTER TABLE "plan_changes" ADD "rejected_stage" character varying(12)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "rejected_stage"`);
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "owner_comment"`);
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "owner_approved_at"`);
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "owner_approver_id"`);
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "final_approver_id"`);
        await queryRunner.query(`ALTER TABLE "plan_changes" DROP COLUMN "stage"`);
    }
}
