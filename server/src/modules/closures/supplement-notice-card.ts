import { buildNotifyCard } from '../feishu/notify-card';

// 卡片中的用户输入只作为文字展示，避免被飞书 Markdown 当成标签或链接。
const text = (value: unknown) => String(value ?? '未填写')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_\[\]()~])/g, '\\$1');

export function buildSupplementNoticeCard(payload: any, url: string | null, content: string) {
  const detail = payload.supplement;
  const revoked = !!payload.revokedAt;
  const color = revoked ? 'orange' : 'blue';
  return buildNotifyCard({
    title: revoked ? '合理补填已撤销' : '合理补填告知',
    template: color,
    fields: detail ? [
      { label: '标记人', value: text(detail.actorName) },
      { label: '进展提交人', value: text(detail.authorName) },
      ...(revoked && payload.revokedBy ? [{ label: '撤销人', value: text(payload.revokedBy) }] : []),
    ] : [],
    blocks: detail ? [{
      title: text(detail.projectName), color,
      tasks: [{
        title: text(detail.taskTitle),
        status: { text: revoked ? '已撤销' : '合理补填', color },
        details: [
          `工作日期：${text(detail.workDate)}　任务截止：${text(detail.dueAt)}`,
          `实际提交：${text(detail.submittedAt)}（北京时间）`,
        ],
      }],
    }] : undefined,
    sections: detail ? [
      { title: '补填原因', lines: [text(detail.reason || '未填写')] },
      { title: '关键进展', lines: [text(detail.content)] },
    ] : [{ title: '通知详情', lines: [text(content)] }],
    note: revoked ? '该合理补填标记已撤销，已恢复为普通进展，请以本次更正为准。' : '标记已生效，无需审批。请查看后确认知晓。',
    action: { label: payload.label || '我已知晓', url },
  });
}
