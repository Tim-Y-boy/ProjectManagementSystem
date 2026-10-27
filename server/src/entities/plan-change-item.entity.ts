import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 计划变更项：一次申请可包含多个任务的变更（批量），每项记录 before/after 原值与新值
@Entity('plan_change_items')
export class PlanChangeItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'change_id', type: 'bigint' })
  changeId: number;

  // 目标任务 id；add 类型时可为 null（=顶层新任务），否则指向父阶段 id
  @Column({ name: 'task_id', type: 'bigint', nullable: true })
  taskId: number | null;

  @Column({ name: 'change_type', length: 20 })
  changeType: string; // date | delete | add | assignee | acceptor | reorder

  @Column({ type: 'jsonb' })
  before: Record<string, any>;

  @Column({ type: 'jsonb' })
  after: Record<string, any>;
}
