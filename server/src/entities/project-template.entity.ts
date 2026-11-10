import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// 项目模板："阶段→子任务"任务树，建项目时一键生成骨架
// skeleton 用 jsonb 存结构（无需多张关系表），形如：
// { tasks: [{ title, durationDays?, children?: [{ title, durationDays? }, ...] }] }
@Entity('project_templates')
export class ProjectTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ length: 128 })
  name: string;

  // 分类：研发 | 注册 | gmp | 工程 | 通用
  @Column({ length: 32 })
  category: string;

  @Column({ length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'jsonb' })
  skeleton: Record<string, any>;

  // 历史预置标记；新版本不再自动生成预置模板
  @Column({ name: 'is_preset', type: 'boolean', default: false })
  isPreset: boolean;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: number | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
