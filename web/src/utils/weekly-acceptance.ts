import { h } from 'vue';
import { ElMessageBox } from 'element-plus';
import { tasksApi } from '@/api';

/** Missing weeks block the operation even when the user dismisses the dialog. */
export async function checkWeeklyProgressBeforeAcceptance(
  taskId: number,
  onFill: (weekStart: string) => void | Promise<void>,
  reviewing = false,
): Promise<boolean> {
  const { missingWeeks } = await tasksApi.missingWeeklyProgress(taskId);
  if (!missingWeeks.length) return true;
  const message = h('div', { class: 'weekly-acceptance-body' }, [
    h('p', { class: 'weekly-acceptance-intro' }, [
      '该任务还有 ', h('strong', `${missingWeeks.length} 周`), '关键进展未填写。',
    ]),
    h('div', { class: 'weekly-acceptance-label' }, '缺填周次'),
    h('ul', { class: 'weekly-acceptance-weeks' }, missingWeeks.map(week =>
      h('li', { key: week.weekStart }, `${week.weekStart} 至 ${week.weekEnd}`),
    )),
    h('p', { class: 'weekly-acceptance-note' }, reviewing
      ? '请先退回任务，由执行人补齐以上周次的关键进展，再重新提交验收。'
      : '任一执行人补填对应周的关键进展即可。请选择实际工作日期，其他周的进展不能抵扣。'),
  ]);
  try {
    await ElMessageBox.confirm(message, '请先补齐每周关键进展', {
      customClass: 'material-reason-confirm',
      confirmButtonText: reviewing ? '我知道了' : '去补填',
      cancelButtonText: '暂不提交', showCancelButton: !reviewing,
    });
  } catch (error) {
    if (error === 'cancel' || error === 'close') return false;
    throw error;
  }
  if (!reviewing) await onFill(missingWeeks[0].weekStart);
  return false;
}
