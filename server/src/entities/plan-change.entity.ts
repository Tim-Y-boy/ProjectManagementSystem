import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 计划变更申请单：项目计划定稿后，改动日期/范围等需发起申请，经项目负责人审核通过才生效
@Entity('plan_changes')
export class PlanChange {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'requester_id', type: 'bigint' })
  requesterId: number;

  @Column({ name: 'approver_id', type: 'bigint', nullable: true })
  approverId: number | null;

  @Column({ name: 'approver_comment', type: 'text', nullable: true })
  approverComment: string | null;

  @Column({ length: 16, default: 'pending' })
  status: string; // pending | approved | rejected | cancelled

  // ---- 两级审批链（总经办终审）----
  // 当前等待审批的阶段：owner=待项目负责人 | final=待总经办负责人/终审
  @Column({ length: 12, default: 'final' })
  stage: string;

  // 终审人（总经办负责人，找不到时兜底 admin/leader），提交时解析并固定
  @Column({ name: 'final_approver_id', type: 'bigint', nullable: true })
  finalApproverId: number | null;

  // 项目负责人这一级（仅"执行人发起且需经负责人"时才走）：通过后记录，供发起人查看
  @Column({ name: 'owner_approver_id', type: 'bigint', nullable: true })
  ownerApproverId: number | null;

  @Column({ name: 'owner_approved_at', type: 'timestamptz', nullable: true })
  ownerApprovedAt: Date | null;

  @Column({ name: 'owner_comment', type: 'text', nullable: true })
  ownerComment: string | null;

  // 若被退回，记录退回发生在哪一级（owner|final），便于前端展示审批轨迹
  @Column({ name: 'rejected_stage', length: 12, nullable: true })
  rejectedStage: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;
}
