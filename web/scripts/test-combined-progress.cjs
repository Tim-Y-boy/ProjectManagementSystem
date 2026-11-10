const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const assetModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/task-assets.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, assetModule);
const reasonModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/no-material-reason.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, reasonModule);

const file = path.join(__dirname, '../src/views/Tasks.vue');
const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
const source = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
const names = ['checkAcceptanceWeekly', 'canTransitionWithProcessDraft', 'hasValidTaskMaterials', 'hasProgressMaterials', 'submitDailyUpdate', 'queueLinkAsset', 'queueLocalAsset', 'chooseFeishuDoc', 'acceptanceMaterialReason', 'confirmAcceptanceMaterials', 'openWeeklyProgressFromRoute', 'discardProcessDraft', 'editDailyUpdate', 'revealProgressEditor'];
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map(n => n.getText(source)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;

function setup() {
  const calls = { saves: [], warnings: [], prompts: [], confirms: [], replaces: [] };
  const c = {
    ...assetModule.exports, progressMaterialReason: reasonModule.exports.progressMaterialReason,
    materialConfirmationMessage: reason => reason,
    checkWeeklyProgressBeforeAcceptance: async () => true,
    URL, FormData, isMessageShown: e => !!e?.messageShown, pendingAssetKey: 0, openedWeeklyProgressKey: '', feishuPickerVisible: { value: true },
    dailyUpdates: { value: [] }, detail: { value: { id: 9 } }, processSaving: { value: false }, canEditDetailProcess: { value: true }, processLockTip: { value: '' },
    dailyForm: { value: { workDate: '2026-10-08', content: '完成评审', risk: '', nextPlan: '', noMaterialReason: '' } },
    assetForm: { value: { title: '', url: '', description: '' } }, pendingAssets: { value: [] },
    selectedExistingAssetIds: { value: [] }, taskAssets: { value: [] }, editingDailyUpdateId: { value: null }, supplementOnly: { value: false },
    nextTick: async () => {}, progressEditor: { value: null }, canModifyDailyUpdate: () => true,
    window: { getComputedStyle: () => ({ position: 'sticky' }) },
    toNumericId: Number, refreshStore: { markTaskChanged() {} }, reloadTaskProcess: async () => {},
    route: { query: {} }, allTasks: { value: [{ id: 9 }] }, todayText: () => '2026-10-08', openDetail: async () => {},
    tasksApi: {
      saveProgress: async (task, data) => { calls.saves.push({ task, payload: JSON.parse(data.get('payload')), files: data.getAll('files') }); return { id: '42' }; },
      assets: async () => [], dailyUpdates: async () => [{ noMaterialReason: '  无实体产出  ' }], one: async () => ({ materialExemptionReason: '无实体产出' }),
    },
    ElMessage: { warning: text => calls.warnings.push(text), success() {} },
    ElMessageBox: {
      prompt: async (...args) => { calls.prompts.push(args); return { value: '  无实体产出  ' }; },
      confirm: async (...args) => { calls.confirms.push(args); },
    },
  };
  c.router = { replace: async location => { calls.replaces.push(location); c.route.query = location.query; } };
  c.resetAssetForm = () => { c.assetForm.value = { title: '', url: '', description: '' }; };
  c.resetDailyForm = () => { c.pendingAssets.value = []; c.selectedExistingAssetIds.value = []; c.dailyForm.value.content = ''; c.dailyForm.value.noMaterialReason = ''; };
  // Existing scenarios model a user choosing the matching material branch.
  c.materialChoice = { get value() { return c.supplementOnly.value || c.hasProgressMaterials() ? 'yes' : 'no'; }, set value(_) {} };
  c.materialSource = { value: 'file' };
  vm.createContext(c);
  vm.runInContext(code, c);
  return { c, calls };
}
test('material choice is required before saving and yes cannot silently fall back to a reason', async () => {
  const { c, calls } = setup();
  c.materialChoice = { value: '' };
  c.dailyForm.value.noMaterialReason = '现场工作';
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.materialChoice.value = 'yes';
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
});
test('no-material branch ignores hidden file/link drafts without destroying them on failure', async () => {
  const { c, calls } = setup();
  c.materialChoice = { value: 'no' };
  c.dailyForm.value.noMaterialReason = '现场沟通';
  c.assetForm.value.url = 'invalid hidden draft';
  c.pendingAssets.value = [{ key: 1, file: new Blob(['draft']) }];
  c.selectedExistingAssetIds.value = [7];
  const save = c.tasksApi.saveProgress;
  c.tasksApi.saveProgress = async (...args) => { await save(...args); throw new Error('offline'); };
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].payload.noMaterialReason, '现场沟通');
  assert.equal(calls.saves[0].payload.links.length, 0);
  assert.equal(calls.saves[0].payload.existingAssetIds.length, 0);
  assert.equal(calls.saves[0].files.length, 0);
  assert.equal(c.pendingAssets.value.length, 1);
  assert.equal(c.assetForm.value.url, 'invalid hidden draft');
});

