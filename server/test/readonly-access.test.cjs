const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JwtService } = require('@nestjs/jwt');
const { JwtAuthGuard } = require('../src/modules/auth/jwt-auth.guard');
const jwt = new JwtService({ secret: 'readonly-regression-test' });
function request(controller, handler, method = 'GET', state = { read_only: true, is_active: true }) {
  const req = { method, headers: { authorization: 'Bearer ' + jwt.sign({ feishuUserId:'test-person', userId: '3', roles: ['admin'], managedDeptIds: [7] }) } };
  const context = { switchToHttp: () => ({ getRequest: () => req }), getClass: () => ({ name: controller }), getHandler: () => ({ name: handler }) };
  return { req, run: () => new JwtAuthGuard(jwt, { query: async () => [{feishu_user_id:'test-person',...state}] }).canActivate(context) };
}
test('live read-only state blocks a previously issued admin token from writes', async () => {
  await assert.rejects(async () => request('TasksController', 'createTask', 'POST').run(), error => error.getStatus() === 403);
});

test('project weekly report reads are allowed to visitors while submissions stay forbidden', async () => {
  for (const handler of ['list','detail','todo']) assert.equal(await request('ProjectWeeklyReportsController',handler).run(),true);
  for (const [handler,method] of [['save','PUT'],['draft','PUT'],['submit','POST']]) await assert.rejects(request('ProjectWeeklyReportsController',handler,method).run(),error=>error.getStatus()===403);
});
test('read-only requests get viewer identity and no managed departments', async () => {
  const { req, run } = request('TasksController', 'listProjects');
  await run();
  assert.equal(req.user.readOnly, true);
  assert.deepEqual(req.user.roles, ['viewer']);
  assert.deepEqual(req.user.managedDeptIds, []);
  assert.equal(req.user.userId, 3);
});
test('unknown GET and collector GET are denied; logout is allowed', async () => {
  for (const [controller, handler] of [['TasksController','futureQuery'], ['WeeklyProgressController','list']]) {
    await assert.rejects(async () => request(controller, handler).run(), error => error.getStatus() === 403);
  }
  assert.equal(await request('AuthController', 'logout', 'POST').run(), true);
});
test('ordinary active accounts retain writes; disabled accounts are rejected', async () => {
  assert.equal(await request('TasksController', 'createTask', 'POST', {read_only:false,is_active:true}).run(), true);
  await assert.rejects(async () => request('TasksController', 'listProjects', 'GET', {read_only:false,is_active:false}).run(), error => error.getStatus() === 401);
});
const { TasksService } = require('../src/modules/tasks/tasks.service');
const { ClosuresService } = require('../src/modules/closures/closures.service');
const { AuthService } = require('../src/modules/auth/auth.service');
const viewer = { userId: 3, roles: ['viewer'], managedDeptIds: [], deptId: 7, readOnly: true };
test('visitor daily report is globally readable without creating read receipts', async () => {
  const service = Object.create(TasksService.prototype);
  service.closures = { recipient: async () => 999 };
  service.previousReportWorkday = async () => '2026-10-28';
  service.queryDailyReport = async date => ({ date, items: [{projectId:99}] });
  service.tasks = { query: async () => { assert.fail('visitor read must not write receipts'); } };
  assert.deepEqual(await service.dailyReport(viewer), {date:'2026-10-28',items:[{projectId:99}]});
  assert.equal((await service.dailyReportStatus(viewer)).unreadCount, 0);
});
test('visitor can read unrelated closure projects but cannot handle them', async () => {
  const service = new ClosuresService({manager:{}}, {});
  assert.equal(await service.canRead(viewer, 999), true);
  assert.equal(await service.canHandle(viewer, 999), false);
});
test('auth current user hides elevated roles and managed departments behind read-only', async () => {
  const service = new AuthService({findOne:async()=>({id:3,name:'visitor',readOnly:true})},{find:async()=>[{role:'admin'}]},{find:async()=>[{id:7}]},{},{});
  const user = await service.getCurrent(3);
  assert.equal(user.readOnly,true);
  assert.deepEqual(user.roles,['viewer']);
  assert.deepEqual(user.managedDeptIds,[]);
  assert.deepEqual(service.mockUserInfo('viewer').mockRoles,['viewer']);
});
test('visitor approval history has global filters, without participation checks', async () => {
  const service=Object.create(TasksService.prototype);
  service.tasks={manager:{query:async(sql,parameters)=>{
    assert.equal(parameters[1],true);
    assert.match(sql,/\$2::boolean/);
    return [];
  }}};
  assert.deepEqual(await service.approvalRecords(viewer,'history'),[]);
});
test('every registered business route is audited: queries allowed, mutations denied', async () => {
  const { METHOD_METADATA } = require('@nestjs/common/constants');
  const { RequestMethod } = require('@nestjs/common');
  const controllers = [
    require('../src/modules/tasks/tasks.controller').TasksController,
    require('../src/modules/tasks/weekly-progress.controller').WeeklyProgressController,
    require('../src/modules/closures/closures.controller').ClosuresController,
    require('../src/modules/departments/departments.controller').DepartmentsController,
    require('../src/modules/users/users.controller').UsersController,
    require('../src/modules/holidays/holidays.controller').HolidaysController,
    require('../src/modules/feishu/feishu.controller').FeishuController,
  ];
  const excludedQueries = new Set(['TasksController.myTodo','WeeklyProgressController.list','ClosuresController.notices','ClosuresController.access']);
  for (const controller of controllers) {
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const method = Reflect.getMetadata(METHOD_METADATA, controller.prototype[name]);
      if (method === undefined) continue;
      const allowed = method === RequestMethod.GET && !excludedQueries.has(controller.name+'.'+name);
      const action = request(controller.name,name,RequestMethod[method]).run;
      if (allowed) assert.equal(await action(),true,controller.name+'.'+name);
      else await assert.rejects(action,error=>error.getStatus()===403,controller.name+'.'+name);
    }
  }
});
test('mock viewer persists protection and real login classification failure admits nobody', async () => {
  let stored;
  const users = {findOne:async()=>stored,create:row=>row,save:async row=>{stored={...row,id:3};Object.assign(row,stored);return stored;}};
  const roleRows=[];
  const roles={delete:async()=>{},create:r=>r,save:async rows=>{roleRows.push(...(Array.isArray(rows)?rows:[rows]));},find:async()=>roleRows};
  const service=new AuthService(users,roles,{find:async()=>[]},{signAsync:async()=> 'signed'}, {syncSingleUser:async()=>{throw new Error('organization unavailable');}});
  const result=await service.upsertAndSign(service.mockUserInfo('viewer'),['viewer']);
  assert.equal(stored.readOnly,true);
  assert.equal(result.user.readOnly,true);
  assert.deepEqual(result.user.roles,['viewer']);
  stored=undefined;
  await assert.rejects(()=>service.upsertAndSign({user_id:'real-user'}),/organization unavailable/);
  assert.equal(stored,undefined);
});
