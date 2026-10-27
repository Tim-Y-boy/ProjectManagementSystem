export interface TaskLogEntry {
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  payload?: Record<string, unknown> | null;
}

type ActionMeta = { label: string; type: 'primary' | 'success' | 'warning' | 'danger' | 'info' };

// 原 action 仍用于接口筛选；展示时结合前后状态还原具体业务动作，兼容历史日志。
export const LOG_ACTION_META: Record<string, ActionMeta> = {
  create: { label: '创建任务', type: 'success' },
  update: { label: '更新任务', type: 'primary' },
  delete: { label: '删除任务', type: 'danger' },
  project_delete: { label: '删除项目', type: 'danger' },
  transition: { label: '任务状态操作', type: 'info' },
  reassign: { label: '改派执行人', type: 'warning' },
  accept: { label: '验收通过', type: 'success' },
  reject: { label: '任务退回', type: 'danger' },
  archive: { label: '归档', type: 'info' },
  plan_change: { label: '计划变更', type: 'warning' },
  plan_change_request: { label: '提交变更申请', type: 'warning' },
  plan_change_owner_approve: { label: '负责人审核通过', type: 'success' },
  plan_change_approve: { label: '变更审批通过', type: 'success' },
  plan_change_reject: { label: '变更审批退回', type: 'danger' },
  auto_rollup: { label: '自动汇总父任务', type: 'info' },
  reorder: { label: '调整任务顺序', type: 'info' },
  daily_update: { label: '填写关键进展', type: 'success' },
  daily_update_edit: { label: '编辑关键进展', type: 'primary' },
  daily_update_delete: { label: '删除关键进展', type: 'danger' },
  daily_update_exempt: { label: '确认合理补填', type: 'warning' },
  daily_update_unexempt: { label: '撤销合理补填', type: 'warning' },
  task_asset: { label: '添加过程资料', type: 'primary' },
  task_asset_link: { label: '关联进展资料', type: 'primary' },
  task_asset_unlink: { label: '取消资料关联', type: 'warning' },
  task_asset_delete: { label: '删除资料', type: 'danger' },
};

const TRANSITION_META: Record<string, ActionMeta> = {
  'pending_confirm:todo': { label: '确认任务', type: 'success' },
  'pending_confirm:rejected': { label: '任务退回', type: 'danger' },
  'todo:doing': { label: '开始任务', type: 'primary' },
  'doing:pending_accept': { label: '提交验收', type: 'warning' },
  'pending_accept:done': { label: '验收通过', type: 'success' },
  'pending_accept:doing': { label: '验收退回', type: 'danger' },
  'done:doing': { label: '已完成任务退回', type: 'warning' },
  'doing:todo': { label: '撤销开始', type: 'warning' },
  'rejected:todo': { label: '恢复待办', type: 'primary' },
  'todo:pending_confirm': { label: '重新提交确认', type: 'warning' },
};

export function logActionMeta(log: TaskLogEntry): ActionMeta {
  if (log.payload?.changeType === 'delete') {
    if (log.action === 'plan_change_request') return { label: '申请取消任务', type: 'warning' };
    if (log.action === 'plan_change_approve' || log.action === 'plan_change') return { label: '批准取消任务', type: 'success' };
    if (log.action === 'plan_change_reject') return { label: '退回取消申请', type: 'danger' };
  }
  if (log.action === 'transition') {
    const meta = TRANSITION_META[`${log.fromStatus}:${log.toStatus}`];
    if (meta) return meta;
    if (log.toStatus === 'cancelled') return { label: '取消任务', type: 'danger' };
  }
  return LOG_ACTION_META[log.action] || { label: '其他操作', type: 'info' };
}

export function logNote(log: TaskLogEntry): string {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const comment = text(log.payload?.comment);
  const reason = text(log.payload?.reason);
  if (log.action === 'daily_update' || log.action === 'daily_update_edit') {
    return [text(log.payload?.content), text(log.payload?.risk) ? `风险：${text(log.payload?.risk)}` : '',
      text(log.payload?.nextPlan) ? `下一步：${text(log.payload?.nextPlan)}` : ''].filter(Boolean).join('\n');
  }
  if (log.action === 'transition' && log.toStatus === 'pending_accept') {
    return [comment ? `提交说明：${comment}` : '', text(log.payload?.materialExemptionReason) ? `无资料说明：${text(log.payload?.materialExemptionReason)}` : ''].filter(Boolean).join('；');
  }
  if (log.action === 'task_asset_link' || log.action === 'task_asset_unlink') {
    const title = text(log.payload?.title);
    const material = title ? `资料“${title}”` : '资料';
    return log.action === 'task_asset_link'
      ? `将${material}关联到关键进展`
      : `取消${material}与关键进展的关联`;
  }
  if (log.action.startsWith('plan_change')) {
    const subject = log.payload?.changeType === 'delete' ? '取消任务' : '调整任务计划';
    const descriptions: Record<string, string> = {
      plan_change_request: `提交${subject}申请，等待审批；任务状态未改变`,
      plan_change_owner_approve: '项目负责人审核通过，等待终审；任务状态未改变',
      plan_change_approve: `审批通过，${subject}已生效`,
      plan_change_reject: `${subject}申请被退回，未生效`,
      plan_change: log.payload?.changeType === 'delete' ? '审批通过，任务已取消' : '审批通过，任务计划已更新',
    };
    const before = log.payload?.before as Record<string, unknown> | undefined;
    const after = log.payload?.after as Record<string, unknown> | undefined;
    const dates = log.payload?.changeType === 'date' && before && after
      ? [['startAt', '开始日期'], ['dueAt', '截止日期']].filter(([field]) => field in after && before[field] !== after[field])
        .map(([field, label]) => `${label}：${text(before[field]) || '未设置'} → ${text(after[field]) || '未设置'}`)
      : [];
    return [descriptions[log.action], ...dates, reason ? `申请原因：${reason}` : '', comment ? `审批意见：${comment}` : ''].filter(Boolean).join('；');
  }
  const isReturn = log.action === 'reject' || (log.action === 'transition' && (
    (log.fromStatus === 'pending_accept' && log.toStatus === 'doing') ||
    (log.fromStatus === 'done' && log.toStatus === 'doing') ||
    (log.fromStatus === 'pending_confirm' && log.toStatus === 'rejected')
  ));
  const note = comment || reason;
  if (!note) return '';
  return `${isReturn ? '退回原因' : '操作说明'}：${note}`;
}
