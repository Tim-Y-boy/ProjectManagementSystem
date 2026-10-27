// Run from web: node --test scripts/test-task-risk.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-14T12:00:00'])); }
}
function evaluate(source, dependencies = {}) {
  const context = vm.createContext({ exports: {}, Date: FixedDate, ...dependencies });
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(js, context);
  return context;
}
const read = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const risk = evaluate(read('utils/task-risk.ts')).exports;
const dates = evaluate(read('utils/task-dates.ts')).exports;

// Exercise the actual aggregation functions used by both pages, without app/network setup.
function pageFunctions(file, names) {
  const { descriptor } = parse(read(file));
  const source = ts.createSourceFile(file + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length);
  return evaluate(functions.map((node) => node.getText(source)).join('\n'), { ...risk, ...dates });
}
const tasks = pageFunctions('views/Tasks.vue', ['annotateRisk']);
const dashboard = pageFunctions('views/Dashboard.vue', ['riskState', 'nodeState', 'annotate', 'isIgnoredNode', 'leafNodes', 'leafStats']);

function screenshotStage() {
  return {
    id: 444, status: 'doing', dueAt: '2026-12-31',
    children: [
      { id: 531, status: 'rejected', dueAt: '2026-05-15', completedAt: '2026-09-10T10:00:00' },
      { id: 532, status: 'rejected', dueAt: '2026-07-31' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, status: 'done', dueAt: '2026-07-31', reasonableSupplement: true })),
    ],
  };
}

test('rejected tasks retain overdue and due-soon risk until completed or cancelled', () => {
  assert.equal(risk.leafRisk({ status: 'rejected', dueAt: '2026-05-15' }), 2);
  assert.equal(risk.leafRisk({ status: 'rejected', dueAt: '2026-09-14' }), 1);
  assert.equal(risk.leafRisk({ status: 'rejected', dueAt: '2026-09-17' }), 1);
  assert.equal(risk.leafRisk({ status: 'rejected', dueAt: '2026-09-18' }), 0);
  assert.equal(risk.leafRisk({ status: 'rejected', dueAt: null }), 0);
  for (const status of ['done', 'cancelled']) {
    assert.equal(risk.leafRisk({ status, dueAt: '2026-05-15' }), 0);
  }
});

test('task list counts two rejected overdue leaves once and rolls risk up through ancestors', () => {
  const project = { id: 'project', children: [screenshotStage()] };
  tasks.annotateRisk(project);
  const stage = project.children[0];
  assert.equal(stage.children[0]._risk, 2);
  assert.equal(stage.children[0]._maxOverdueDays, 122);
  assert.equal(stage.children[1]._maxOverdueDays, 45);
  assert.equal(stage._overdue, 2);
  assert.equal(stage._maxOverdueDays, 122);
  assert.equal(project._overdue, 2);
  assert.equal(project._risk, 2);
});

test('dashboard retains rejected status, overdue warning and unfinished progress', () => {
  const stage = screenshotStage();
  dashboard.annotate(stage);
  assert.equal(stage.children[0]._state.label, '已退回 · 延期 122 天');
  assert.equal(stage._state.color, 'red');
  const stats = dashboard.leafStats([stage]);
  assert.equal(stats.overdue, 2);
  assert.equal(stats.total, 7);
  assert.equal(stats.done, 5);
  assert.equal(stats.progress, 71);
});

test('a stage containing only rejected tasks remains at risk; cancellation removes its leaf risk', () => {
  const stage = { status: 'todo', children: [{ status: 'rejected', dueAt: '2026-07-31' }] };
  dashboard.annotate(stage);
  assert.equal(stage._state.color, 'red');
  stage.children[0].status = 'cancelled';
  tasks.annotateRisk(stage);
  assert.equal(stage._overdue, 0);
  dashboard.annotate(stage);
  assert.equal(dashboard.leafStats(stage.children).overdue, 0);
});

test('completion days use Beijing calendar dates, including midnight and year boundaries', () => {
  for (const [dueAt, completedAt, days] of [
    ['2026-09-21', '2026-09-18T08:00:00Z', 3],
    ['2026-09-21', '2026-09-20T16:00:00Z', 0],
    ['2026-09-21', '2026-09-21T15:59:59Z', 0],
    ['2026-09-21', '2026-09-21T16:00:00Z', -1],
    ['2027-01-02', '2026-12-31T16:00:00Z', 1],
    ['2026-09-21', '2026-09-18T16:00:00+08:00', 3],
  ]) assert.equal(risk.completionDays({ status: 'done', dueAt, completedAt }), days);
});

test('incomplete tasks, parents, missing and invalid completion dates have no early-completion claim', () => {
  const task = { status: 'done', dueAt: '2026-09-21', completedAt: '2026-09-18T08:00:00Z' };
  for (const changes of [{ status: 'doing' }, { status: 'cancelled' }, { completedAt: null }, { completedAt: 'invalid' }, { dueAt: null }, { dueAt: '2026-02-30' }, { children: [{ status: 'done' }] }, { hasChildren: 1 }]) {
    assert.equal(risk.completionDays({ ...task, ...changes }), null);
  }
  assert.equal(risk.completionDays(null), null);
});

test('dashboard shows early days and does not misclassify same-day acceptance as late', () => {
  assert.equal(dashboard.nodeState({ status: 'done', dueAt: '2026-09-21', completedAt: '2026-09-18T08:00:00Z' }).label, '提前 3 天完成');
  assert.equal(dashboard.nodeState({ status: 'done', dueAt: '2026-09-21', completedAt: '2026-09-21T15:59:59Z' }).label, '完成');
  assert.equal(dashboard.nodeState({ status: 'done', dueAt: '2026-09-21', completedAt: '2026-09-21T16:00:00Z' }).label, '延期完成');
});
