type ReminderRow = {
  projectId: number;
  projectName: string;
  ownerName: string;
  ownerOpenId?: string;
  status: string;
};

const md = (value: string) => String(value || '未设置')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_\[\]])/g, '\\$1');

/** Group reminder template; sending and scheduling are handled by the caller. */
export function weeklyReportReminderCard(rows: ReminderRow[], weekStart: string, weekEnd: string, url: string) {
  const pending = [...new Map(rows.filter(row => row.status !== 'submitted')
    .map(row => [row.projectId, row])).values()];
  const lines = pending.map((row, index) => `${index + 1}. **${md(row.projectName)}**\n负责人：${/^ou_[a-zA-Z0-9]+$/.test(row.ownerOpenId || '') ? `<at id=${row.ownerOpenId}></at>` : md(row.ownerName)} · **${row.status === 'missing' ? '周报未填写' : '周报已保存，尚未提交'}**`);
  const heading = `**请以下项目负责人填写并提交周报**\n周报周期：${weekStart} 至 ${weekEnd}\n**尚有 ${pending.length} 份项目周报未提交**`;
  const note = '已保存的周报仍需点击提交。逾期可补填提交；提交后锁定，修改需申请审批。';
  return {
    count: pending.length,
    fallback: ['项目周报催交提醒', heading, ...lines, note, url].join('\n'),
    card: {
      config: { wide_screen_mode: true },
      header: { template: 'blue', title: { tag: 'plain_text', content: '📝 项目周报催交提醒' } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: heading } },
        { tag: 'hr' },
        ...lines.map(content => ({ tag: 'div', text: { tag: 'lark_md', content } })),
        { tag: 'hr' },
        { tag: 'note', elements: [{ tag: 'plain_text', content: note }] },
        { tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '去填写并提交周报' }, url }] },
      ],
    },
  };
}
