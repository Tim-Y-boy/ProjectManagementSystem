import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// 智能体多轮对话上下文（docs/16 P2）：存最近 N 轮「用户问/助手答」文本对，
// 供下一轮智能体承接指代（如「看一下吧」「那延期呢」）。重启不丢（在 DB）。
// 只存最终答复文本，不存中间 tool_calls（那属于 bot_query_logs.agent_trace 审计）。
@Entity('bot_conversation')
export class BotConversation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'feishu_open_id', length: 64 })
  feishuOpenId: string; // 会话键：单聊=用户，群聊=整个群

  @Column({ name: 'chat_type', length: 16 })
  chatType: string; // p2p / group

  @Column({ name: 'user_text', type: 'text' })
  userText: string; // 用户问句（完整，不截断）

  @Column({ name: 'assistant_text', type: 'text', nullable: true })
  assistantText: string | null; // 助手答复（完整）

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
