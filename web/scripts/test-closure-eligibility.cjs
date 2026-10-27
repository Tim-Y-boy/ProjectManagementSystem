const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/project-owner.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInThisContext(`(function(module,exports){${code}\n})`)(mod, mod.exports);
const canApply = (p, uid = 16) => mod.exports.canApplyProjectClosure(p, uid);
const complete = { status: 'active', planLocked: true, closureState: 'none', ownerIds: ['16'], taskCount: 8, doneCount: 8 };

test('closure entry requires every effective task completed, including earlier tasks', () => {
  assert.equal(canApply(complete), true);
  for (const doneCount of [0, 5, 7]) assert.equal(canApply({ ...complete, doneCount }), false);
  assert.equal(canApply({ ...complete, taskCount: 0, doneCount: 0 }), false);
  assert.equal(canApply({ ...complete, taskCount: undefined, doneCount: undefined }), false);
  assert.equal(canApply({ ...complete, taskCount: '8', doneCount: '8' }), true);
});
test('closure entry requires finalized active project and its owner, without an existing closure', () => {
  assert.equal(canApply(complete, 1), false);
  assert.equal(canApply(null), false);
  assert.equal(canApply({ ...complete, planLocked: false }), false);
  assert.equal(canApply({ ...complete, status: 'archived' }), false);
  for (const closureState of ['pending', 'closed']) assert.equal(canApply({ ...complete, closureState }), false);
});

test('administrator has the same completed-project entry but cannot bypass readiness', () => {
  const adminCanApply = p => mod.exports.canApplyProjectClosure(p, 1, true);
  assert.equal(adminCanApply(complete), true);
  assert.equal(adminCanApply(null), false);
  for (const patch of [{doneCount:7},{planLocked:false},{closureState:'pending'},{status:'archived'},{taskCount:0,doneCount:0}]) {
    assert.equal(adminCanApply({...complete,...patch}), false);
  }
});
