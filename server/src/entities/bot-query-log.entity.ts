import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 机器人查询/操作日志（docs/15 第 6.4 节），用于排查与审计
@Entity('bot_query_logs')
export class BotQueryLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'feishu_open_id', length: 64 })
  feishuOpenId: string;

  @Index()
  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: number | null;

  @Column({ name: 'chat_type', length: 16 })
  chatType: string; // p2p / group

  @Column({ length: 32, default: 'unknown' })
  intent: string;

  @Column({ name: 'raw_text', type: 'text' })
  rawText: string;

  @Column({ name: 'reply_summary', type: 'text', nullable: true })
  replySummary: string | null;

  @Column({ default: true })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  // 智能体查询的工具调用序列（docs/16 §8）：记录每轮调了哪个工具/参数/结果/成败，供审计与排查"模型为什么这么答"
  @Column({ name: 'agent_trace', type: 'jsonb', nullable: true })
  agentTrace: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
