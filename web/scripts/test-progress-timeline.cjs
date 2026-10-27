const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');

const file = path.join(__dirname, '../src/views/Tasks.vue');
const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
const source = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter(node =>
  ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(declaration =>
    ['sortedDailyUpdates', 'dailyTimeline'].includes(declaration.name.getText(source)),
  ),
);
assert.equal(declarations.length, 2);
const code = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;

test('timeline orders work dates descending, then submissions, and keeps linked materials', () => {
  const updates = [
    { id: 1, workDate: '2026-10-19', createdAt: '2026-10-19T09:00:00+08:00' },
    { id: 2, workDate: '2026-08-20', createdAt: '2026-10-20T08:00:00+08:00' },
    { id: 3, workDate: '2026-10-19', createdAt: '2026-10-20T09:00:00+08:00' },
    { id: 4, workDate: '2026-08-20', createdAt: '2026-10-20T10:00:00+08:00' },
  ];
  const context = {
    dailyUpdates: { value: updates },
    taskAssets: { value: [{ id: 10, progressId: 2 }] },
    assetLinksProgress: (asset, id) => asset.progressId === id,
    computed: getter => ({ get value() { return getter(); } }),
  };
  vm.createContext(context);
  vm.runInContext(code + '\nglobalThis.rows = dailyTimeline;', context);
  assert.deepEqual(Array.from(context.rows.value, row => row.id), [3, 1, 4, 2]);
  assert.deepEqual(Array.from(context.rows.value[3].assets, asset => asset.id), [10]);
  assert.equal(context.rows.value[0].assets.length, 0);
  assert.deepEqual(updates.map(row => row.id), [1, 2, 3, 4]);
  updates.push({ id: 5, workDate: '2026-08-01', createdAt: '2026-10-20T10:00:00+08:00' });
  assert.equal(context.rows.value.at(-1).id, 5);
  updates.push({ id: 6, workDate: '2026-10-19', createdAt: '2026-10-20T09:00:00+08:00' });
  assert.equal(context.rows.value[0].id, 6);
});
