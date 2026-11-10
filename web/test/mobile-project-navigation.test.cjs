const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function execute(relative, names, modules, options = {}) {
  const filename = path.join(__dirname, '../src', relative);
  let source = fs.readFileSync(filename, 'utf8');
  if (relative.endsWith('.vue')) source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  source += `\nexports.subject = { ${names.join(', ')} };`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, URL, console, window: { matchMedia: () => ({ matches: true }) }, require(name) {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name === 'vue') return { ...vue, onMounted() {}, onActivated() {}, watch(getter, callback, config) {
      if (config?.immediate && !options.skipWatch) callback(getter());
      return () => {};
    } };
    if (name.endsWith('.vue')) return {};
    throw new Error(`Unstubbed dependency: ${name}`);
  } };
  vm.runInNewContext(code, context, { filename });
  return context.exports.subject;
}

const ordinaryMember = { isLoggedIn: true, readOnly: false, user: { id: 7, deptId: 1 }, has: () => false };
const fixtureTasks = [
  { id: 420, projectId: 42, parentId: null, title: 'Other department stage', status: 'doing' },
  { id: 421, projectId: 42, parentId: 420, title: 'Other department task', status: 'doing', creatorId: 90, assigneeId: 91, acceptorId: 92 },
  { id: 880, projectId: 88, parentId: null, title: 'Another project', status: 'todo' },
];
const fixtures = [{ id: 42, name: 'Visible unrelated project', planLocked: true }, { id: 88, name: 'Another project' }];
const common = {
  '@/utils/task-risk': { leafRisk: () => 0 },
  '@/utils/task-meta': { statusLabel: value => value, statusType: () => 'info' },
  '@/utils/ids': { toNumericId: Number },
  '@/stores/auth': { useAuthStore: () => ordinaryMember },
};

test('group notification retains project context and loads unrelated visible tasks for an ordinary member', async () => {
  let guard;
  execute('router/index.ts', [], {
    ...common,
    'vue-router': { createWebHistory: () => ({}), createRouter: () => ({ beforeEach: fn => { guard = fn; } }) },
    '@/stores/dailyReport': { useDailyReportStore: () => ({}) },
  });
  const destination = await guard({ path: '/projects/42', fullPath: '/projects/42?from=group', query: { from: 'group' }, meta: {} });
  assert.equal(destination.path, '/mobile/tasks');
  assert.equal(destination.query.projectId, '42');
  assert.equal(destination.query.from, 'group');

  const requests = [], navigations = [];
  const list = execute('views/mobile/MobileTasks.vue', ['load', 'groups', 'filterProject', 'open'], {
    ...common,
    'vue-router': { useRoute: () => ({ query: destination.query }), useRouter: () => ({ push: value => navigations.push(value) }) },
    '@/api': {
      tasksApi: { list: async params => { requests.push(params); return { list: params.mine ? [] : fixtureTasks }; } },
      projectsApi: { list: async () => fixtures },
    },
  });
  await list.load();
  assert.equal(requests.length, 1);
  assert.notEqual(requests[0].mine, true);
  assert.equal(list.filterProject.value, 42);
  assert.equal(list.groups.value.length, 1);
  assert.equal(list.groups.value[0].projectId, 42);
  assert.equal(list.groups.value[0].rows.length, 2);
  assert.equal(list.groups.value[0].rows[1].title, 'Other department task');
  list.open(list.groups.value[0].rows[1]);
  assert.equal(navigations[0].name, 'm-task');
  assert.equal(navigations[0].params.id, '421');
  list.filterProject.value = null;
  assert.equal(list.groups.value.length, 2);
});

test('overview task navigation preserves the selected project', () => {
  const navigations = [];
  const overview = execute('views/mobile/MobileOverview.vue', ['openTasks'], {
    ...common,
    'vue-router': { useRouter: () => ({ push: value => navigations.push(value) }) },
    '@/api': {},
    '@/stores/categories': { useCategoriesStore: () => ({ catMeta: () => ({}) }) },
  });
  overview.openTasks(42);
  assert.equal(navigations[0].path, '/mobile/tasks');
  assert.equal(String(navigations[0].query.projectId), '42');
});

test('overview exposes request failure and clears it after retry instead of reporting an empty success', async () => {
  let fail = true;
  const overview = execute('views/mobile/MobileOverview.vue', ['load', 'loadError', 'projects', 'loading'], {
    ...common,
    'vue-router': { useRouter: () => ({ push() {} }) },
    '@/api': {
      dashboardApi: { overview: async () => { if (fail) throw Error('Network unavailable'); return fixtures; } },
      departmentsApi: { list: async () => [] }, usersApi: { list: async () => [] },
    },
    '@/stores/categories': { useCategoriesStore: () => ({ catMeta: () => ({}) }) },
  });
  await overview.load();
  assert.equal(overview.loadError.value, 'Network unavailable');
  assert.equal(overview.loading.value, false);
  fail = false;
  await overview.load();
  assert.equal(overview.loadError.value, '');
  assert.equal(overview.projects.value.length, 2);
});

