const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const assetModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/task-assets.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, assetModule);
const reasonModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/no-material-reason.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, reasonModule);

function fixture({ status = 'doing', uid = 71, locked = true, frozen = false, query = {}, failSave = false } = {}) {
  const filename = path.join(__dirname, '../src/views/mobile/MobileTaskDetail.vue');
  const script = parse(fs.readFileSync(filename, 'utf8')).descriptor.scriptSetup.content;
  const source = ts.createSourceFile(filename + '.ts', script, ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n');
  const events = [], notifications = [], confirms = [];
  const route = vue.reactive({ params: { id: '531' }, query });
  const guards = {};
  let fails = failSave;
  const row = { id: 531, status, planLocked: locked, projectStatus: 'active', projectClosureState: frozen ? 'pending' : 'none',
    assigneeId: 71, creatorId: 71, acceptorId: 30, projectOwnerId: 16, children: [] };
  const api = { one: async () => row, dailyUpdates: async () => [], assets: async () => [],
    saveProgress: async (id, body) => {
      const payload = JSON.parse(body.get('payload'));
      const files = body.getAll('files');
      events.push(['request', id, payload, files]);
      if (fails) { fails = false; throw Error('事务保存失败'); }
      events.push(['saved', id, payload, files]);
      return { id: 80 };
    },
    transition: async (...args) => events.push(['transition', ...args]),
  };
  for (const method of ['createDailyUpdate', 'updateDailyUpdate', 'uploadAsset', 'createAsset']) {
    api[method] = () => { throw Error('Must use atomic saveProgress, called: ' + method); };
  }
  const context = { ...vue, useRoute: () => route,
    ...assetModule.exports, progressMaterialReason: reasonModule.exports.progressMaterialReason,
    materialConfirmationMessage: reason => reason,
    checkWeeklyProgressBeforeAcceptance: async () => true,
    onBeforeRouteLeave: guard => { guards.leave = guard; }, onBeforeRouteUpdate: guard => { guards.update = guard; },
    useAuthStore: () => ({ user: { id: uid }, has: () => false }),
    useRefreshStore: () => ({ markTaskChanged: () => events.push(['refresh']) }),
    tasksApi: api, URL, FormData, File,
    ElMessage: Object.fromEntries(['error', 'warning', 'success', 'info'].map(level => [level, text => notifications.push([level, text])])),
    ElMessageBox: { prompt: async (...args) => { confirms.push(args); return { value: '仅现场协调' }; },
      confirm: async (...args) => { confirms.push(args); } },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
  const evaluate = expression => vm.runInContext(expression, context);
  const fill = (reason = '') => evaluate(`materialChoice.value = 'no'; upForm.value = { workDate: '2026-10-08', content: '现场确认', noMaterialReason: ${JSON.stringify(reason)} }`);
  return { evaluate, fill, events, notifications, confirms, row, api, route, guards, dialogs: context.ElMessageBox, context };
}
const requests = f => f.events.filter(row => row[0] === 'request');
const saves = f => f.events.filter(row => row[0] === 'saved');

test('mobile blocks unauthorized, frozen, unfinalized and pending-accept progress writes', async () => {
  for (const options of [{ uid: 99 }, { frozen: true }, { locked: false }, { status: 'pending_accept' }]) {
    const f = fixture(options);
    await f.evaluate('load()');
    f.fill('仅现场沟通');
    await f.evaluate('addUpdate()');
    assert.equal(requests(f).length, 0);
  }
});

test('weekly entry selects progress and fills the requested work date', () => {
  const f = fixture({ query: { weekStart: '2026-09-28' } });
  assert.equal(f.evaluate('detailTab.value'), 'updates');
  assert.equal(f.evaluate('upForm.value.workDate'), '2026-09-28');
});

test('reused mobile detail reloads task and week and submits to the current task only', async () => {
  const f = fixture({ query: { weekStart: '2026-09-28' } });
  await f.evaluate('load()');
  f.api.one = async id => ({ ...f.row, id });
  f.route.params.id = '532';
  f.route.query.weekStart = '2026-10-05';
  await vue.nextTick();
  await f.evaluate('load()');
  assert.equal(f.evaluate('task.value.id'), 532);
  assert.equal(f.evaluate('upForm.value.workDate'), '2026-10-05');
  f.evaluate("upForm.value.content = '新任务进展'; upForm.value.noMaterialReason = '仅现场沟通'");
  f.evaluate("materialChoice.value = 'no'");
  await f.evaluate('addUpdate()');
  assert.equal(saves(f)[0][1], 532);
});

test('navigation guards preserve cancelled drafts including reason and prevent leaving while saving', async () => {
  const f = fixture();
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("upForm.value.noMaterialReason = '尚无产物'; pendingFiles.value = [new File(['a'], 'a.txt')]");
  f.dialogs.confirm = async () => { throw Error('cancel'); };
  assert.equal(await f.guards.update(), false);
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '尚无产物');
  f.dialogs.confirm = async () => {};
  assert.equal(await f.guards.leave(), true);
  f.evaluate('savingUpdate.value = true');
  assert.equal(await f.guards.leave(), false);
  assert.equal(await f.guards.update(), false);
  f.evaluate('savingUpdate.value = false');
  f.route.params.id = '532';
  await vue.nextTick();
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '');
  assert.equal(f.evaluate('pendingFiles.value.length'), 0);
});

