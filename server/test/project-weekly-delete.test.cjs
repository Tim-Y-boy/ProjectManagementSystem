const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TasksService}=require('../src/modules/tasks/tasks.service');

test('project deletion rejects authored weekly history before changing tasks or report records',async()=>{
  const service=Object.create(TasksService.prototype);
  const statements=[];
  service.projects={findOne:async()=>({id:1,status:'active',closureState:'none',terminationState:'none',planLocked:false}),manager:{transaction:async fn=>fn({
    query:async(sql)=>{statements.push(sql);return sql.includes('FROM project_weekly_reports')?[{id:9}]:[];},
    getRepository:()=>{assert.fail('must not mutate task/project repositories after detecting authored history');},
  })}};
  await assert.rejects(service.deleteProject({userId:1,roles:['admin']},1),/已有周报记录/);
  assert.match(statements[0],/FOR UPDATE/);
  assert.ok(statements.every(sql=>!sql.startsWith('DELETE')));
});
