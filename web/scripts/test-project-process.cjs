const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/project-process.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const context = { exports: {} }; vm.runInNewContext(code, context);
const { collectTaskProcess } = context.exports;
test('parent includes nested descendants and own records, excluding other tasks and duplicate assets', () => {
  const task = { id: 1, children: [{ id: 2, children: [{ id: 3 }] }] };
  const updates = [1, 2, 3, 4].map(id => ({ id, taskId: id }));
  const assets = [{ id: 10, taskId: 2 }, { id: 10, taskId: 2 }, { id: 11, taskId: 3 }, { id: 12, taskId: 4 }];
  const result = collectTaskProcess(task, updates, assets);
  assert.equal(result.updates.length, 3);
  assert.equal(result.assets.length, 2);
  assert.equal(collectTaskProcess({ id: 2 }, updates, assets).updates.length, 1);
  assert.equal(collectTaskProcess({ id: 5 }, updates, assets).assets.length, 0);
});
