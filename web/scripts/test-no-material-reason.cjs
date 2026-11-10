const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const options = { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } };
const reasons = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/no-material-reason.ts'), 'utf8'), options).outputText, reasons);

function fixture(value = '') {
  const props = vue.reactive({ modelValue: value, disabled: false });
  const script = parse(fs.readFileSync(path.join(__dirname, '../src/components/NoMaterialReasonSelect.vue'), 'utf8')).descriptor.scriptSetup.content;
  const source = ts.createSourceFile('reason.ts', script, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
  const ctx = { ...vue, ...reasons.exports, defineProps: () => props, withDefaults: value => value,
    defineEmits: () => (_, value) => { props.modelValue = value; } };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(body, options).outputText, ctx);
  return { props, run: code => vm.runInContext(code, ctx) };
}

test('reason selector has no default; presets save readable text and Other requires actual explanation', async () => {
  const f = fixture();
  assert.equal(f.run('choice.value'), '');
  f.run('select(NO_MATERIAL_REASONS[0])');
  await vue.nextTick();
  assert.equal(f.props.modelValue, reasons.exports.NO_MATERIAL_REASONS[0]);
  f.run("select('other')");
  await vue.nextTick();
  assert.equal(f.run('choice.value'), 'other');
  assert.equal(f.props.modelValue, '');
  f.run("update('仅现场协调，无文件')");
  await vue.nextTick();
  assert.equal(f.props.modelValue, '仅现场协调，无文件');
  f.props.modelValue = '';
  await vue.nextTick();
  assert.equal(f.run('choice.value'), '');
});

test('legacy free text remains editable and saved reasons are deduplicated without truncating', async () => {
  const f = fixture('之前填写的原因');
  assert.equal(f.run('choice.value'), 'other');
  assert.equal(f.props.modelValue, '之前填写的原因');
  f.props.modelValue = reasons.exports.NO_MATERIAL_REASONS[1];
  await vue.nextTick();
  assert.equal(f.run('choice.value'), reasons.exports.NO_MATERIAL_REASONS[1]);
  assert.equal(reasons.exports.progressMaterialReason([
    { noMaterialReason: ' 原因甲 ' }, { noMaterialReason: '原因甲' }, { noMaterialReason: null },
    { noMaterialReason: '原因乙' },
  ]), ['原因甲', '原因乙'].sort().join('\n'));
});
