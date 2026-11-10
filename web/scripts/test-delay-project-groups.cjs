const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

function fixture(records) {
  const file = path.join(__dirname, '../src/components/closures/DelayProjectGroups.vue');
  const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
  const source = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
  const props = vue.reactive({ records, labels: {} });
  const context = { ...vue, defineProps: () => props, defineEmits: () => () => {} };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
  return { props, read: expression => vm.runInContext(expression, context) };
}
const row = (id, project, state = 'open') => ({ id, project_id: project, handling_status: state, snapshot: { projectName: '同名项目' } });

test('groups by project ID, preserves every historical row and original record order', () => {
  const f = fixture([row(1, 32), row(2, 33), row(3, '32', 'processing'), row(4, 32, 'resolved')]);
  assert.equal(f.read('groups.value.length'), 2);
  assert.equal(f.read('groups.value[0].records.map(r => r.id).join(",")'), '1,3,4');
  assert.equal(f.read('groups.value[0].open'), 1);
  assert.equal(f.read('groups.value[0].processing'), 1);
  assert.equal(f.read('groups.value[1].records[0].id'), 2);
});

test('filtering updates group membership and counts; all groups start expanded', () => {
  const f = fixture([row(1, 32), row(2, 33), row(3, 32, 'resolved')]);
  assert.equal(f.read('collapsed.value.size'), 0);
  f.read("toggle('32')");
  assert.equal(f.read("collapsed.value.has('32')"), true);
  assert.equal(f.read("collapsed.value.has('33')"), false);
  f.props.records = [row(3, 32, 'resolved')];
  assert.equal(f.read('groups.value.length'), 1);
  assert.equal(f.read('groups.value[0].records.length'), 1);
  assert.equal(f.read('groups.value[0].open'), 0);
  f.read("toggle('32')");
  assert.equal(f.read('collapsed.value.size'), 0);
  f.props.records = [];
  assert.equal(f.read('groups.value.length'), 0);
});

test('multiple projects share one table header with distinct expandable project rows', async () => {
  const { compileScript } = require('@vue/compiler-sfc');
  const { renderToString } = require('@vue/server-renderer');
  const filename = path.join(__dirname, '../src/components/closures/DelayProjectGroups.vue');
  const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'delay-group-test', inlineTemplate: true });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const mod = { exports: {} };
  const req = id => id === '@/utils/date-time' ? { formatBeijingTime: value => value || '—' } : require(id);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(req, mod, mod.exports);
  const app = vue.createSSRApp(mod.exports.default, { records: [row(1, 32), row(2, 33)], labels: {} });
  for (const name of ['el-tag', 'el-icon', 'el-button', 'el-empty']) {
    app.component(name, { setup: (_, { slots }) => () => vue.h(name === 'el-button' ? 'button' : 'span', slots.default?.()) });
  }
  const html = await renderToString(app);
  assert.equal((html.match(/<thead>/g) || []).length, 1);
  assert.equal((html.match(/scope="col"/g) || []).length, 7);
  assert.equal((html.match(/class="project-heading"/g) || []).length, 2);
  assert.equal((html.match(/查看详情/g) || []).length, 2);
  assert.match(html, /aria-controls="delay-project-32"/);
  assert.match(html, /aria-controls="delay-project-33"/);
});
