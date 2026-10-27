// Run from server: node -r ts-node/register/transpile-only --test test/project-owner-lock.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const admin = { userId: 1, roles: ['admin'], deptId: null, managedDeptIds: [] };

function fixture({ locked = true, owners = ['16', '30'], ownerId = '16' } = {}) {
  const project = { id: 18, name: '包装车间', planLocked: locked, ownerId, deptId: 4, category: '改造', endAt: null };
  const saves = [];
  const ownerWrites = [];
  const service = Object.create(TasksService.prototype);
  service.projects = { findOne: async () => project, save: async (p) => { saves.push({ ...p }); return p; } };
  service.getProjectOwnerIds = async () => owners;
  service.persistOwners = async (p, ids) => { ownerWrites.push(ids); p.ownerId = ids[0] ?? null; };
  return { service, project, saves, ownerWrites };
}

test('locked project blocks replacing, adding, removing and reordering owners even for admin', async () => {
  for (const ownerIds of [[71], [16, 30, 71], [16], [], [30, 16]]) {
    const f = fixture();
    await assert.rejects(f.service.updateProject(admin, 18, { name: '不应保存', ownerIds }), /不允许修改项目负责人/);
    assert.equal(f.project.name, '包装车间');
    assert.equal(f.saves.length, 0);
    assert.equal(f.ownerWrites.length, 0);
  }
});

test('legacy ownerId cannot bypass the lock or remove additional owners', async () => {
  for (const ownerId of [71, 16, null, '']) {
    const f = fixture();
    await assert.rejects(f.service.updateProject(admin, 18, { ownerId }), /不允许修改项目负责人/);
    assert.equal(f.saves.length, 0);
  }
});

test('unchanged owners tolerate numeric/string IDs and do not rewrite associations', async () => {
  for (const ownerIds of [[16, 30], ['16', '30']]) {
    const f = fixture();
    await f.service.updateProject(admin, 18, { description: '补充项目说明', ownerIds });
    assert.equal(f.project.description, '补充项目说明');
    assert.equal(f.saves.length, 1);
    assert.equal(f.ownerWrites.length, 0);
  }
});

test('locked project still allows editing other fields without owner parameters', async () => {
  const f = fixture();
  await f.service.updateProject(admin, 18, { description: '补充项目说明' });
  assert.equal(f.project.description, '补充项目说明');
  assert.equal(f.ownerWrites.length, 0);
});

test('legacy single-owner projects can save unchanged owners but cannot change them', async () => {
  const f = fixture({ owners: [] });
  await f.service.updateProject(admin, 18, { ownerIds: [16] });
  await f.service.updateProject(admin, 18, { ownerId: '16' });
  assert.equal(f.ownerWrites.length, 0);
  await assert.rejects(f.service.updateProject(admin, 18, { ownerIds: [71] }), /不允许修改项目负责人/);
});

test('unlocked project can still change owners through either supported field', async () => {
  for (const body of [{ ownerIds: [71, 219] }, { ownerId: 71 }]) {
    const f = fixture({ locked: false });
    await f.service.updateProject(admin, 18, body);
    assert.equal(f.ownerWrites.length, 1);
    assert.equal(f.project.ownerId, 71);
  }
});
