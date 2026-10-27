import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 项目多负责人关联表（docs：项目负责人单选→多选）。
// 复刻 task_assignees 范式：无 Relation，关联由 service 手工查。
// projects.owner_id 保留为「主负责人」，写时同步成关联表首项（id ASC 顺序），兼容存量/单值展示。
@Entity('project_owners')
@Index(['projectId', 'userId'], { unique: true })
export class ProjectOwner {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
