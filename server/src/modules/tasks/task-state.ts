// 任务状态机定义（见 docs/04 数据库设计）
// 所有状态流转合法性在后端强校验，前端只按此提示。

export const TASK_STATUSES = [
  'pending_confirm', // 待确认（成员创建，待部门负责人审核）
  'todo',            // 待办（审核通过 / 上级直接分派）
  'doing',           // 进行中
  'pending_accept',  // 待验收
  'done',            // 已完成（验收通过）
  'rejected',        // 已退回
  'cancelled',       // 已取消
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

// 合法转换表：from -> to[]。不在此表中的一律拒绝。
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending_confirm: ['todo', 'rejected', 'cancelled'],
  todo: ['doing', 'cancelled', 'pending_confirm'],
  doing: ['pending_accept', 'cancelled', 'todo'],
  pending_accept: ['done', 'doing', 'cancelled'],
  done: ['doing'], // 仅管理员/总经办负责人可退回，具体权限由服务层校验
  rejected: ['todo', 'cancelled'],
  cancelled: [],
};

// 校验 from -> to 是否合法
export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
): boolean {
  if (from === to) return false;
  const allowed = TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
}