test('late response from previous mobile task cannot replace newly loaded detail', async () => {
  const f = fixture();
  await f.evaluate('load()');
  let release;
  f.api.one = id => id === 531 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ...f.row, id });
  const oldLoad = f.evaluate('load()');
  f.route.params.id = '532';
  await vue.nextTick();
  await f.evaluate('load()');
  release({ ...f.row, id: 531 });
  await oldLoad;
  assert.equal(f.evaluate('task.value.id'), 532);
});

test('one atomic request contains text, all files and multiple links; success clears the draft', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill();
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("pendingFiles.value = [new File(['a'], '现场.txt'), new File(['b'], '说明.txt')]; linkDraft.value = 'https://example.com/doc\\nhttps://docs.example.org/result'");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 1);
  const [, id, payload, files] = saves(f)[0];
  assert.equal(id, 531);
  assert.equal(payload.content, '现场确认');
  assert.equal(payload.workDate, '2026-10-08');
  assert.equal(payload.links.length, 2);
  assert.equal(payload.links[0].title, 'example.com');
  assert.deepEqual(files.map(file => file.name), ['现场.txt', '说明.txt']);
  assert.equal(f.evaluate('pendingFiles.value.length'), 0);
  assert.equal(f.evaluate('linkDraft.value'), '');
  assert.equal(f.evaluate('upForm.value.content'), '');
});

test('transaction failure retains the entire text, files and raw link draft for an identical retry', async () => {
  const f = fixture({ failSave: true });
  await f.evaluate('load()');
  f.fill('暂存原因');
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("pendingFiles.value = [new File(['test'], '现场.txt')]; linkDraft.value = ' https://example.com/spec '");
  await f.evaluate('addUpdate()');
  assert.equal(saves(f).length, 0);
  assert.equal(f.evaluate('upForm.value.content'), '现场确认');
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '暂存原因');
  assert.equal(f.evaluate('pendingFiles.value.length'), 1);
  assert.equal(f.evaluate('linkDraft.value'), ' https://example.com/spec ');
  assert.equal(f.notifications.some(([level]) => level === 'success'), false);
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 2);
  assert.equal(saves(f).length, 1);
  assert.deepEqual(requests(f)[0][2], requests(f)[1][2]);
  assert.equal(requests(f)[1][3][0].name, '现场.txt');
});

test('mobile keeps drafts without duplicating an error already displayed by HTTP handling', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill();
  f.evaluate("upForm.value.noMaterialReason = '现场沟通'");
  f.api.saveProgress = async () => { throw Object.assign(new Error('Cannot POST'), { messageShown: true }); };
  await f.evaluate('addUpdate()');
  assert.equal(f.notifications.length, 0);
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '现场沟通');
});

test('completed-task supplements use the same atomic endpoint without modifying text or reason', async () => {
  const f = fixture({ status: 'done' });
  await f.evaluate('load()');
  f.evaluate("var historicalProgress = { id: 90, content: '原文', noMaterialReason: '原原因', risk: '原风险' }; updates.value = [historicalProgress]");
  await f.evaluate('chooseProgress(90)');
  assert.equal(f.evaluate('showNoMaterialReason.value'), false);
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("linkDraft.value = 'https://example.com/result'");
  await f.evaluate('addUpdate()');
  const payload = saves(f)[0][2];
  assert.equal(payload.updateId, 90);
  assert.equal(payload.materialsOnly, true);
  assert.equal('content' in payload, false);
  assert.equal('noMaterialReason' in payload, false);
  assert.equal(f.evaluate('historicalProgress.noMaterialReason'), '原原因');
});