test('atomic save failure preserves the entire draft for retry', async () => {
  const { c, calls } = setup();
  c.pendingAssets.value = [{ key: 1, title: '纪要', url: 'https://example.com/a' }, { key: 2, title: '附件', file: new Blob(['ok']) }];
  let fail = true;
  const save = c.tasksApi.saveProgress;
  c.tasksApi.saveProgress = async (...args) => { if (fail) throw new Error('offline'); return save(...args); };
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  assert.equal(c.dailyForm.value.content, '完成评审');
  assert.equal(c.pendingAssets.value.length, 2);
  fail = false;
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].files.length, 1);
  assert.equal(calls.saves[0].payload.links.length, 1);
  assert.equal(c.pendingAssets.value.length, 0);
});

test('HTTP errors already displayed are not displayed again and keep the draft', async () => {
  const { c, calls } = setup();
  c.dailyForm.value.noMaterialReason = 'No file';
  c.tasksApi.saveProgress = async () => { throw Object.assign(new Error('Cannot POST'), { messageShown: true }); };
  await c.submitDailyUpdate();
  assert.equal(calls.warnings.length, 0);
  assert.equal(c.dailyForm.value.content, '完成评审');
});

test('supplementing an existing completed record creates only assets', async () => {
  const { c, calls } = setup();
  c.supplementOnly.value = true;
  c.editingDailyUpdateId.value = 17;
  c.assetForm.value = { title: '文档', url: 'https://example.com/b', description: '' };
  await c.submitDailyUpdate();
  assert.equal(calls.saves[0].payload.updateId, 17);
  assert.equal(calls.saves[0].payload.materialsOnly, true);
});

test('text-only progress needs a reason; permission and busy guards prevent saving', async () => {
  const { c, calls } = setup();
  c.canEditDetailProcess.value = false;
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.canEditDetailProcess.value = true;
  c.processSaving.value = true;
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.processSaving.value = false;
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  for (const reason of ['   ', 'x'.repeat(501)]) {
    c.dailyForm.value.noMaterialReason = reason;
    await c.submitDailyUpdate();
    assert.equal(calls.saves.length, 0);
  }
  c.dailyForm.value.noMaterialReason = '  现场沟通，无文件产出  ';
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].payload.noMaterialReason, '现场沟通，无文件产出');
});

test('invalid links and oversized files stay out of the queue', async () => {
  const { c, calls } = setup();
  c.assetForm.value = { title: '链接', url: 'javascript:alert(1)', description: '' };
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.queueLocalAsset({ raw: { name: 'large.pdf', size: 51 * 1024 * 1024 } });
  assert.equal(c.pendingAssets.value.length, 0);
  assert.equal(c.assetForm.value.url, 'javascript:alert(1)');
});

test('materials from another progress or unlinked materials cannot replace this progress evidence', async () => {
  const { c, calls } = setup();
  c.taskAssets.value = [{ dailyUpdateId: 15, filePath: 'uploads/existing.pdf' }, { dailyUpdateId: null, url: 'https://example.com/old' }];
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.editingDailyUpdateId.value = 17;
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.taskAssets.value.push({ dailyUpdateId: '17', url: 'https://example.com/current' });
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
});

test('file count and aggregate size are checked before sending', async () => {
  const { c, calls } = setup();
  c.pendingAssets.value = Array.from({ length: 31 }, (_, key) => ({ key, file: { size: 1 } }));
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  c.pendingAssets.value = Array.from({ length: 5 }, (_, key) => ({ key, file: { size: 50 * 1024 * 1024 } }));
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
});

test('one save accepts multiple pasted links without requiring names', async () => {
  const { c, calls } = setup();
  c.assetForm.value.url = 'https://example.com/a\nhttps://docs.example.com/b';
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
  assert.deepEqual(calls.saves[0].payload.links.map(asset => asset.title), ['example.com', 'docs.example.com']);
  assert.equal(calls.saves[0].payload.noMaterialReason, '');
});

