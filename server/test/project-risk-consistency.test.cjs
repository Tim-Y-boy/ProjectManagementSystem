const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const today = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const day = offset => new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const admin = {userId:1,roles:['admin'],managedDeptIds:[]};
const projectRows = Array.from({length:7},(_,i)=>({id:i+1,status:'active'}));
const task = (id,projectId,parentId,status,offset) => ({id,projectId,parentId,status,dueAt:offset==null?null:day(offset)});
const rows = [
 task(10,1,null,'doing',-10),task(11,1,10,'doing',10),
 task(20,2,null,'doing',0),task(21,2,20,'doing',2),
 task(30,3,null,'doing',-1),task(31,3,30,'rejected',-1),task(32,3,30,'todo',1),
 task(40,4,null,'doing',-4),task(41,4,40,'done',-4),
 task(50,5,null,'cancelled',-1),task(60,6,null,'todo',3),task(70,7,null,'todo',4),
];
function fixture() {
 const s=Object.create(TasksService.prototype);
 const qb={where(){return this},andWhere(){return this},orderBy(){return this},addOrderBy(){return this},getMany:async()=>projectRows};
 const tq={select(){return this},where(){return this},andWhere(){return this},getRawMany:async()=>rows.filter(t=>!['done','cancelled'].includes(t.status)).map(t=>({project_id:t.projectId,due_at:t.dueAt}))};
 Object.assign(s,{projects:{createQueryBuilder:()=>qb},tasks:{find:async()=>rows.filter(t=>t.status!=='cancelled'),createQueryBuilder:()=>tq,count:async()=>0},projectOwnerIdsMap:async()=>new Map(),exemptedTaskIds:async()=>new Set()});
 return s;
}
test('project filters use effective leaves and mutually exclusive risk, matching overview',async()=>{
 const s=fixture();
 for(const [filter,expected] of [['atRisk',[2,6]],['overdue',[3]],['done',[4]]]){
  const result=await s.listProjects(admin,undefined,'active',false,filter);
  assert.deepEqual(result.map(p=>p.id),expected,filter);
 }
 const overview=await s.dashboardOverview(admin);
 assert.deepEqual(overview.filter(p=>p.riskLevel===1).map(p=>p.id),[2,6]);
 assert.deepEqual(overview.filter(p=>p.riskLevel===2).map(p=>p.id),[3]);
 assert.deepEqual(overview.filter(p=>p.allTasksDone).map(p=>p.id),[4]);
});
test('zero overdue overview yields an empty overdue destination despite stale parent dates',async()=>{
 const s=fixture();s.tasks.find=async()=>rows.filter(t=>t.projectId===1);
 const result=await s.listProjects(admin,undefined,'active',false,'overdue');
 assert.equal(result.length,0);
});

test('project health uses Beijing day boundaries, completed and cancelled tasks never add risk',()=>{
 const {projectHealth}=require('../src/modules/tasks/project-health');
 assert.deepEqual(projectHealth([{id:1,status:'todo',dueAt:'2026-10-30'}],'2026-10-30'),{riskLevel:1,allTasksDone:false});
 assert.deepEqual(projectHealth([{id:1,status:'todo',dueAt:'2026-10-29'}],'2026-10-30'),{riskLevel:2,allTasksDone:false});
 assert.deepEqual(projectHealth([{id:1,status:'done',dueAt:'2026-01-01'},{id:2,status:'cancelled',dueAt:'2026-01-01'}],'2026-10-30'),{riskLevel:0,allTasksDone:true});
 assert.deepEqual(projectHealth([],'2026-10-30'),{riskLevel:0,allTasksDone:false});
});
