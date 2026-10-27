import { h } from 'vue';

export function materialConfirmationMessage(reason: string) {
  return h('div', { class: 'material-confirmation-body' }, [
    h('p', { class: 'material-confirmation-intro' }, '当前任务未附资料，请确认以下原因。'),
    h('div', { class: 'material-confirmation-reason' }, [
      h('div', { class: 'material-confirmation-label' }, '已填写的无资料原因'),
      h('div', { class: 'material-confirmation-text' }, reason),
    ]),
    h('p', { class: 'material-confirmation-note' }, '提交后，由验收负责人核实原因并验收。'),
  ]);
}
