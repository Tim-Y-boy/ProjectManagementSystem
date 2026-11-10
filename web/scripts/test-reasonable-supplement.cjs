const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse, compileTemplate } = require('@vue/compiler-sfc');
const { createSSRApp, h } = require('vue');
const { renderToString } = require('@vue/server-renderer');
const file = path.join(__dirname, '../src/views/Tasks.vue');
const { descriptor } = parse(fs.readFileSync(file, 'utf8'));
const source = ts.createSourceFile(file + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['exemptDisabledReason', 'exemptUpdate'].includes(n.name?.text));
assert.equal(functions.length, 2);
const context = vm.createContext({ exemptTarget: { value: null }, exemptReason: { value: '' }, exemptDialogVisible: { value: false } });
context.isDetailFrozen = { value: false };
vm.runInContext(ts.transpileModule(functions.map(n => n.getText(source)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const template = descriptor.template.content;
const start = template.indexOf('<div class="daily-footer">');
const end = template.indexOf('</div>', template.indexOf('</details>', start)) + 6;
assert.ok(start > 0 && end > start);
const compiled = compileTemplate({ source: template.slice(start, end), filename: file, id: 'supplement-action' });
assert.deepEqual(compiled.errors, []);
const mod = { exports: {} };
const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports);
async function render(update) {
  const app = createSSRApp({ render: mod.exports.render, setup: () => ({
    u: { id: 7, status: 'normal', ...update }, canManageDetailProject: true, canEditDetailProcess: false,
    canModifyDailyUpdate: () => false, canDeleteDailyUpdate: () => false,
    exemptDisabledReason: context.exemptDisabledReason, exemptUpdate() {}, unexemptUpdate() {},
  }) });
  app.component('el-button', { setup: (_, { slots }) => () => h('button', slots.default?.()) });
  return renderToString(app);
}
test('ineligible records keep an accessible explanation collapsed to reduce card height', async () => {
  for (const reason of ['未超过任务截止日期，无需确认合理补填', '工作日期已超过任务截止日期，不能确认为合理补填。']) {
    const html = await render({ exemptDisabledReason: reason });
    assert.match(html, /<button[^>]* disabled/);
    assert.ok(html.indexOf(reason) > html.indexOf('</button>'));
    assert.match(html, /aria-describedby="exempt-disabled-7"/);
    assert.match(html, /id="exempt-disabled-7"/);
    assert.match(html, /补填说明/);
    assert.doesNotMatch(html, /<details[^>]* open/);
  }
});
test('eligible records have enabled action; historical confirmed records keep reversal', async () => {
  const html = await render({ exemptDisabledReason: '' });
  assert.match(html, /确认合理补填/);
  assert.doesNotMatch(html, /<button[^>]* disabled|exempt-disabled-7/);
  const old = await render({ status: 'exempted', exemptDisabledReason: '旧记录' });
  assert.match(old, /撤销合理补填/);
  assert.doesNotMatch(old, /确认合理补填|旧记录/);
});
test('disabled or missing eligibility does not open dialog, eligible records still do', () => {
  for (const update of [{ exemptDisabledReason: '不符合条件' }, {}]) {
    context.exemptDialogVisible.value = false;
    context.exemptUpdate(update);
    assert.equal(context.exemptDialogVisible.value, false);
  }
  context.exemptUpdate({ id: 7, exemptDisabledReason: '' });
  assert.equal(context.exemptDialogVisible.value, true);
});