test('every new progress needs valid materials or a trimmed reason between 1 and 500 characters', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill();
  for (const reason of ['', '   ', '字'.repeat(501)]) {
    f.evaluate(`upForm.value.noMaterialReason = ${JSON.stringify(reason)}`);
    await f.evaluate('addUpdate()');
    assert.equal(requests(f).length, 0);
  }
  f.fill('  ' + '字'.repeat(500) + '  ');
  await f.evaluate('addUpdate()');
  assert.equal(saves(f)[0][2].noMaterialReason.length, 500);
  assert.equal(saves(f)[0][3].length, 0);
  const single = fixture();
  await single.evaluate('load()');
  single.fill('  无  ');
  await single.evaluate('addUpdate()');
  assert.equal(saves(single)[0][2].noMaterialReason, '无');
});

test('materials attached to other progress or legacy task assets never waive this progress reason', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill();
  f.evaluate("assets.value = [{ dailyUpdateId: 1, filePath: 'uploads/file.pdf' }, { dailyUpdateId: null, url: 'https://example.com/file' }]");
  assert.equal(f.evaluate('hasMaterials.value'), true);
  assert.equal(f.evaluate('showNoMaterialReason.value'), true);
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
});

test('yes branch hides reason and invalid URLs prevent any request', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill('无有效产物');
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("linkDraft.value = 'javascript:alert(1)'");
  assert.equal(f.evaluate('showNoMaterialReason.value'), false);
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '无有效产物');
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("linkDraft.value = 'https://example.com/doc\\n不是链接'; pendingFiles.value = [new File(['test'], '说明.txt')]");
  assert.equal(f.evaluate('showNoMaterialReason.value'), false);
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  assert.equal(f.evaluate('pendingFiles.value.length'), 1);
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("linkDraft.value = 'https://example.com/doc'; pendingFiles.value = []");
  assert.equal(f.evaluate('showNoMaterialReason.value'), false);
  await f.evaluate('addUpdate()');
  assert.equal(saves(f)[0][2].noMaterialReason, '');
});

test('blank progress text prevents saving even when a reason is present', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill('无产物');
  f.evaluate("upForm.value.content = '   '");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
});

test('file selection and save enforce at most 30 files and 50MB per file', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill();
  f.evaluate("selectFiles({ target: { value: 'files', files: Array.from({ length: 31 }, () => new File(['a'], 'a.txt')) } })");
  assert.equal(f.evaluate('pendingFiles.value.length'), 0);
  f.evaluate("selectFiles({ target: { value: 'large', files: [{ name: 'large.pdf', size: 50 * 1024 * 1024 + 1 }] } })");
  assert.equal(f.evaluate('pendingFiles.value.length'), 0);
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("pendingFiles.value = Array.from({ length: 31 }, () => new File(['a'], 'a.txt'))");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("pendingFiles.value = [{ name: 'large.pdf', size: 50 * 1024 * 1024 + 1 }]");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("pendingFiles.value = Array.from({ length: 30 }, () => new File(['a'], 'a.txt'))");
  await f.evaluate('addUpdate()');
  assert.equal(saves(f)[0][3].length, 30);
});

test('no-material task submission reuses saved progress reasons and requires reviewer confirmation', async () => {
  const f = fixture();
  f.api.dailyUpdates = async () => [{ noMaterialReason: '仅现场协调' }];
  f.dialogs.prompt = async () => { throw new Error('Must not request another reason'); };
  await f.evaluate('load()');
  await f.evaluate("transition('pending_accept')");
  assert.equal(f.events.find(row => row[0] === 'transition')[4], '仅现场协调');
  f.row.status = 'pending_accept';
  f.row.materialExemptionReason = '仅现场协调';
  await f.evaluate("transition('done')");
  assert.ok(f.confirms.some(args => args[0].includes('仅现场协调') && args[0].includes('确认')));
});

test('mobile cancels submission without losing saved reasons and blocks missing historical reasons', async () => {
  const f = fixture();
  await f.evaluate('load()');
  await f.evaluate("transition('pending_accept')");
  assert.equal(f.events.filter(row => row[0] === 'transition').length, 0);
  assert.match(f.notifications.at(-1)[1], /无资料原因/);
  f.api.dailyUpdates = async () => [{ noMaterialReason: '已填写原因' }];
  f.dialogs.confirm = async () => { throw 'cancel'; };
  await f.evaluate("transition('pending_accept')");
  assert.equal(f.events.filter(row => row[0] === 'transition').length, 0);
});