test('an invalid line preserves the whole draft before creating progress', async () => {
  const { c, calls } = setup();
  const draft = 'https://example.com/a\ninvalid-link';
  c.assetForm.value.url = draft;
  c.pendingAssets.value = [{ key: 1, title: 'file.pdf', file: new Blob(['ok']) }];
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 0);
  assert.equal(c.pendingAssets.value.length, 1);
  assert.equal(c.assetForm.value.url, draft);
});

test('choosing a Feishu document preserves pasted links and uses the document name', () => {
  const { c } = setup();
  c.assetForm.value.url = 'https://example.com/pasted';
  c.chooseFeishuDoc({ title: 'Review document', url: 'https://example.feishu.cn/docx/123' });
  assert.equal(c.pendingAssets.value[0].title, 'Review document');
  assert.equal(c.assetForm.value.url, 'https://example.com/pasted');
  assert.equal(c.feishuPickerVisible.value, false);
});

test('editing simplified progress preserves historical optional fields', async () => {
  const { c, calls } = setup();
  c.editingDailyUpdateId.value = 17;
  c.taskAssets.value = [{ dailyUpdateId: '17', url: 'https://example.com/existing' }];
  Object.assign(c.dailyForm.value, { risk: 'old risk', nextPlan: 'old plan', affectDueDate: true });
  await c.submitDailyUpdate();
  const payload = calls.saves[0].payload;
  assert.equal(payload.risk, 'old risk');
  assert.equal(payload.nextPlan, 'old plan');
  assert.equal(payload.affectDueDate, true);
});

test('submission confirms saved reasons without asking the user to re-enter them', async () => {
  const { c, calls } = setup();
  c.tasksApi.assets = async () => [{ id: 5, dailyUpdateId: null, filePath: 'uploads/evidence.pdf' }];
  assert.equal(await c.acceptanceMaterialReason({ id: 9 }), '');
  assert.equal(calls.prompts.length, 0);
  c.tasksApi.assets = async () => [];
  assert.equal(await c.acceptanceMaterialReason({ id: 9 }), '无实体产出');
  assert.equal(calls.prompts.length, 0);
  assert.match(calls.confirms[0][0], /无实体产出/);
  c.ElMessageBox.confirm = async () => { throw 'cancel'; };
  assert.equal(await c.acceptanceMaterialReason({ id: 9 }), null);
});

test('historical progress without a saved reason requires progress correction, not another prompt', async () => {
  const { c, calls } = setup();
  c.tasksApi.dailyUpdates = async () => [{ noMaterialReason: '  ' }];
  assert.equal(await c.acceptanceMaterialReason({ id: 9 }), null);
  assert.equal(calls.prompts.length, 0);
  assert.equal(calls.confirms.length, 0);
  assert.match(calls.warnings[0], /进展与资料/);
});

test('reviewer must explicitly confirm the current no-material reason', async () => {
  const { c, calls } = setup();
  assert.equal(await c.confirmAcceptanceMaterials({ id: 9 }), true);
  assert.match(calls.confirms[0][0], /无实体产出/);
  c.ElMessageBox.confirm = async () => { throw 'cancel'; };
  assert.equal(await c.confirmAcceptanceMaterials({ id: 9 }), false);
  c.tasksApi.one = async () => ({ materialExemptionReason: '' });
  assert.equal(await c.confirmAcceptanceMaterials({ id: 9 }), false);
});

test('empty records and invalid URLs do not bypass submission reason or reviewer confirmation', async () => {
  for (const asset of [{}, { filePath: '  ', url: '' }, { url: 'javascript:alert(1)' }, { url: 'not-a-url' }, { url: 'ftp://example.com/file' }]) {
    const { c, calls } = setup();
    c.tasksApi.assets = async () => [asset];
    assert.equal(await c.acceptanceMaterialReason({ id: 9 }), '无实体产出');
    assert.equal(calls.prompts.length, 0);
    assert.equal(await c.confirmAcceptanceMaterials({ id: 9 }), true);
    assert.equal(calls.confirms.length, 2);
  }
  for (const asset of [{ filePath: 'uploads/evidence.pdf' }, { url: 'https://example.com/doc' }, { url: 'http://example.com/doc' }]) {
    const { c, calls } = setup();
    c.tasksApi.assets = async () => [asset];
    assert.equal(await c.acceptanceMaterialReason({ id: 9 }), '');
    assert.equal(await c.confirmAcceptanceMaterials({ id: 9 }), true);
    assert.equal(calls.prompts.length, 0);
    assert.equal(calls.confirms.length, 0);
  }
});

