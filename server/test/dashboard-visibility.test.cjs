const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

test('ordinary nonparticipant sees active project overview without it becoming their project', async () => {
  const service = Object.create(TasksService.prototype);
  const rows = [{id:42,name:'Other department',deptId:2,status:'active'}, {id:43,name:'Archived',deptId:2,status:'archived'}];
  let onlyMine = false, status;
  const query = {
    where: (_sql, params) => { status = params.status; return query; },
    andWhere: () => { onlyMine = true; return query; },
    orderBy: () => query,
    getMany: async () => onlyMine ? [] : rows.filter(p => p.status === status),
  };
  const participation = {select: () => participation, where: () => participation, andWhere: () => participation, getRawMany: async () => []};
  Object.assign(service, {
    projects: {createQueryBuilder: () => query},
    tasks: {find: async () => [{id:420,projectId:42,parentId:null,title:'Task',status:'doing'}], createQueryBuilder: () => participation},
    exemptedTaskIds: async () => new Set(), projectOwnerIdsMap: async () => new Map([[42,[99]]]),
  });
  const result = await service.dashboardOverview({userId:7,roles:['member'],deptId:1,managedDeptIds:[]});
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 42);
  assert.equal(result[0].mine, false);
  assert.equal(result[0].stages[0].title, 'Task');
});
