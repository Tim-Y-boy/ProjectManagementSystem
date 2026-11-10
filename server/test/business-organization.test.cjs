const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessDepartmentIds, businessPersonSelectable } = require('../src/common/business-organization');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const { DepartmentsService } = require('../src/modules/departments/departments.service');
const { UsersService } = require('../src/modules/users/users.service');
const departments = [
  { id: 1, name: '示例业务公司', feishuDeptId: 'od-business', parentFeishuId: 'od-group' },
  { id: 15, name: '研发部门', feishuDeptId: 'od-ai-business', parentFeishuId: 'od-business' },
  { id: 16, name: '下级部门', feishuDeptId: 'od-child', parentFeishuId: 'od-ai-business' },
  { id: 2, name: '示例集团集团', feishuDeptId: 'od-group' },
  { id: 3053, name: '研发部门', feishuDeptId: 'od-ai-group', parentFeishuId: 'od-group' },
];
test('same-name departments remain separate; only business root and descendants are selectable', () => {
  const scope = businessDepartmentIds(departments, { FEISHU_SYNC_ROOT_DEPT: 'od-business' });
  assert.deepEqual([...scope], ['1', '15', '16']);
  assert.equal(businessPersonSelectable({ deptId: '15', isActive: true }, scope), true);
  for (const person of [{ deptId: 3053 }, { deptId: null }, { deptId: 15, readOnly: true }, { deptId: 15, isActive: false }]) {
    assert.equal(businessPersonSelectable(person, scope), false);
  }
  assert.equal(departments.length, 5, 'full directory is not changed');
});
test('scope fails closed for missing or ambiguous roots and excludes explicit read-only branches', () => {
  assert.deepEqual([...businessDepartmentIds(departments, { FEISHU_SYNC_ROOT_DEPT: 'od-unknown' })], []);
  assert.deepEqual([...businessDepartmentIds(departments, { FEISHU_SYNC_ROOT_DEPT: '0' })], ['1','15','16']);
  assert.deepEqual([...businessDepartmentIds([...departments, { id: 99, name: '示例业务公司', feishuDeptId: 'od-other' }], {})], []);
  assert.deepEqual([...businessDepartmentIds(departments, { FEISHU_SYNC_ROOT_DEPT: 'od-business', FEISHU_READONLY_ROOT_DEPTS: 'od-ai-business' })], ['1']);
});
test('backend rejects group department, group personnel, read-only personnel and nonexistent personnel', async () => {
  const previous = process.env.FEISHU_BUSINESS_ROOT_DEPT;
  process.env.FEISHU_BUSINESS_ROOT_DEPT = 'od-business';
  try {
    const svc = Object.create(TasksService.prototype);
    svc.departmentsRepo = { find: async () => departments };
    await svc.assertBusinessDepartment(15);
    await assert.rejects(svc.assertBusinessDepartment(3053), /业务组织/);
    await assert.rejects(svc.assertBusinessDepartment(null), /业务组织/);
    svc.users = { find: async () => [{ id: 1, deptId: 15, isActive: true }] };
    await svc.assertWritableParticipants([1]);
    svc.users.find = async () => [{ id: 2, deptId: 3053, isActive: true }];
    await assert.rejects(svc.assertWritableParticipants([2]), /业务组织/);
    svc.users.find = async () => [{ id: 3, deptId: 15, readOnly: true }];
    await assert.rejects(svc.assertWritableParticipants([3]), /业务组织/);
    svc.users.find = async () => [];
    await assert.rejects(svc.assertWritableParticipants([999]), /业务组织/);
  } finally {
    if (previous === undefined) delete process.env.FEISHU_BUSINESS_ROOT_DEPT;
    else process.env.FEISHU_BUSINESS_ROOT_DEPT = previous;
  }
});
test('directory APIs retain group records for viewing while marking them unavailable for assignment', async () => {
  const previous = process.env.FEISHU_BUSINESS_ROOT_DEPT;
  process.env.FEISHU_BUSINESS_ROOT_DEPT = 'od-business';
  try {
    const depts = Object.create(DepartmentsService.prototype);
    depts.depts = { find: async () => departments };
    depts.users = { find: async () => [] };
    const directory = await depts.list();
    assert.equal(directory.length, 5);
    assert.equal(directory.find(d => d.id === 15).businessSelectable, true);
    assert.equal(directory.find(d => d.id === 3053).businessSelectable, false);
    const users = Object.create(UsersService.prototype);
    users.users = { find: async () => [{ id: 1, deptId: 15, isActive: true }, { id: 2, deptId: 3053, isActive: true }] };
    users.userRoles = { find: async () => [] };
    users.depts = { find: async () => departments };
    users.buildHeadDeptMap = async () => new Map();
    const people = await users.list();
    assert.equal(people.length, 2);
    assert.equal(people[0].businessSelectable, true);
    assert.equal(people[1].businessSelectable, false);
  } finally {
    if (previous === undefined) delete process.env.FEISHU_BUSINESS_ROOT_DEPT;
    else process.env.FEISHU_BUSINESS_ROOT_DEPT = previous;
  }
});