test('viewing an unrelated task does not grant work, approval, confirmation or progress permissions', async () => {
  const detail = execute('views/mobile/MobileTaskDetail.vue', ['load', 'task', 'canWork', 'canReview', 'canConfirm', 'canRestore', 'canWriteProcess'], {
    ...common,
    'vue-router': { useRoute: () => ({ params: { id: '421' }, query: {} }), onBeforeRouteLeave() {}, onBeforeRouteUpdate() {} },
    'element-plus': { ElMessage: { error: message => { throw new Error(message); } }, ElMessageBox: {} },
    '@/api': { tasksApi: { one: async () => ({ ...fixtureTasks[1], planLocked: true, projectStatus: 'active', projectDeptId: 2, projectOwnerIds: [90], canConfirm: false }), dailyUpdates: async () => [], assets: async () => [] } },
    '@/stores/refresh': { useRefreshStore: () => ({}) },
    '@/utils/task-assets': { assetLinksProgress: () => false },
    '@/utils/no-material-reason': { progressMaterialReason: () => '' },
    '@/utils/material-confirmation': { materialConfirmationMessage: () => '' },
    '@/utils/weekly-acceptance': { checkWeeklyProgressBeforeAcceptance: async () => true },
  }, { skipWatch: true });
  await detail.load();
  assert.equal(detail.task.value.id, 421);
  for (const permission of ['canWork', 'canReview', 'canConfirm', 'canRestore', 'canWriteProcess']) assert.equal(detail[permission].value, false, permission);
});

test('mobile task project collapses on first tap and reopens on second tap', () => {
  const list = execute('views/mobile/MobileTasks.vue', ['toggleProject', 'isProjectExpanded'], {
    ...common, 'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({}) }, '@/api': {},
  });
  assert.equal(list.isProjectExpanded(42), true);
  list.toggleProject(42);
  assert.equal(list.isProjectExpanded(42), false);
  list.toggleProject(42);
  assert.equal(list.isProjectExpanded(42), true);
});

test('overview filters projects by statistics while preserving totals and grouping', () => {
  const overview = execute('views/mobile/MobileOverview.vue', ['projects', 'stats', 'groups', 'statFilter', 'viewMode'], {
    ...common, 'vue-router': { useRouter: () => ({}) }, '@/api': {},
    '@/utils/task-risk': { leafRisk: task => task.risk || 0 },
    '@/stores/categories': { useCategoriesStore: () => ({ catMeta: () => ({}) }) },
  });
  overview.projects.value = [
    { id: 1, deptId: 1, stages: [{status:'done'}] },
    { id: 2, deptId: 2, stages: [{status:'doing',risk:1}] },
    { id: 3, deptId: 2, stages: [{status:'doing',risk:2}, {status:'todo',risk:1}] },
    { id: 4, deptId: 1, stages: [] },
  ];
  const ids = () => Array.from(overview.groups.value.flatMap(g => g.items.map(p => p.id))).sort();
  for (const [filter, expected] of [['done',[1]], ['dueSoon',[2]], ['overdue',[3]], ['all',[1,2,3,4]]]) {
    overview.statFilter.value = filter;
    assert.deepEqual(ids(), expected);
    assert.equal(overview.stats.value.total, 4);
  }
  overview.statFilter.value = 'overdue';
  overview.viewMode.value = 'owner';
  assert.deepEqual(ids(), [3]);
  overview.projects.value = [];
  assert.equal(overview.groups.value.length, 0);
});

test('mobile tasks exposes load failure and allows retry', async () => {
  let fail = true;
  const list = execute('views/mobile/MobileTasks.vue', ['load', 'loadError', 'loading', 'groups'], {
    ...common, 'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({}) },
    '@/api': { tasksApi: { list: async () => { if (fail) throw Error('offline'); return {list: fixtureTasks}; } }, projectsApi: {list: async () => fixtures} },
  });
  await list.load();
  assert.equal(list.loadError.value, 'offline');
  assert.equal(list.loading.value, false);
  fail = false;
  await list.load();
  assert.equal(list.loadError.value, '');
  assert.equal(list.groups.value.length, 2);
});

test('overview risk links do not silently restrict an ordinary member to participating projects', () => {
 const page = execute('views/Projects.vue', ['showMine'], {
  ...common,
  'vue-router': {useRoute:()=>({query:{riskFilter:'atRisk'}}),useRouter:()=>({})},
  '@/api': {}, '@/stores/categories': {useCategoriesStore:()=>({list:[]})},
  '@/stores/refresh': {useRefreshStore:()=>({snapshot:()=>({})})},
  'element-plus': {}, '@element-plus/icons-vue': {},
  '@/utils/project-owner': {},
 }, {skipWatch:true});
 assert.equal(page.showMine.value,false);
});
