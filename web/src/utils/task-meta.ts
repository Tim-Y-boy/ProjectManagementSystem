// 任务状态中文 + 颜色（移动端 / 复用用，避免与 PC 页各自定义打架）
export const STATUS_META: Record<string, { label: string; type: string }> = {
  pending_confirm: { label: '待确认', type: 'warning' },
  todo: { label: '待办', type: 'info' },
  doing: { label: '进行中', type: 'primary' },
  pending_accept: { label: '待验收', type: 'warning' },
  done: { label: '已完成', type: 'success' },
  rejected: { label: '已退回', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' },
};

export const statusLabel = (s: string) => STATUS_META[s]?.label || s;
export const statusType = (s: string) => STATUS_META[s]?.type || 'info';
