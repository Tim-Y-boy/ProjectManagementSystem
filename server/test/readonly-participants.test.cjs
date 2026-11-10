const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TasksService} = require('../src/modules/tasks/tasks.service');
const {UsersService} = require('../src/modules/users/users.service');

test('readonly participant is rejected before existing assignment deletion', async () => {
  const service = Object.create(TasksService.prototype);
  let deleted = false;
  service.users = { find: async () => [{id: 42, readOnly: true}] };
  service.departmentsRepo = { find: async () => [] };
  service.assignees = { delete: async () => {deleted = true}, create: x => x, save: async x => x };
  await assert.rejects(service.setAssignees(1,'assignee',[42]), /请选择业务组织范围内可参与业务处理的人员/);
  assert.equal(deleted,false);
});

test('readonly user role cannot be overwritten by admin assignment', async () => {
  const service = Object.create(UsersService.prototype);
  let deleted = false;
  service.users = { findOne: async () => ({id:42,feishuUserId:'real-user',readOnly:true}) };
  service.userRoles = {delete: async () => {deleted=true},create:x=>x,save:async x=>x,find:async()=>[]};
  service.buildHeadDeptMap = async () => new Map();
  await assert.rejects(service.assignRoles(42,['admin']), /组织策略/);
  assert.equal(deleted,false);
});

test('viewer cannot be assigned as an unprotected role-only account', async () => {
  const service = Object.create(UsersService.prototype);
  service.users = { findOne: async () => ({id:42,feishuUserId:'real-user',readOnly:false}) };
  service.userRoles = {delete: async () => {throw new Error('must not mutate roles')} };
  await assert.rejects(service.assignRoles(42,['viewer']), /角色/);
});

test('duplicate protected organization names do not replace business final approver', async (t) => {
  const old = process.env.PLAN_FINAL_APPROVER_USER_ID;
  delete process.env.PLAN_FINAL_APPROVER_USER_ID;
  t.after(()=> {if(old===undefined)delete process.env.PLAN_FINAL_APPROVER_USER_ID;else process.env.PLAN_FINAL_APPROVER_USER_ID=old});
  const service = Object.create(TasksService.prototype);
  service.departmentsRepo = {find:async()=>[{headUserId:null},{headUserId:7}], findOne:async()=>({headUserId:null})};
  service.users = {findOne:async()=>({id:7,isActive:true,readOnly:false})};
  assert.equal(await service.resolveFinalApproverId(),7);
});
