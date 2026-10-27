import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('projects')
export class Project {
  @Column({ name: 'closure_state', length: 16, default: 'none' })
  closureState: string; // none | pending | closed; 历史归档保持 none
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ length: 128 })
  name: string;

  @Column({ length: 32, default: '未分类' })
  category: string;

  @Column({ name: 'dept_id', type: 'bigint', nullable: true })
  deptId: number | null;

  @Column({ length: 16, default: 'active' })
  status: string; // active | archived

  @Column({ name: 'start_at', type: 'date', nullable: true })
  startAt: string | null;

  @Column({ name: 'end_at', type: 'date', nullable: true })
  endAt: string | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ length: 255, nullable: true })
  description: string | null;

  // 项目负责人（审核计划变更申请；可发起计划定稿）
  @Column({ name: 'owner_id', type: 'bigint', nullable: true })
  ownerId: number | null;

  // 计划是否已定稿：定稿后改日期/范围等关键字段需走变更申请
  @Column({ name: 'plan_locked', type: 'boolean', default: false })
  planLocked: boolean;
}
