const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

test('weekly owner selector defaults sole owner, limits options, and clears a removed choice', async () => {
  const file = fs.readFileSync(require('node:path').join(__dirname, '../src/components/WeeklyReportOwnerSelect.vue'), 'utf8');
  const source = parse(file).descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, '');
  const props = vue.reactive({ ownerIds: [1], users: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }], modelValue: null });
  const context = { ...vue, defineProps: () => props, defineEmits: () => (_, value) => { props.modelValue = value; } };
  vm.runInNewContext(ts.transpileModule(source + '\nglobalThis.result={ids,options};', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  assert.equal(props.modelValue, 1);
  props.ownerIds = [1, 2]; await vue.nextTick();
  assert.equal(context.result.options.value.length, 2);
  props.modelValue = 3; await vue.nextTick(); assert.equal(props.modelValue, null);
  props.modelValue = 2; await vue.nextTick(); assert.equal(props.modelValue, 2);
  props.ownerIds = [1]; await vue.nextTick(); assert.equal(props.modelValue, 1);
  props.ownerIds = []; await vue.nextTick(); assert.equal(props.modelValue, null);
});
