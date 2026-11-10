const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const admin = { userId: 1, roles: ['admin'], managedDeptIds: [] };
const draft = { workDate: '2026-10-08', content: '完成现场确认' };

function fixture({ taskStatus = 'doing', frozen = false, parent = false, rows = [], materials = [], fail = '' } = {}) {
  let state = { Task: [{ id: 531, projectId: 18, parentId: null, status: taskStatus, creatorId: 1, assigneeId: 1 }],
    TaskDailyUpdate: structuredClone(rows), TaskAsset: structuredClone(materials), TaskLog: [] };
  let nextId = 100;
  const repo = name => ({
    findOne: async ({ where }) => structuredClone(state[name].find(row => Object.entries(where).every(([key, value]) => String(row[key]) === String(value))) || null),
    find: async ({ where }) => structuredClone(state[name].filter(row => Object.entries(where).every(([key, value]) => String(row[key]) === String(value)))),
    count: async () => Number(parent), create: row => ({ ...row }),
    save: async row => {
      if (name === fail) throw Error('injected storage failure');
      if (!row.id) row.id = nextId++;
      const index = state[name].findIndex(old => old.id === row.id);
      if (index < 0) state[name].push(structuredClone(row)); else state[name][index] = structuredClone(row);
      return row;
    },
    delete: async id => { state[name] = state[name].filter(row => String(row.id) !== String(id)); },
  });
  const manager = { getRepository: entity => repo(entity.name), transaction: async callback => {
    const before = structuredClone(state);
    try { return await callback(manager); } catch (error) { state = before; throw error; }
  } };
  const service = Object.create(TasksService.prototype);
  service.tasks = { ...repo('Task'), manager };
  service.dailyUpdates = repo('TaskDailyUpdate'); service.assets = repo('TaskAsset'); service.logs = repo('TaskLog');
  service.projects = { findOne: async () => ({ id: 18, ownerId: 99, deptId: 4, planLocked: true, status: 'active', closureState: frozen ? 'pending' : 'none' }) };
  service.assignees = { find: async () => [] }; service.projectOwners = { count: async () => 0 };
  service.logger = { error() {} };
  return { service, get state() { return state; } };
}
function upload() {
  const dir = path.resolve('uploads/task-assets'); fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `progress-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(filePath, 'file');
  return { path: filePath, originalname: 'proof.txt', mimetype: 'text/plain', size: 4 };
}

test('each new progress requires its own materials or an explicit reason, never another record material', async () => {
  const f = fixture({ materials: [{ id: 5, taskId: 531, dailyUpdateId: 60, url: 'https://example.com/other' }] });
  await assert.rejects(f.service.saveProgress(admin, 531, draft, []), /资料|原因/);
  assert.equal(f.state.TaskDailyUpdate.length, 0);
  await assert.rejects(f.service.createDailyUpdate(admin, 531, draft), /资料|原因/);
});

test('JSON multipart payload stores one trimmed reason and audit atomically', async () => {
  const f = fixture();
  const saved = await f.service.saveProgress(admin, 531, JSON.stringify({ ...draft, noMaterialReason: '  仅现场协调，无文件成果  ' }), []);
  assert.equal(saved.noMaterialReason, '仅现场协调，无文件成果');
  assert.equal(f.state.TaskDailyUpdate.length, 1);
  assert.equal(f.state.TaskLog[0].payload.noMaterialReason, saved.noMaterialReason);
  for (const reason of ['', '   ', '因'.repeat(501), 12]) {
    await assert.rejects(f.service.saveProgress(admin, 531, { ...draft, noMaterialReason: reason }, []), /原因|500/);
  }
});

test('files and links belong to the newly saved progress and ignore forged paths', async () => {
  const f = fixture(); const file = upload();
  try {
    const saved = await f.service.saveProgress(admin, 531, { ...draft, links: [{ title: '方案', url: 'https://example.com/spec', filePath: 'fake' }] }, [file]);
    assert.equal(f.state.TaskAsset.length, 2);
    assert.ok(f.state.TaskAsset.every(asset => asset.dailyUpdateId === saved.id && asset.taskId === 531));
    assert.equal(f.state.TaskAsset.find(asset => asset.url).filePath, null);
    assert.equal(f.state.TaskAsset.find(asset => asset.filePath).filePath, file.path);
    assert.equal(f.state.TaskLog.length, 3);
  } finally { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); }
});

test('invalid links do not save progress and remove this request temporary files', async () => {
  const f = fixture(); const file = upload();
  await assert.rejects(f.service.saveProgress(admin, 531, { ...draft, links: [{ url: 'javascript:alert(1)' }] }, [file]), /链接/);
  assert.equal(f.state.TaskDailyUpdate.length, 0);
  assert.equal(fs.existsSync(file.path), false);
});

test('asset or audit failure rolls back all progress/material/log rows and cleans uploads', async () => {
  for (const fail of ['TaskAsset', 'TaskLog']) {
    const f = fixture({ fail }); const file = upload();
    await assert.rejects(f.service.saveProgress(admin, 531, draft, [file]), /injected storage failure/);
    assert.equal(f.state.TaskDailyUpdate.length, 0);
    assert.equal(f.state.TaskAsset.length, 0);
    assert.equal(f.state.TaskLog.length, 0);
    assert.equal(fs.existsSync(file.path), false);
  }
});

test('editing without own materials requires reason and preserves omitted historical fields', async () => {
  const original = { id: 60, taskId: 531, projectId: 18, userId: 1, workDate: '2026-10-07', content: '原文', status: 'normal', risk: '原风险', nextPlan: '原计划', affectDueDate: true };
  const f = fixture({ rows: [original], materials: [{ id: 5, taskId: 531, dailyUpdateId: 61, url: 'https://example.com/other' }] });
  await assert.rejects(f.service.saveProgress(admin, 531, { ...draft, updateId: 60 }, []), /资料|原因/);
  await assert.rejects(f.service.updateDailyUpdate(admin, 531, 60, draft), /资料|原因/);
  const saved = await f.service.saveProgress(admin, 531, { ...draft, updateId: 60, noMaterialReason: '现场口头协调' }, []);
  assert.equal(saved.risk, '原风险'); assert.equal(saved.nextPlan, '原计划'); assert.equal(saved.affectDueDate, true);
});

test('materialsOnly adds to completed/exempted progress without altering its original text or flags', async () => {
  const original = { id: 60, taskId: 531, projectId: 18, userId: 1, content: '原文', status: 'exempted', risk: '风险', noMaterialReason: '旧说明' };
  const f = fixture({ taskStatus: 'done', rows: [original] });
  const saved = await f.service.saveProgress(admin, 531, { updateId: 60, materialsOnly: true, content: '篡改', noMaterialReason: '篡改', links: [{ url: 'https://example.com/spec' }] }, []);
  assert.equal(saved.content, '原文'); assert.equal(saved.noMaterialReason, '旧说明'); assert.equal(saved.status, 'exempted');
  assert.deepEqual(f.state.TaskDailyUpdate[0], original);
});

test('permissions, frozen projects, parents and protected progress reject atomic saves', async () => {
  const body = { ...draft, noMaterialReason: '无文件成果' };
  for (const options of [{ frozen: true }, { parent: true }, { taskStatus: 'pending_accept' }]) {
    const f = fixture(options);
    await assert.rejects(f.service.saveProgress(admin, 531, body, []));
    assert.equal(f.state.TaskDailyUpdate.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.service.saveProgress({ ...admin, userId: 88, roles: ['member'] }, 531, body, []), { status: 403 });
  const exempted = fixture({ rows: [{ id: 60, taskId: 531, userId: 1, status: 'exempted' }] });
  await assert.rejects(exempted.service.saveProgress(admin, 531, { ...body, updateId: 60 }, []), /合理补填/);
});

test('deleting the last valid material without a reason is blocked, including historical progress', async () => {
  const row = { id: 60, taskId: 531, userId: 1, status: 'normal' };
  const material = { id: 5, taskId: 531, dailyUpdateId: 60, url: 'https://example.com/spec' };
  const f = fixture({ rows: [row], materials: [material] });
  await assert.rejects(f.service.deleteTaskAsset(admin, 531, 5), /最后|原因/);
  assert.equal(f.state.TaskAsset.length, 1);
  f.state.TaskDailyUpdate[0].noMaterialReason = '仅现场协调';
  await f.service.deleteTaskAsset(admin, 531, 5);
  assert.equal(f.state.TaskAsset.length, 0);
});

test('file count and total size limits reject the whole request and clean its temporary files', async () => {
  for (const [count, size, message] of [[31, 4, /30/], [5, 45 * 1024 * 1024, /200 MB/]]) {
    const f = fixture();
    const files = Array.from({ length: count }, () => ({ ...upload(), size }));
    await assert.rejects(f.service.saveProgress(admin, 531, draft, files), message);
    assert.equal(f.state.TaskDailyUpdate.length, 0);
    assert.ok(files.every(file => !fs.existsSync(file.path)));
  }
});

test('an existing material for this exact progress allows editing without an explanation', async () => {
  const f = fixture({ rows: [{ id: 60, taskId: 531, userId: 1, status: 'normal', risk: '原风险' }],
    materials: [{ id: 5, taskId: 531, dailyUpdateId: 60, url: 'https://example.com/spec' }] });
  const saved = await f.service.saveProgress(admin, 531, { ...draft, updateId: 60 }, []);
  assert.equal(saved.content, draft.content);
  assert.equal(saved.noMaterialReason, null);
  assert.equal(saved.risk, '原风险');
  const legacy = await f.service.updateDailyUpdate(admin, 531, 60, draft);
  assert.equal(legacy.noMaterialReason, null);
});

test('malformed multipart JSON removes uploads without any database writes', async () => {
  const f = fixture(); const file = upload();
  await assert.rejects(f.service.saveProgress(admin, 531, '{bad-json', [file]), /格式/);
  assert.equal(f.state.TaskDailyUpdate.length, 0);
  assert.equal(fs.existsSync(file.path), false);
});

test('failed delete audit rolls back the material removal', async () => {
  const f = fixture({ fail: 'TaskLog', rows: [{ id: 60, taskId: 531, noMaterialReason: '线下归档' }],
    materials: [{ id: 5, taskId: 531, dailyUpdateId: 60, url: 'https://example.com/spec' }] });
  await assert.rejects(f.service.deleteTaskAsset(admin, 531, 5), /injected storage failure/);
  assert.equal(f.state.TaskAsset.length, 1);
});

test('legacy edit audit failure rolls back text and retains author-only edit permission', async () => {
  const row = { id: 60, taskId: 531, projectId: 18, userId: 2, content: '原文', status: 'normal', noMaterialReason: '无资料' };
  const f = fixture({ fail: 'TaskLog', rows: [row] });
  await assert.rejects(f.service.updateDailyUpdate({ ...admin, userId: 2, roles: ['member'] }, 531, 60,
    { ...draft, noMaterialReason: '仅口头协调' }), /injected storage failure/);
  assert.equal(f.state.TaskDailyUpdate[0].content, '原文');
  const allowed = fixture({ rows: [row] });
  const saved = await allowed.service.updateDailyUpdate({ ...admin, userId: 2, roles: ['member'] }, 531, 60,
    { ...draft, noMaterialReason: '仅口头协调' });
  assert.equal(saved.content, draft.content);
});

test('one existing file can serve several progress entries without duplicating the asset', async () => {
  const f = fixture({ materials: [{ id: 5, taskId: 531, projectId: 18, dailyUpdateId: 60, filePath: 'uploads/task-assets/proof.pdf' }] });
  const first = await f.service.saveProgress(admin, 531, { ...draft, existingAssetIds: [5, '5'] });
  const second = await f.service.saveProgress(admin, 531, { ...draft, existingAssetIds: [5] });
  assert.equal(f.state.TaskAsset.length, 1);
  assert.equal(f.state.TaskAsset[0].dailyUpdateId, 60);
  assert.deepEqual(f.state.TaskAsset[0].linkedDailyUpdateIds.map(Number), [first.id, second.id]);
  await f.service.updateDailyUpdate(admin, 531, first.id, draft);
  assert.equal(f.state.TaskDailyUpdate[0].noMaterialReason, null);
});
test('existing asset selection rejects missing, cross-task and invalid materials without writes', async () => {
  for (const material of [null, { id: 5, taskId: 999, url: 'https://example.com' }, { id: 5, taskId: 531, url: 'javascript:bad' }]) {
    const f = fixture({ materials: material ? [material] : [] });
    await assert.rejects(f.service.saveProgress(admin, 531, { ...draft, existingAssetIds: [5], noMaterialReason: '原因' }), /资料/);
    assert.equal(f.state.TaskDailyUpdate.length, 0);
  }
  for (const ids of ['5', [0], [-1], [null], [true], [1.5]]) {
    await assert.rejects(fixture().service.saveProgress(admin, 531, { ...draft, existingAssetIds: ids }), /资料/);
  }
});
test('linking existing evidence is transactional and supports materials-only protected records', async () => {
  const original = { id: 60, taskId: 531, userId: 1, status: 'exempted', content: '原文', noMaterialReason: '旧原因' };
  const material = { id: 5, taskId: 531, dailyUpdateId: 61, url: 'https://example.com' };
  const f = fixture({ taskStatus: 'done', rows: [original], materials: [material] });
  await f.service.saveProgress(admin, 531, { updateId: 60, materialsOnly: true, existingAssetIds: [5] });
  await f.service.saveProgress(admin, 531, { updateId: 60, materialsOnly: true, existingAssetIds: [5] });
  assert.deepEqual(f.state.TaskDailyUpdate[0], original);
  assert.deepEqual(f.state.TaskAsset[0].linkedDailyUpdateIds, [60]);
  const failed = fixture({ materials: [material], fail: 'TaskLog' });
  await assert.rejects(failed.service.saveProgress(admin, 531, { ...draft, existingAssetIds: [5] }), /injected/);
  assert.deepEqual(failed.state.TaskAsset[0], material);
});
test('unlinking preserves the shared file and other records, and protects the last evidence', async () => {
  const f = fixture({ rows: [{ id: 60, taskId: 531, userId: 1, status: 'normal' }],
    materials: [{ id: 5, taskId: 531, dailyUpdateId: 60, linkedDailyUpdateIds: [61], url: 'https://example.com' }] });
  await assert.rejects(f.service.unlinkTaskAsset(admin, 531, 60, 5), /最后|原因/);
  await assert.rejects(f.service.deleteTaskAsset(admin, 531, 5), /多条|关联/);
  f.state.TaskDailyUpdate[0].noMaterialReason = '已线下归档';
  await f.service.unlinkTaskAsset(admin, 531, 60, 5);
  assert.equal(f.state.TaskAsset.length, 1);
  assert.equal(f.state.TaskAsset[0].dailyUpdateId, null);
  assert.deepEqual(f.state.TaskAsset[0].linkedDailyUpdateIds, [61]);
});

test('shared links retain process permissions, freeze protection and unlink task boundaries', async () => {
  const rows = [{ id: 60, taskId: 531, userId: 1, status: 'normal', noMaterialReason: '线下归档' }];
  const materials = [{ id: 5, taskId: 531, dailyUpdateId: 60, linkedDailyUpdateIds: [61], url: 'https://example.com' }];
  for (const options of [{ frozen: true }, { taskStatus: 'pending_accept' }]) {
    const f=fixture({ ...options, rows, materials });
    await assert.rejects(f.service.unlinkTaskAsset(admin,531,60,5));
    await assert.rejects(f.service.saveProgress(admin,531,{...draft,existingAssetIds:[5]}));
    assert.deepEqual(f.state.TaskAsset,materials);
  }
  const f=fixture({rows,materials});
  const stranger={...admin,userId:88,roles:['member']};
  await assert.rejects(f.service.unlinkTaskAsset(stranger,531,60,5),{status:403});
  await assert.rejects(f.service.saveProgress(stranger,531,{...draft,existingAssetIds:[5]}),{status:403});
  await assert.rejects(f.service.unlinkTaskAsset(admin,531,99,5),{status:404});
  await assert.rejects(f.service.unlinkTaskAsset(admin,531,60,99),{status:404});
  assert.deepEqual(f.state.TaskAsset,materials);
});
