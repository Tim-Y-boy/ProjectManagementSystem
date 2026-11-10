import { BadRequestException } from '@nestjs/common';

export function parseCharterResponse(data: any) {
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new BadRequestException('模型输出达到长度上限，内容不完整，请重新解析');
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new BadRequestException('模型未返回解析内容，请重试');
  try { return JSON.parse(choice.message.content); }
  catch { throw new BadRequestException('模型返回的内容格式不完整，请重新解析'); }
}

export function charterModelOptions(baseUrl: string) {
  // This task extracts structured evidence; do not spend its output budget on
  // DeepSeek's default thinking mode. Other providers retain standard options.
  const deepseek = new URL(baseUrl).hostname === 'api.deepseek.com';
  return { max_tokens: 12000, ...(deepseek ? { thinking: { type: 'disabled' } } : {}) };
}

export function charterFailureMessage(error: any) {
  if (error instanceof BadRequestException) return error.message;
  if (['ECONNABORTED','ETIMEDOUT'].includes(error?.code)) return 'AI 服务响应超时，请稍后重试或减少文件数量';
  const status = error?.response?.status;
  if (status === 401 || status === 403) return 'AI 服务鉴权失败，请联系管理员检查服务配置';
  if (status === 402) return 'AI 服务额度不足，请联系管理员检查账户额度';
  if (status === 429) return 'AI 服务当前请求较多，请稍后重试';
  if (status >= 500) return 'AI 服务暂时不可用，请稍后重试';
  if (['EACCES','ECONNREFUSED','ENOTFOUND','ECONNRESET','EAI_AGAIN'].includes(error?.code)) return '无法连接 AI 服务，请检查后端网络后重试';
  return '文件解析或 AI 请求失败，请重试；若持续失败，请联系管理员查看服务日志';
}