test('unfinished progress/materials block transitions for the same task only', () => {
  for (const draft of [
    c => { c.processSaving.value = true; },
    c => { c.dailyForm.value.noMaterialReason = '未保存原因'; },
    c => { c.pendingAssets.value = [{ key: 1, title: '待上传文件' }]; },
    c => { c.assetForm.value.url = 'https://example.com/draft'; },
    c => { c.dailyForm.value.content = '未保存正文'; },
  ]) {
    const { c, calls } = setup();
    c.dailyForm.value.content = '';
    draft(c);
    assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), false);
    assert.equal(calls.warnings.length, 1);
    assert.equal(c.canTransitionWithProcessDraft({ id: 10 }), true);
  }
});

test('unchanged loaded progress and supplement mode do not permanently block transitions', () => {
  const { c } = setup();
  c.editingDailyUpdateId.value = 42;
  c.dailyUpdates.value = [{ id: '42', ...c.dailyForm.value }];
  assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), true);
  c.dailyForm.value.risk = '新风险';
  assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), false);
  c.supplementOnly.value = true;
  assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), true);
  c.pendingAssets.value = [{ key: 1, title: '待保存资料' }];
  assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), false);
});

test('weekly reminder opens progress and prefills only valid nonfuture dates without overwriting text', async () => {
  const { c } = setup();
  const opened = [];
  c.openDetail = async (...args) => opened.push(args);
  c.dailyForm.value.content = '';
  for (const weekStart of ['bad-date', '2026-02-30', '2026-12-01']) {
    c.route.query = { taskId: '9', weekStart };
    await c.openWeeklyProgressFromRoute();
  }
  assert.equal(opened.length, 0);
  c.route.query = { taskId: '9', weekStart: '2026-09-28' };
  await c.openWeeklyProgressFromRoute();
  assert.equal(opened[0][1], 'updates');
  assert.equal(c.dailyForm.value.workDate, '2026-09-28');
  c.dailyForm.value.content = '未保存草稿';
  c.route.query.weekStart = '2026-10-05';
  await c.openWeeklyProgressFromRoute();
  assert.equal(c.dailyForm.value.workDate, '2026-09-28');
});

test('weekly auto-open is consumed after success; refresh keeps focus but does not reopen the dialog', async () => {
  const { c, calls } = setup();
  let opens = 0;
  c.openDetail = async () => { opens++; };
  c.route.query = { projectId: '32', taskId: '9', weekStart: '2026-09-28', other: 'keep' };
  c.route.hash = '#tasks';
  await c.openWeeklyProgressFromRoute();
  assert.equal(opens, 1);
  assert.equal(c.route.query.weekStart, undefined);
  assert.equal(c.route.query.taskId, '9');
  assert.equal(c.route.query.projectId, undefined);
  assert.equal(c.route.query.focusProject, '32');
  assert.equal(c.route.query.other, 'keep');
  assert.equal(calls.replaces[0].hash, '#tasks');
  c.openedWeeklyProgressKey = ''; // A browser reload loses the in-memory guard.
  await c.openWeeklyProgressFromRoute();
  assert.equal(opens, 1);
  c.route.query.weekStart = '2026-09-28'; // Another click on the reminder still opens it.
  await c.openWeeklyProgressFromRoute();
  assert.equal(opens, 2);
});

test('failed or cancelled weekly opening retains the link for retry and cannot consume a newer route', async () => {
  const { c, calls } = setup();
  c.route.query = { taskId: '9', weekStart: '2026-09-28' };
  c.openDetail = async () => { throw Error('load failed'); };
  await assert.rejects(c.openWeeklyProgressFromRoute(), /load failed/);
  assert.equal(calls.replaces.length, 0);
  c.openDetail = async () => { c.detail.value = { id: 10 }; };
  await c.openWeeklyProgressFromRoute();
  assert.equal(calls.replaces.length, 0);
  c.openDetail = async () => { c.detail.value = { id: 9 }; c.route.query = { taskId: '10', weekStart: '2026-10-05' }; };
  await c.openWeeklyProgressFromRoute();
  assert.equal(calls.replaces.length, 0);
  assert.equal(c.route.query.weekStart, '2026-10-05');
});


