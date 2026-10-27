import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index({ unique: true })
  @Column({ name: 'feishu_dept_id', length: 64 })
  feishuDeptId: string;

  @Column({ length: 128 })
  name: string;

  @Column({ name: 'parent_feishu_id', length: 64, nullable: true })
  parentFeishuId: string | null;

  @Column({
    name: 'head_feishu_user_id',
    length: 64,
    nullable: true,
  })
  headFeishuUserId: string | null;

  @Column({ name: 'head_user_id', type: 'bigint', nullable: true })
  headUserId: number | null;

  // 部门负责人：一个用户可以同时是多个部门的负责人（因此用 ManyToOne，不能 OneToOne）
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'head_user_id' })
  headUser: User | null;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date | null;
}