test('file selection and save enforce a 200MB total without losing drafts', async () => {
  const f = fixture();
  await f.evaluate('load()');
  f.fill('尚无资料时的暂存原因');
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("linkDraft.value = 'https://example.com/doc'; selectFiles({ target: { value: 'files', files: Array.from({ length: 4 }, () => ({ name: 'part.pdf', size: 50 * 1024 * 1024 })) } })");
  assert.equal(f.evaluate('pendingFiles.value.length'), 4);
  f.evaluate("selectFiles({ target: { value: 'one-more', files: [new File(['x'], 'extra.txt')] } })");
  assert.equal(f.evaluate('pendingFiles.value.length'), 4);
  assert.ok(f.notifications.some(([, text]) => text.includes('合计不能超过 200MB')));
  f.evaluate("pendingFiles.value.push(new File(['x'], 'extra.txt'))");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  assert.equal(f.evaluate('pendingFiles.value.length'), 5);
  assert.equal(f.evaluate('upForm.value.content'), '现场确认');
  assert.equal(f.evaluate('upForm.value.noMaterialReason'), '尚无资料时的暂存原因');
  assert.equal(f.evaluate('linkDraft.value'), 'https://example.com/doc');
});


test('mobile missing-week check blocks submission and fills the selected historical work date', async () => {
  const f = fixture(); await f.evaluate('load()');
  f.context.checkWeeklyProgressBeforeAcceptance = async (id, onFill, reviewing) => {
    assert.equal(id, 531); assert.equal(reviewing, false);
    await onFill('2026-09-14'); return false;
  };
  await f.evaluate("transition('pending_accept')");
  assert.equal(f.events.filter(row => row[0] === 'transition').length, 0);
  assert.equal(f.evaluate('detailTab.value'), 'updates');
  assert.equal(f.evaluate('upForm.value.workDate'), '2026-09-14');
});

test('mobile weekly check errors preserve task state and approval is checked too', async () => {
  const f = fixture({ status: 'pending_accept', uid: 30 }); await f.evaluate('load()');
  f.context.checkWeeklyProgressBeforeAcceptance = async (id, onFill, reviewing) => {
    assert.equal(reviewing, true); throw Error('检查失败');
  };
  await f.evaluate("transition('done')");
  assert.equal(f.events.filter(row => row[0] === 'transition').length, 0);
  assert.ok(f.notifications.some(row => row[1] === '检查失败'));
});

test('mobile existing-file selection survives failures and cancelled navigation, then clears on success', async () => {
  const f = fixture({ failSave: true });
  await f.evaluate('load()');
  f.fill();
  f.evaluate("materialChoice.value = 'yes'");
  f.evaluate("assets.value = [{ id: 5, filePath: 'uploads/proof.pdf', dailyUpdateId: 70 }]; selectedExistingAssetIds.value = [5]");
  await f.evaluate('addUpdate()');
  assert.deepEqual(requests(f)[0][2].existingAssetIds, [5]);
  assert.equal(f.evaluate('selectedExistingAssetIds.value.length'), 1);
  f.evaluate("upForm.value = {workDate:'',content:'',noMaterialReason:''}");
  f.dialogs.confirm = async () => { throw Error('cancel'); };
  assert.equal(await f.guards.update(), false);
  f.fill();
  f.evaluate("materialChoice.value = 'yes'");
  await f.evaluate('addUpdate()');
  assert.equal(saves(f).length, 1);
  assert.equal(f.evaluate('selectedExistingAssetIds.value.length'), 0);
});
test('mobile presents one shared file under each linked progress', async () => {
  const f = fixture();
  f.evaluate("updates.value = [{id:60},{id:'61'}]; assets.value = [{id:5,dailyUpdateId:60,linkedDailyUpdateIds:['61'],url:'https://example.com'}]");
  assert.equal(f.evaluate('updatesWithAssets.value.every(u => u.materials.length === 1)'), true);
  assert.equal(f.evaluate('unlinkedAssets.value.length'), 0);
});
test('mobile requires an explicit choice and does not save hidden drafts in the no-material branch', async () => {
  const f = fixture({ failSave: true });
  await f.evaluate('load()');
  f.fill('现场沟通');
  f.evaluate("materialChoice.value = ''");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  f.evaluate("materialChoice.value = 'yes'");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 0);
  f.evaluate("pendingFiles.value = [new File(['test'], 'draft.txt')]; linkDraft.value = 'invalid hidden link'; selectedExistingAssetIds.value = [8]; materialChoice.value = 'no'");
  await f.evaluate('addUpdate()');
  assert.equal(requests(f).length, 1);
  assert.equal(requests(f)[0][2].noMaterialReason, '现场沟通');
  assert.equal(requests(f)[0][2].links.length, 0);
  assert.equal(requests(f)[0][2].existingAssetIds.length, 0);
  assert.equal(requests(f)[0][3].length, 0);
  assert.equal(f.evaluate('pendingFiles.value.length'), 1);
  assert.equal(f.evaluate('linkDraft.value'), 'invalid hidden link');
});
