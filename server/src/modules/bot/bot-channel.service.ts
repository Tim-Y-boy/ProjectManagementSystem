import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createLarkChannel, LoggerLevel } from '@larksuiteoapi/node-sdk';
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { config } from '../../config/config';
import { BotQueryLog } from '../../entities/bot-query-log.entity';
import { User } from '../../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { parseIntent } from './bot-intent';
import { BotQueryService, BotUserContext } from './bot-query.service';
import { BotReplyService } from './bot-reply.service';
import { AgentService, AgentToolTraceStep } from './agent.service';
import { isLlmError, LLM_FALLBACK_KINDS } from './llm-adapter';

// 飞书机器人长连接接入（docs/15 第 3、7 节）：
// 服务器出网与飞书建立 WebSocket 长连接，接收用户消息事件，无需公网回调地址。
// 二期（docs/16）：LLM_ENABLED=true 时消息走智能体（大模型把任意问法翻译成只读工具调用）；
// 智能体不可用/超时/报错时自动回落一期关键词引擎（BR-A7），系统不哑火。
@Injectable()
export class BotChannelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotChannelService.name);
  private channel: LarkChannel | null = null;

  constructor(
    @InjectRepository(BotQueryLog)
    private readonly logs: Repository<BotQueryLog>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly query: BotQueryService,
    private readonly reply: BotReplyService,
    private readonly agent: AgentService,
  ) {}

  async onModuleInit() {
    if (!config.feishu.botEnabled) {
      this.logger.log('FEISHU_BOT_ENABLED=false，跳过机器人长连接启动');
      return;
    }
    if (!config.feishu.appId || !config.feishu.appSecret) {
      this.logger.warn('未配置 FEISHU_APP_ID/SECRET，机器人长连接不启动');
      return;
    }

    const channel = createLarkChannel({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      // BR-1：单聊可直聊（dmMode=open）；群聊需 @机器人（requireMention=true）
      policy: { dmMode: 'open', requireMention: true },
      loggerLevel: LoggerLevel.info,
    });

    channel.on('message', (msg) =>
      this.handleMessage(msg).catch((e: any) =>
        this.logger.error(`消息处理失败: ${e?.message || e}`),
      ),
    );
    channel.on('reject', (evt) =>
      this.logger.log(`消息被策略拒绝: ${evt.reason} (chat=${evt.chatId})`),
    );
    // 二期：通知卡片按钮操作
    channel.on('cardAction', (evt) => this.logger.log(`卡片操作（待二期实现）: ${JSON.stringify(evt.action)}`));
    channel.on('error', (err) =>
      this.logger.error(`机器人连接错误: ${err.code} ${err.message}`),
    );
    channel.on('reconnecting', () => this.logger.warn('机器人长连接断线，重连中...'));
    channel.on('reconnected', () => this.logger.log('机器人长连接已恢复'));

    this.channel = channel;
    try {
      await channel.connect();
      this.logger.log(
        `机器人长连接已建立: ${JSON.stringify(channel.getConnectionStatus())}`,
      );
    } catch (e: any) {
      this.logger.error(`机器人长连接建立失败: ${e?.message || e}`);
    }
  }

  async onModuleDestroy() {
    await this.channel?.disconnect();
  }

  // ---------- 消息分发：一期关键词 / 二期智能体（docs/16 §7） ----------

  private async handleMessage(msg: NormalizedMessage) {
    const openId = msg.senderId;
    const text = this.cleanFeishuText(msg);
    const chatType = msg.chatType === 'group' ? 'group' : 'p2p';

    let user: User | null = null;
    let intent = 'help';

    try {
      // 身份映射：open_id → 本地 user + 构造权限上下文（BR-2）
      const resolved = await this.resolveUser(openId);
      if (!resolved) {
        const replyText = this.reply.unbound();
        await this.sendReply(msg, replyText);
        await this.record(openId, null, chatType, 'unbound', text, replyText, true, null);
        return;
      }
      ({ user } = resolved);
      const ctx = resolved.ctx;

      if (this.agent.enabled()) {
        // 智能体：秒回 ack + 异步补结果，多轮可能超 3 秒，绝不在事件 handler 里 await（BR-A9）
        await this.handleAgentMessage(msg, text, ctx, user, chatType);
        return;
      }

      // 一期关键词路径（LLM_ENABLED=false 时行为与改前完全一致 = 回归基准）
      const ans = await this.keywordAnswer(text, ctx);
      intent = ans.intent;
      await this.sendReply(msg, ans.text);
      await this.record(openId, user.id, chatType, intent, text, ans.text, true, null);
    } catch (e: any) {
      this.logger.error(`机器人指令处理异常[${intent}]: ${e?.message || e}`);
      const replyText = this.reply.error();
      await this.sendReply(msg, replyText).catch(() => {});
      await this.record(openId, user?.id ?? null, chatType, intent, text, replyText, false, e?.message || String(e));
    }
  }

  // ---------- 智能体路径 ----------

  /** 秒回「正在查询…」，随后把真正跑智能体的整段丢进异步 tail，避免阻塞消息分发/去重 */
  private async handleAgentMessage(
    msg: NormalizedMessage,
    text: string,
    ctx: BotUserContext,
    user: User,
    chatType: string,
  ) {
    try {
      await this.sendReply(msg, this.reply.thinking());
    } catch (e: any) {
      this.logger.warn(`智能体 ack 发送失败: ${e?.message || e}`);
    }
    this.runAgentTail(msg, text, ctx, user, chatType).catch((e: any) =>
      this.logger.error(`runAgentTail 未兜住: ${e?.message || e}`),
    );
  }

  /** 智能体真正的执行：成功补发答复；LlmError 且属回落集 → 回落一期关键词；其它 → 通用错误 */
  private async runAgentTail(
    msg: NormalizedMessage,
    text: string,
    ctx: BotUserContext,
    user: User,
    chatType: string,
  ) {
    const openId = msg.senderId;
    try {
      // 取近 5 轮对话上下文，让智能体能承接指代（docs/16 P2）
      const history = await this.query.recentConversations(openId, chatType);
      const res = await this.agent.run(text, ctx, history);
      await this.sendReply(msg, res.text).catch((e: any) =>
        this.logger.error(`智能体答复发送失败: ${e?.message || e}`),
      );
      await this.record(openId, user.id, chatType, 'agent', text, res.text, true, null, res.trace);
      await this.query.addConversation(openId, chatType, text, res.text);
      return;
    } catch (e: any) {
      // 该回落：LLM 超时/网络/HTTP/未配置/空答/工具致命错——一期关键词兜底（BR-A7）
      if (isLlmError(e) && LLM_FALLBACK_KINDS.has(e.kind)) {
        this.logger.warn(`智能体回落一期关键词 kind=${e.kind}: ${e.message}`);
        await this.record(openId, user.id, chatType, 'agent', text, null, false, `回落关键词(${e.kind}): ${e.message}`).catch(() => {});
        try {
          const ans = await this.keywordAnswer(text, ctx);
          await this.sendReply(msg, ans.text).catch((e2: any) =>
            this.logger.error(`回落关键词发送失败: ${e2?.message || e2}`),
          );
          await this.record(openId, user.id, chatType, ans.intent, text, ans.text, true, null).catch(() => {});
          await this.query.addConversation(openId, chatType, text, ans.text);
        } catch (e2: any) {
          this.logger.error(`回落关键词也失败: ${e2?.message || e2}`);
          const errText = this.reply.error();
          await this.sendReply(msg, errText).catch(() => {});
          await this.record(openId, user.id, chatType, 'agent', text, null, false, e2?.message || String(e2)).catch(() => {});
        }
        return;
      }
      // 真错（非 LlmError / 不在回落集，如 DB 挂）：关键词一样会挂，直接报错更诚实
      this.logger.error(`智能体异常: ${e?.message || e}`);
      const errText = this.reply.error();
      await this.sendReply(msg, errText).catch(() => {});
      await this.record(openId, user.id, chatType, 'agent', text, null, false, e?.message || String(e)).catch(() => {});
    }
  }

  // ---------- 复用拆分 ----------

  /** 一期关键词路径：parseIntent + BotQueryService.handle。自带兜底，永不外抛。 */
  private async keywordAnswer(text: string, ctx: BotUserContext): Promise<{ intent: string; text: string }> {
    try {
      const parsed = parseIntent(text);
      return { intent: parsed.intent, text: await this.query.handle(parsed.intent, parsed.args, ctx) };
    } catch (e: any) {
      this.logger.error(`关键词查询异常: ${e?.message || e}`);
      return { intent: 'help', text: this.reply.error() };
    }
  }

  /** open_id → 本地 user（不活跃/不存在 → null）；存在则顺带构 BotUserContext（复用 auth.getCurrent，与登录态一致） */
  private async resolveUser(openId: string): Promise<{ user: User; ctx: BotUserContext } | null> {
    const user = openId ? await this.users.findOne({ where: { openId } }) : null;
    if (!user || !user.isActive) return null;
    const current = await this.auth.getCurrent(user.id);
    return {
      user,
      ctx: {
        userId: current.id,
        name: current.name,
        feishuUserId: current.feishuUserId,
        deptId: current.deptId,
        roles: current.roles,
        managedDeptIds: current.managedDeptIds,
      },
    };
  }

  /** 去群聊 @ 前缀：SDK 在 requireMention 策略下通常已归一化，这里再防御一层，避免 @ 残片污染 LLM/关键词 */
  private cleanFeishuText(msg: NormalizedMessage): string {
    let s = (msg.content || '').trim();
    const mentions = msg.mentions ?? [];
    for (const m of mentions) {
      if (!m.isBot) continue;
      if (m.key && s.startsWith(m.key)) {
        s = s.slice(m.key.length).trim();
      } else if (m.name && s.startsWith(`@${m.name}`)) {
        s = s.slice(`@${m.name}`.length).trim();
      }
    }
    // 兜底：剥任意打头的 <at>…</at> 或 @token
    s = s
      .replace(/^<at[^>]*>[\s\S]*?<\/at>/, '')
      .replace(/^@\S*\s*/, '')
      .trim();
    return s;
  }

  private async sendReply(msg: NormalizedMessage, text: string) {
    await this.channel?.send(msg.chatId, { text }, { replyTo: msg.messageId });
  }

  private async record(
    openId: string,
    userId: number | null,
    chatType: string,
    intent: string,
    rawText: string,
    replySummary: string | null,
    success: boolean,
    error: string | null,
    agentTrace?: AgentToolTraceStep[],
  ) {
    const log = this.logs.create({
      feishuOpenId: openId || 'unknown',
      userId,
      chatType,
      intent,
      rawText,
      replySummary: replySummary ? replySummary.slice(0, 500) : null,
      success,
      error,
      agentTrace: (agentTrace ?? null) as unknown as Record<string, unknown> | null,
    });
    await this.logs.save(log).catch((e) =>
      this.logger.error(`机器人日志落库失败: ${e?.message || e}`),
    );
  }
}