test('desktop missing-week entry opens progress on that task and presets its work date', async () => {
  const { c } = setup(); c.dailyForm.value.content = '';
  const opened = [];
  c.openDetail = async (task, tab) => { opened.push([task.id, tab]); c.detail.value = task; };
  c.checkWeeklyProgressBeforeAcceptance = async (id, fill, reviewing) => {
    assert.equal(id, 9); assert.equal(reviewing, false); await fill('2026-09-14'); return false;
  };
  assert.equal(await c.checkAcceptanceWeekly({ id: 9 }, 'pending_accept'), false);
  assert.deepEqual(opened, [[9, 'updates']]);
  assert.equal(c.dailyForm.value.workDate, '2026-09-14');
});

test('desktop weekly checks only submission and approval; normal state actions are unaffected', async () => {
  const { c } = setup(); const checks = [];
  c.checkWeeklyProgressBeforeAcceptance = async (id, fill, reviewing) => { checks.push(reviewing); return false; };
  assert.equal(await c.checkAcceptanceWeekly({ id: 9 }, 'doing'), true);
  assert.equal(await c.checkAcceptanceWeekly({ id: 9 }, 'done'), false);
  assert.deepEqual(checks, [true]);
});

test('selected existing material is sent by id without uploading or duplicating its URL', async () => {
  const { c, calls } = setup();
  c.selectedExistingAssetIds.value = [5];
  c.taskAssets.value = [{ id: 5, dailyUpdateId: 15, filePath: 'uploads/existing.pdf' }];
  await c.submitDailyUpdate();
  assert.equal(calls.saves.length, 1);
  assert.deepEqual(calls.saves[0].payload.existingAssetIds, [5]);
  assert.equal(calls.saves[0].payload.links.length, 0);
  assert.equal(calls.saves[0].files.length, 0);
  assert.equal(calls.saves[0].payload.noMaterialReason, '');
});
test('selected existing materials are preserved after save failure and block state transitions', async () => {
  const { c, calls } = setup();
  c.selectedExistingAssetIds.value = [5];
  c.taskAssets.value = [{ id: 5, url: 'https://example.com' }];
  c.tasksApi.saveProgress = async () => { throw Error('offline'); };
  await c.submitDailyUpdate();
  assert.deepEqual(c.selectedExistingAssetIds.value, [5]);
  c.dailyForm.value.content = '';
  assert.equal(c.canTransitionWithProcessDraft({ id: 9 }), false);
});


test('editing a record reveals the left form without moving the desktop history list', async () => {
  const { c } = setup();
  let outerScrolls = 0;
  c.progressEditor.value = { scrollTop: 600, scrollIntoView() { outerScrolls++; } };
  c.nextTick = async () => { assert.equal(c.dailyForm.value.content, '完成修复'); };
  await c.editDailyUpdate({ id: 73, content: '完成修复', workDate: '2026-09-01' });
  assert.equal(c.editingDailyUpdateId.value, 73);
  assert.equal(c.progressEditor.value.scrollTop, 0);
  assert.equal(outerScrolls, 0);
});

test('supplementing materials reveals the editor in the narrow stacked layout', async () => {
  const { c } = setup();
  let outerScrolls = 0;
  c.window.getComputedStyle = () => ({ position: 'static' });
  c.progressEditor.value = { scrollTop: 600, scrollIntoView(options) { assert.equal(options.block, 'start'); outerScrolls++; } };
  await c.editDailyUpdate({ id: 73, content: '完成修复' }, true);
  assert.equal(c.supplementOnly.value, true);
  assert.equal(c.progressEditor.value.scrollTop, 0);
  assert.equal(outerScrolls, 1);
});

test('cancelling a record switch preserves the draft and editor position', async () => {
  const { c } = setup();
  c.progressEditor.value = { scrollTop: 600, scrollIntoView() { assert.fail('must not scroll'); } };
  c.ElMessageBox.confirm = async () => { throw new Error('cancel'); };
  await c.editDailyUpdate({ id: 73, content: '完成修复' });
  assert.equal(c.editingDailyUpdateId.value, null);
  assert.equal(c.dailyForm.value.content, '完成评审');
  assert.equal(c.progressEditor.value.scrollTop, 600);
});

test('closing the dialog before the editor renders does not fail', async () => {
  const { c } = setup();
  await c.editDailyUpdate({ id: 73, content: '完成修复' });
  assert.equal(c.editingDailyUpdateId.value, 73);
});
