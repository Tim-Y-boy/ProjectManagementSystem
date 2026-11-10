import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('project_closures')
@Index('uq_project_closure_pending', ['projectId'], { unique: true, where: "status = 'pending'" })
export class ProjectClosure {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;
  @Index() @Column({ name: 'project_id', type: 'bigint' }) projectId: number;
  @Column({ name: 'requester_id', type: 'bigint' }) requesterId: number;
  @Column({ name: 'approver_id', type: 'bigint' }) approverId: number;
  @Column({ length: 16, default: 'pending' }) status: string;
  @Column({ name: 'delay_reason', type: 'text', default: '' }) delayReason: string;
  @Column({ name: 'overdue_reason', type: 'text', default: '' }) overdueReason: string;
  @Column({ name: 'review_comment', type: 'text', nullable: true }) reviewComment: string | null;
  @Column({ type: 'jsonb' }) snapshot: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true }) report: Record<string, any> | null;
  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'NOW()' }) requestedAt: Date;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
}
