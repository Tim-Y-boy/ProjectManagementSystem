// 智能体查询 · LLM 供应商适配层（docs/16 §3）。
// 默认 OpenAI 兼容 /v1/chat/completions + tool calling，DeepSeek / 通义千问 / 豆包 / 智谱均兼容；
// 换供应商只改 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL；将来接非兼容协议（如 Anthropic）只新增一个实现。

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { config } from '../../config/config';

// ---------- 共享低层类型：agent-tools / agent.service 都从这里 import，避免环依赖 ----------

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM 发起的一次函数调用。arguments 是 JSON 字符串（各家 API 都是字符串），adapter 不透传解析。 */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 本地维护的对话消息。转成 OpenAI 格式时见 serialize。 */
export interface ChatMessage {
  role: LlmRole;
  content: string | null;
  /** role='tool' 时：回指产生该调用的 assistant tool_call.id */
  tool_call_id?: string;
  /** role='assistant' 且本轮调了工具时：必须原样带完整 tool_calls 喂回 */
  tool_calls?: LlmToolCall[];
}

/** OpenAI 线上工具的 JSON Schema 形态 */
export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmReply {
  /** 无 tool_calls 时的最终文本；有 tool_calls 时通常为 null */
  content: string | null;
  toolCalls: LlmToolCall[];
}

// ---------- 错误：channel 靠 e.kind 决定「回落一期关键词」还是「真报错」 ----------

export type LlmErrorKind =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'http'
  | 'bad_response'
  | 'empty'
  | 'tool';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export function isLlmError(e: unknown): e is LlmError {
  return e instanceof LlmError;
}

/** 这些 kind 下智能体应回落一期关键词引擎（LLM 不可用不等于系统故障，BR-A7） */
export const LLM_FALLBACK_KINDS: ReadonlySet<LlmErrorKind> = new Set([
  'not_configured',
  'timeout',
  'network',
  'http',
  'bad_response',
  'empty',
  'tool',
]);

export interface LlmAdapter {
  chat(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmReply>;
}

/** DI token：把 LlmAdapter 交给具体实现（当前 OpenAiCompatLlmAdapter，将来可换 Anthropic 等） */
export const LLM_ADAPTER = 'LLM_ADAPTER';

/** 把本地 ChatMessage 序列化为 OpenAI /v1/chat/completions 的 messages 项 */
function serializeMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.tool_call_id ?? '', content: m.content ?? '' };
  }
  if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
    return {
      role: 'assistant',
      content: m.content ?? null,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content ?? '' };
}

@Injectable()
export class OpenAiCompatLlmAdapter implements LlmAdapter {
  private readonly logger = new Logger(OpenAiCompatLlmAdapter.name);

  async chat(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmReply> {
    if (!config.llm.apiKey) {
      throw new LlmError('not_configured', '未配置 LLM_API_KEY，智能体不可用');
    }
    if (!tools.length) {
      throw new LlmError('bad_response', '没有可用工具，无法驱动智能体');
    }

    const url = `${config.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let resp;
    try {
      resp = await axios.post(
        url,
        {
          model: config.llm.model,
          messages: messages.map(serializeMessage),
          tools,
          temperature: 0, // 查询类回复，降低编造
          max_tokens: config.llm.maxTokens,
        },
        {
          timeout: config.llm.timeoutMs,
          headers: {
            Authorization: `Bearer ${config.llm.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (e: any) {
      // 有 HTTP 状态 → http 错（4xx/5xx），回落关键词并留痕
      if (e?.response) {
        const status = e.response.status;
        const data = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data ?? '');
        throw new LlmError('http', `LLM HTTP ${status}: ${String(data).slice(0, 300)}`, e);
      }
      const code = String(e?.code ?? '');
      const msg = String(e?.message ?? '');
      if (e?.code === 'ECONNABORTED' || /timeout/i.test(code) || /timed? ?out/i.test(msg)) {
        throw new LlmError('timeout', `LLM 调用超时（${config.llm.timeoutMs}ms）: ${msg}`, e);
      }
      const networkCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ERR_NETWORK'];
      if (networkCodes.includes(code)) {
        throw new LlmError('network', `LLM 网络错误(${code}): ${msg}`, e);
      }
      throw new LlmError('network', `LLM 调用失败: ${msg}`, e);
    }

    // 结构校验：以 choices[0].message 有无 tool_calls 为准，不依赖 finish_reason（各家取值不一致）
    const choice = resp?.data?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new LlmError('bad_response', 'LLM 响应缺少 choices[0].message');
    }

    const rawContent = message.content;
    const content =
      rawContent != null && String(rawContent).trim() ? String(rawContent) : null;

    const toolCalls: LlmToolCall[] = Array.isArray(message.tool_calls)
      ? message.tool_calls
          .filter((tc: any) => tc?.type === 'function')
          .map((tc: any) => ({
            id: String(tc.id ?? ''),
            name: String(tc.function?.name ?? ''),
            arguments: String(tc.function?.arguments ?? '{}'),
          }))
      : [];

    if (content === null && toolCalls.length === 0) {
      // 空回复由上层判定：AgentService 抛 LlmError('empty')，adapter 不背业务
      this.logger.warn('LLM 返回既无内容也无工具调用');
    }
    return { content, toolCalls };
  }
}
