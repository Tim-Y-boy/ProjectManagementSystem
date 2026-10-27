import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 节假日/调休配置表：仅存与"自然周六日"不一致的覆盖日。
// 自然周默认周一~五上班、周六日休息；kind 用于翻转覆盖：
//   holiday = 该日本为工作日（法定节假日落在工作日）→ 标记为休息
//   makeup  = 该日本为休息日（调休补班落在周六日）→ 标记为上班
@Entity('holidays')
export class Holiday {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // 某一天（YYYY-MM-DD），同一天只允许一条覆盖配置
  @Index({ unique: true })
  @Column({ type: 'date' })
  date: string;

  // holiday=放假 | makeup=补班
  @Column({ length: 10 })
  kind: 'holiday' | 'makeup';

  // 备注，如“国庆节”“国庆调休补班”
  @Column({ length: 64, nullable: true })
  name: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
