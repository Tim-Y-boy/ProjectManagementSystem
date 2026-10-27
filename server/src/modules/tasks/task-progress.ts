// 任务进度计算（docs/02 进度机制，已简化为"子任务完成占比"）
// 进度单位统一 0-1，前端乘 100 显示百分比

// 叶子任务进度：按状态折算（与多维表的"已完成/进行中/待开始"对应）
// done=100%，pending_accept=90%（已提交验收，接近完成），doing=50%，其余=0
export function leafProgress(status: string): number {
  if (status === 'done') return 1;
  if (status === 'pending_accept') return 0.9;
  if (status === 'doing') return 0.5;
  return 0; // todo / pending_confirm / cancelled / rejected
}

// 父任务进度 = 子任务进度等权平均（子任务进度由调用方传入，已算好）∈ [0,1]
// 即"子任务完成占比"：子节点中已完成(100)/进行中(50)/待开始(0)的平均
export function calcParentProgress(childProgresses: number[]): number | null {
  if (!childProgresses.length) return null;
  const sum = childProgresses.reduce((s, p) => s + p, 0);
  return Math.round((sum / childProgresses.length) * 1000) / 1000;
}

// 滞后判定：actual < expected - tolerance → lagging
// expected = (今天 - 开始日)/(截止日 - 开始日)，无日期或不合理则跳过(返回null)
export function calcLagging(progress: number, startAt: string | null, dueAt: string | null, tolerance = 0.1): boolean | null {
  if (!startAt || !dueAt) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(dueAt).getTime();
  const now = Date.now();
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  if (progress >= 1) return false; // 已完成不参与
  const expected = Math.max(0, Math.min(1, (now - start) / (end - start)));
  return progress < expected - tolerance;
}
