// 智能体查询 · 编排层（docs/16 §2、§7）。
// AgentService：调 LLM → 执行权限校验过的只读工具 → 把结果喂回 → 直到 LLM 给最终答复或达轮次上限（BR-A8）。
// 失败语义：能识别为「智能体该回落一期关键词」的错误统一抛 LlmError（channel 据 kind 回落，BR-A7）；
// 达轮次上限不抛，返回「问题太复杂」文案当最终答复（关键词答不了复合问题）。

import { Inject, Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import {
  ChatMessage,
  LLM_ADAPTER,
  LlmAdapter,
  LlmError,
  LlmToolCall,
} from './llm-adapter';
import { AgentTool, buildSystem, toLlmTool } from './agent-tools';
import { BotReplyService } from './bot-reply.service';
import { BotUserContext } from './bot-query.service';

export const AGENT_TOOLS = 'AGENT_TOOLS';

export interface AgentToolTraceStep {
  name: string; // 工具名
  args: string; // LLM 传入的 arguments（JSON 字符串，不重新序列化，规避 BigInt 坑）
  result: string; // 截断后的工具结果文本（供审计/排查）
  ok: boolean;
  error?: string;
}

export interface AgentResult {
  text: string;
  finished: 'answer' | 'max_rounds';
  rounds: number;
  trace: AgentToolTraceStep[];
}

const TOOL_RESULT_MAX_CHARS = 2000;

function truncate(s: string, n = TOOL_RESULT_MAX_CHARS): string {
  const str = String(s ?? '');
  return str.length <= n ? str : `${str.slice(0, n - 1)}…(已截断)`;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_ADAPTER) private readonly adapter: LlmAdapter,
    @Inject(AGENT_TOOLS) private readonly tools: AgentTool[],
    private readonly reply: BotReplyService,
  ) {}

  /** 智能体是否启用：开关 + 已配 Key。channel 在启用时才走智能体路径。 */
  enabled(): boolean {
    return config.llm.enabled && !!config.llm.apiKey;
  }

  /** 历史上下文：最近 N 轮「用户问/助手答」文本对（不含 tool_calls，只作衔接铺垫） */
  async run(
    queryText: string,
    ctx: BotUserContext,
    history?: { user: string; assistant: string }[],
  ): Promise<AgentResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystem(ctx, this.tools) },
    ];
    // 注入近 N 轮对话作为上下文，支撑指代承接（「看一下吧」「那延期呢」）
    for (const h of history ?? []) {
      messages.push({ role: 'user', content: h.user });
      if (h.assistant) messages.push({ role: 'assistant', content: h.assistant });
    }
    messages.push({ role: 'user', content: queryText });
    const trace: AgentToolTraceStep[] = [];
    const maxRounds = Math.max(1, config.llm.maxRounds);
    let rounds = 0;

    for (;;) {
      // 预算耗尽、还没拿到最终答复 → 终止并提示拆分提问（BR-A8）
      if (rounds >= maxRounds) {
        this.logger.warn(`智能体达到工具轮次上限 ${maxRounds}，终止（trace ${trace.length} 条）`);
        return { text: this.reply.tooComplex(), finished: 'max_rounds', rounds, trace };
      }

      const llmReply = await this.adapter.chat(messages, this.tools.map(toLlmTool));
      rounds++;

      // 无工具调用 → 这是最终答复
      if (!llmReply.toolCalls.length) {
        const text = (llmReply.content ?? '').trim();
        if (!text) {
          throw new LlmError('empty', `LLM 第 ${rounds} 轮返回空内容且未调用工具`);
        }
        return { text, finished: 'answer', rounds, trace };
      }

      // 执行本轮工具，结果逐个喂回（assistant 消息须原样带 tool_calls，role:'tool' 的 id 逐条对上）
      const toolMsgs: ChatMessage[] = [];
      for (const tc of llmReply.toolCalls) {
        const step: AgentToolTraceStep = { name: tc.name, args: tc.arguments, result: '', ok: false };
        try {
          await this.executeTool(tc, ctx, step);
          trace.push(step);
        } catch (e) {
          trace.push(step);
          throw e;
        }
        toolMsgs.push({ role: 'tool', tool_call_id: tc.id, content: step.result });
      }

      messages.push({
        role: 'assistant',
        content: llmReply.content ?? null,
        tool_calls: llmReply.toolCalls,
      });
      messages.push(...toolMsgs);
    }
  }

  /**
   * 执行单个工具调用。只读查询，权限在工具内（BotQueryService.handle 内部）强制（BR-A1/A5）。
   * 非致命情况（未知工具/坏 JSON/权限不足的提示文本）写成 step 结果返回，不抛，让 LLM 自纠或如实转达；
   * 致命异常（DB 层）→ 包成 LlmError('tool') 上抛，由 channel 回落一期关键词。
   */
  private async executeTool(tc: LlmToolCall, ctx: BotUserContext, step: AgentToolTraceStep): Promise<void> {
    const tool = this.tools.find((t) => t.name === tc.name);
    if (!tool) {
      step.error = '未知工具';
      step.result = truncate(`未知工具「${tc.name}」，请只使用给出的工具。`);
      return;
    }

    let argsObj: Record<string, unknown> = {};
    const raw = (tc.arguments ?? '').trim();
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        argsObj = parsed as Record<string, unknown>;
      } catch {
        step.error = '参数不是合法 JSON';
        step.result = truncate(`工具 ${tool.name} 的参数不是合法 JSON：${raw.slice(0, 200)}，请修正后重试。`);
        return;
      }
    }

    try {
      const result = await tool.execute(ctx, argsObj);
      step.ok = true;
      step.result = truncate(result);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      step.error = msg;
      this.logger.error(`智能体工具 ${tool.name} 执行失败: ${msg}`);
      throw new LlmError('tool', `工具 ${tool.name} 执行失败: ${msg}`, e);
    }
  }
}
