const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const { renderToString } = require('@vue/server-renderer');
const ts = require('typescript');

test('approval history renders collapsible project headings and nested records', async () => {
  const template = parse(fs.readFileSync(path.join(__dirname, '../src/views/Approvals.vue'), 'utf8')).descriptor.template.content;
  const code = compile(template, { mode: 'function', prefixIdentifiers: true, isTS: true }).code;
  const render = new Function('Vue', ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText)(vue);
  const row = { key: 'a', title: '合同签订', kind: 'accept', status: 'done', path: '/tasks?taskId=1' };
  for (const closed of [false, true]) {
    const app = vue.createSSRApp({ render, setup: () => ({
      tab: 'history', route: { query: {} }, hasDetail: false, kind: '', kinds: [{ value: 'accept', label: '任务验收' }], loading: false, error: '', visible: [row],
      projects: [{ key: 'project-1', name: '仓储自动化项目', rows: [row] }], collapsed: new Set(closed ? ['project-1'] : []),
      status: { done: '已通过' }, formatBeijingTime: () => '2026-10-15', router: { push() {} },
      reload() {}, select() {}, toggleProject() {}, collapseAll() {}, backToList() {},
    }) });
    app.component('ElButton', { setup: (_, { slots }) => () => vue.h('button', slots.default?.()) });
    for (const name of ['CountPill', 'ElDialog', 'ElSelect', 'ElOption', 'ElAlert', 'ElSkeleton', 'ElEmpty', 'TodoInbox', 'PlanChanges', 'TaskApprovalDetail', 'Closures']) app.component(name, { render: () => null });
    const html = await renderToString(app);
    assert.match(html, /仓储自动化项目/);
    assert.match(html, /合同签订/);
    assert.match(html, new RegExp('aria-expanded="' + !closed + '"'));
    assert.equal(/style="display:none;"/.test(html), closed);
    assert.doesNotMatch(html, /<template(?:\s|>)/);
  }
});

test('pending project groups render in visible HTML rather than an inert native template', async () => {
  const template = parse(fs.readFileSync(path.join(__dirname, '../src/components/todo/TodoInbox.vue'), 'utf8')).descriptor.template.content;
  const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(vue);
  const item = { key: 'task-1', title: '需要显示的任务' };
  const app = vue.createSSRApp({ render, setup: () => ({
    waitingCount: 0, waitingReload: 0, reloadAll() {}, approvalOnly: false, loading: false, filters: [{ key: 'all', label: '全部待处理' }],
    filter: 'all', counts: { all: 1 }, errors: [], focusedKey: '', visible: [item], rows: [item],
    collapsed: new Set(), groups: [{ key: 'todo', label: '待我执行', rows: [item], projects: [{ key: 'project-1', name: '需要显示的项目', rows: [item] }] }],
    groupKey: (a, b) => a + '-' + b, mobile: false, busyId: undefined,
    reload() {}, select() {}, selectInform() {}, collapseAll() {}, toggleProject() {}, open() {}, acknowledge() {},
  }) });
  app.component('ElButton', { setup: (_, { slots }) => () => vue.h('button', slots.default?.()) });
  app.component('TodoInboxItem', { props: ['item'], setup: props => () => vue.h('article', props.item.title) });
  for (const name of ['CountPill', 'WaitingApprovals', 'ElAlert', 'ElSkeleton', 'ElEmpty']) app.component(name, { render: () => null });
  const html = await renderToString(app);
  assert.match(html, /需要显示的项目/);
  assert.match(html, /需要显示的任务/);
  assert.doesNotMatch(html, /<template(?:\s|>)/, 'Native template content is hidden by the browser');
});
