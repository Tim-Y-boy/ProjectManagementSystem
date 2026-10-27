const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/daily-report.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, moduleContext);
const { reportExcerpt, groupDailyReport } = moduleContext.exports;
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const { renderToString } = require('@vue/server-renderer');
test('short excerpt preserves original words without inventing a result and limits long text', () => {
  assert.equal(reportExcerpt('完成评审。\n发现两个问题'), '完成评审。 发现两个问题');
  assert.equal(reportExcerpt('123456789', 5), '12345…');
  assert.equal(reportExcerpt('😀😀😀', 2), '😀😀…');
});
test('daily grouping joins matching project ids, separates same-name projects and preserves records', () => {
  const rows = [
    { id: 1, projectId: 2, projectName: '项目 A' },
    { id: 2, projectId: 3, projectName: '项目 A' },
    { id: 3, projectId: '2', projectName: '项目 A' },
  ];
  const groups = groupDailyReport(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.map(item => item.id).join(','), '1,3');
  assert.equal(groups[1].items[0].id, 2);
  assert.equal(groupDailyReport([]).length, 0);
});
test('compact report retains backfill date and links directly to the task without secondary details', async () => {
  const template = parse(fs.readFileSync(path.join(__dirname, '../src/components/DailyReportProject.vue'), 'utf8')).descriptor.template.content;
  const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(vue);
  const app = vue.createSSRApp({ render, setup: () => ({
    name: '设备改造', reportDate: '2026-10-19', mobile: false, reportExcerpt,
    formatBeijingTime: () => '2026-10-19 09:30',
    items: [{ id: 1, projectId: 2, taskId: 3, userName: '测试人员', deptName: '工程部',
      taskTitle: '设备验收', content: '完成三台设备现场验收', workDate: '2026-10-18',
      createdAt: '2026-10-19T01:30:00Z' }],
  }) });
  app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => vue.h('a', { href: props.to }, slots.default?.()) });
  const html = await renderToString(app);
  assert.match(html, /补填 2026-10-18/);
  assert.match(html, /完成三台设备现场验收/);
  assert.match(html, /href="\/tasks\?projectId=2&amp;taskId=3"/);
  assert.doesNotMatch(html, /<details|工程部|提交于|下一步/);
});
