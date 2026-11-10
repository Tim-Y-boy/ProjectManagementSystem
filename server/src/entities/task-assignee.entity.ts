import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_assignees')
@Index(['taskId', 'role', 'userId'], { unique: true })
export class TaskAssignee {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'task_id', type: 'bigint' })
  taskId: number;

  // assignee=负责人 | acceptor=验收人
  @Column({ length: 16 })
  role: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;
}
