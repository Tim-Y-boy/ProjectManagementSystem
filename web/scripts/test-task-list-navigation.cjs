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
const names = ['load', 'readFocusParams', 'openWeeklyProgressFromRoute', 'buildTreeRows',
  'flattenTaskTree', 'pruneRootsByQuickFilter', 'pruneTasksByQuickFilter', 'quickTaskMatches',
  'sortTaskTree', 'compareTaskOrder', 'annotateRisk', 'collectCollapsedTasks', 'uncollapse', 'toggleProject'];
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map(n => n.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup(query = {}) {
  // API bigint IDs arrive as strings. Two populated projects plus a genuinely empty one.
  const projects = [
    { id: '11', deptId: '1', name: '设备项目', ownerId: '7' },
    { id: '32', deptId: '2', name: '采购项目', ownerId: '7' },
    { id: '33', deptId: '2', name: '空项目', ownerId: '7' },
  ];
  const tasks = [
    { id: '101', projectId: '11', parentId: null, title: '设备任务', status: 'done', assigneeId: '8' },
    { id: '201', projectId: '32', parentId: null, title: '采购阶段', status: 'doing', assigneeId: '7' },
    { id: '202', projectId: '32', parentId: '201', title: '风险与报表', status: 'doing', assigneeId: '7' },
  ];
  const ref = value => ({ value });
  const requests = [], opens = [];
  const c = {
    route: { query, hash: '#tasks' }, filterStatus: ref(''), filterAssignee: ref(null),
    filterProject: ref(null), filterDept: ref(null), quickFilter: ref(''), showMine: ref(false),
    focusedProjectId: ref(null), focusedOnlyProjectId: ref(null), focusedTaskId: ref(null),
    allTasks: ref([]), projects: ref([]), users: ref([]), depts: ref([]), list: ref([]),
    projectGroups: ref([]), groupRoots: ref([]), stats: ref({}), loading: ref(false), hasLoaded: ref(false),
    collapsedDepts: ref(new Set()), collapsedProjects: ref(new Set()), collapsedTasks: ref(new Set()),
    collapseReady: ref(false), seenRefreshVersions: ref({}), refreshStore: { snapshot: () => ({}) },
    auth: { user: { id: 7 } }, isOwnerOf: (p, id) => String(p.ownerId) === String(id),
    // Sorting/risk dates and DOM scrolling are outside this navigation regression.
    compareDeptGroups: () => 0, compareProjectGroups: () => 0, leafRisk: () => 0, riskDays: () => null,
    focusFocusedTask() {}, focusFocusedProject() {},
    detail: ref(null), dailyForm: ref({ content: '', workDate: '' }), processSaving: ref(false),
    editingDailyUpdateId: ref(null), openedWeeklyProgressKey: '', todayText: () => '2026-10-12',
    tasksApi: { list: async q => {
      requests.push(q);
      return { list: tasks.filter(t => (!q.projectId || String(t.projectId) === String(q.projectId))
        && (!q.status || t.status === q.status) && (!q.assigneeId || String(t.assigneeId) === String(q.assigneeId))) };
    } },
    projectsApi: { list: async () => projects }, usersApi: { list: async () => [] },
    departmentsApi: { list: async () => [] },
  };
  c.openDetail = async (task, tab) => { opens.push([task.id, tab]); c.detail.value = task; };
  c.router = { replace: async location => { c.route.query = location.query; c.route.hash = location.hash; } };
  vm.createContext(c);
  vm.runInContext(code, c);
  const groups = () => c.projectGroups.value.flatMap(dept => dept.projects);
  const ids = () => Array.from(groups(), group => String(group.projectId)).sort();
  return { c, requests, opens, groups, ids };
}

test('weekly link opens the target form while other projects retain their real tasks', async () => {
  const f = setup({ projectId: '32', taskId: '202', weekStart: '2026-10-05', other: 'keep' });
  f.c.readFocusParams();
  await f.c.load();
  assert.equal(f.requests[0].projectId, undefined);
  assert.deepEqual(f.ids(), ['11', '32', '33']);
  const other = f.groups().find(g => g.projectId === '11');
  assert.equal(other.tasks[0].title, '设备任务');
  f.c.toggleProject('11');
  assert.equal(f.c.collapsedProjects.value.has('11'), false);
  assert.deepEqual(f.opens, [['202', 'updates']]);
  assert.equal(f.c.dailyForm.value.workDate, '2026-10-05');
  assert.equal(f.c.collapsedProjects.value.has('32'), false);
  assert.equal(f.c.collapsedTasks.value.has('201'), false);
});

test('consumed weekly link stays unfiltered on reload and preserves task focus and unrelated query', async () => {
  const f = setup({ projectId: '32', taskId: '202', weekStart: '2026-10-05', other: 'keep' });
  f.c.readFocusParams();
  await f.c.load();
  assert.equal(f.c.route.query.projectId, undefined);
  assert.equal(f.c.route.query.focusProject, '32');
  assert.equal(f.c.route.query.weekStart, undefined);
  assert.equal(f.c.route.query.taskId, '202');
  assert.equal(f.c.route.query.other, 'keep');
  assert.equal(f.c.route.hash, '#tasks');
  f.c.readFocusParams();
  await f.c.load();
  assert.equal(f.c.filterProject.value, null);
  assert.equal(f.opens.length, 1);
  assert.equal(f.groups().find(g => g.projectId === '11').tasks.length, 1);
});

test('an explicit project filter only shows its project; clearing restores the others', async () => {
  const f = setup({ projectId: '32', taskId: '202' });
  f.c.readFocusParams();
  await f.c.load();
  assert.deepEqual(f.ids(), ['32']);
  assert.equal(f.groups()[0].tasks[0].children[0].title, '风险与报表');
  f.c.filterProject.value = null;
  await f.c.load();
  assert.deepEqual(f.ids(), ['11', '32', '33']);
  assert.equal(f.groups().find(g => g.projectId === '11').tasks.length, 1);
});

test('an explicitly selected empty project remains available to add its first task', async () => {
  const f = setup();
  f.c.filterProject.value = 33;
  await f.c.load();
  assert.deepEqual(f.ids(), ['33']);
  assert.equal(f.groups()[0].tasks.length, 0);
});

test('task status and assignee filters do not backfill nonmatching projects as empty', async () => {
  const f = setup();
  f.c.filterStatus.value = 'doing';
  await f.c.load();
  assert.deepEqual(f.ids(), ['32']);
  f.c.filterStatus.value = '';
  f.c.filterAssignee.value = 8;
  await f.c.load();
  assert.deepEqual(f.ids(), ['11']);
});

test('focus-only links and department filters keep their existing scope', async () => {
  const f = setup({ focusProject: '32', taskId: '202' });
  f.c.readFocusParams();
  await f.c.load();
  assert.deepEqual(f.ids(), ['11', '32', '33']);
  f.c.filterDept.value = 1;
  await f.c.load();
  assert.deepEqual(f.ids(), ['11']);
});
