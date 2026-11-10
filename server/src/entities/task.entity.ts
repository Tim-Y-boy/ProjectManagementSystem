import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  // 父任务 ID（支持父子任务树，项目→子任务→孙任务不限层；null=顶层任务）
  @Index()
  @Column({ name: 'parent_id', type: 'bigint', nullable: true })
  parentId: number | null;

  @Column({ length: 128 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'creator_id', type: 'bigint' })
  creatorId: number;

  @Column({ name: 'assignee_id', type: 'bigint', nullable: true })
  assigneeId: number | null;

  @Column({ name: 'acceptor_id', type: 'bigint', nullable: true })
  acceptorId: number | null;

  @Column({ length: 20, default: 'pending_confirm' })
  status: string; // pending_confirm | todo | doing | pending_accept | done | cancelled | rejected

  @Column({ name: 'start_at', type: 'date', nullable: true })
  startAt: string | null;

  @Column({ name: 'due_at', type: 'date', nullable: true })
  dueAt: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'material_exemption_reason', type: 'text', nullable: true })
  materialExemptionReason: string | null;

  @Column({ name: 'is_lagging', type: 'boolean', default: false })
  isLagging: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
