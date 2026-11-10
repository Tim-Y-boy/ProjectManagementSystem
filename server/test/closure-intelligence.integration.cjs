// Isolated localhost schema; no model calls and no real notification transport.
const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const env=require('dotenv').parse(fs.readFileSync('.env'));
if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST||'localhost'))throw Error('Local database only');
const {DataSource}=require('typeorm');const {AllEntities}=require('../src/entities');
const {ClosureRuleConfigService}=require('../src/modules/closures/closure-rule-config.service');
const {ClosuresService}=require('../src/modules/closures/closures.service');
const {CharterAnalysisService}=require('../src/modules/closures/charter-analysis.service');
const {renderClosureReport}=require('../src/modules/closures/closure-report');
const {config}=require('../src/config/config');
const schema=`closure_ai_it_${process.pid}`;const options={type:'postgres',host:env.DB_HOST||'localhost',port:Number(env.DB_PORT||5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE};
const control=new DataSource(options);let db,created=false;const paths=[];let checks=0;
const check=value=>{assert.ok(value);checks++;};const user=(id,roles=['member'])=>({userId:id,roles});
async function main(){
 await control.initialize();await control.query(`CREATE SCHEMA ${schema}`);created=true;
 db=new DataSource({...options,schema,extra:{options:`-c search_path=${schema}`},entities:AllEntities,migrations:[path.resolve('src/migrations/*.ts')]});await db.initialize();await db.runMigrations();
 await db.query(`INSERT INTO users(id,name,feishu_user_id) SELECT n,'用户'||n,'test-'||n FROM generate_series(1,15) n`);
 await db.query(`INSERT INTO user_roles(user_id,role) VALUES(1,'admin'),(2,'leader')`);
 await db.query(`INSERT INTO departments(id,feishu_dept_id,name,head_user_id) SELECT n,'dept-'||n,'部门'||n,n+2 FROM generate_series(1,9) n`);
 process.env.PLAN_FINAL_APPROVER_USER_ID='15';
 const rules=new ClosureRuleConfigService(db);await assert.rejects(rules.list(user(14)),{status:403});checks++;
 await assert.rejects(rules.list(user(14,['admin'])),{status:403});checks++; // stale/forged token role is not enough
 let settings=await rules.list(user(1,['admin']));check(settings.rules.length===8);
 for(const rule of [...settings.rules])settings=await rules.save(user(1,['admin']),{version:settings.version,rule:{...rule,departmentId:rule.id}});
 check((await rules.list(user(3))).version===settings.version); // derived head role
 const previous=settings.version;
 settings=await rules.save(user(2,['leader']),{version:settings.version,rule:{departmentId:9,mode:'conditional',enabled:true,question:'是否有新增业务',boundary:'有该业务明确依据时参与',checklist:['核实交付']}});
 await assert.rejects(rules.save(user(1),{version:previous,rule:settings.rules[0]}),{status:409});checks++;
 const s=new ClosuresService(db,{syncReviewCards:async()=>{},sendCard:async()=>{throw Error('No real notifications');}},rules);
 const [p]=await db.query(`INSERT INTO projects(name,created_by,owner_id,dept_id,end_at,plan_locked) VALUES('生产项目',1,1,8,CURRENT_DATE,true) RETURNING *`);
 await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'完成任务',1,'done',CURRENT_DATE,NOW()-INTERVAL '1 hour')`,[p.id]);
 const preview=await s.preview(user(1),Number(p.id));
 const draftData={background:'未完成草稿',objective:'',outcome:'',noCharterReason:'',charterFileIds:[]};
 const draft=await s.saveDraft(user(1),+p.id,{version:0,data:draftData});check(draft.version===1);
 const draft2=await s.saveDraft(user(1),+p.id,{version:1,data:{...draftData,outcome:'人工成果'}});check(draft2.version===2);
 await assert.rejects(s.saveDraft(user(1),+p.id,{version:1,data:draftData}),{status:409});checks++;
 check((await s.preview(user(1),+p.id)).draft.data.outcome==='人工成果');
 const decisions=settings.rules.filter(r=>r.mode==='conditional'&&r.departmentId!==8).map(r=>({ruleId:r.id,answer:r.id===9?'yes':'no',reason:''}));
 const body={background:'背景',objective:'目标',outcome:'人工实际成果',noCharterReason:'历史项目',charterFileIds:[],scope:{identity:preview.scope.identity,version:settings.version,projectDeptId:8,heads:Object.fromEntries(preview.scope.departments.map(d=>[d.id,Number(d.head_user_id)])),decisions}};
 await assert.rejects(s.submit(user(14),+p.id,body),{status:403});checks++;
 await assert.rejects(s.submit(user(1),+p.id,{...body,scope:{...body.scope,version:1}}),{status:409});checks++;
 await assert.rejects(s.submit(user(1),+p.id,{...body,scope:{...body.scope,decisions:[]}}),/确认/);checks++;
 const row=await s.submit(user(1),+p.id,body);check(row.snapshot.workflow.version===3);
 check(row.snapshot.workflow.reviews.length===3);check(row.snapshot.workflow.reviews.some(d=>d.departmentId===8));
 check((await db.query('SELECT * FROM closure_notices WHERE project_id=$1',[p.id])).length===3);
 await assert.rejects(s.review(user(5),+row.id,true,'通过'),/清单/);checks++;
 await s.review(user(5),+row.id,true,'核验 HR',{length:0}).catch(e=>check(e.status===400));
 await s.review(user(5),+row.id,true,'核验 HR',[{departmentId:3,items:settings.rules.find(r=>r.id===3).checklist.map(()=>({answer:'na',note:'该事项不适用'}))}]);
 await s.review(user(11),+row.id,true,'核验新增部门',[{departmentId:9,items:[{answer:'yes',note:''}]}]);
 await s.review(user(10),+row.id,true,'核验本部门',[{departmentId:8,items:settings.rules.find(r=>r.id===8).checklist.map(()=>({answer:'yes',note:''}))}]);
 await s.review(user(15),+row.id,true,'终审通过');
 const [closed]=await db.query('SELECT * FROM project_closures WHERE id=$1',[row.id]);check(closed.status==='approved');check(renderClosureReport(closed).includes('项目实际成果'));check(renderClosureReport(closed).includes('审核清单'));
 // HR head submitting their own project skips only their own review.
 const [hr]=await db.query(`INSERT INTO projects(name,created_by,owner_id,dept_id,end_at,plan_locked) VALUES('HR项目',1,5,3,CURRENT_DATE,true) RETURNING *`);
 await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'完成任务',1,'done',CURRENT_DATE,NOW()-INTERVAL '1 hour')`,[hr.id]);
 const hrBody={...body,scope:{...body.scope,identity:(await s.preview(user(5),+hr.id)).scope.identity,projectDeptId:3,decisions:settings.rules.filter(r=>r.mode==='conditional').map(r=>({ruleId:r.id,answer:'no'}))}};
 const hrRow=await s.submit(user(5),+hr.id,hrBody);check(hrRow.snapshot.workflow.stage==='final');check(hrRow.snapshot.workflow.reviews.length===0);
 // Both A and B are department heads and project owners. Only the submitter skips self review.
 const [joint]=await db.query(`INSERT INTO projects(name,created_by,owner_id,dept_id,end_at,plan_locked) VALUES('AB共同负责',1,8,6,CURRENT_DATE,true) RETURNING *`);
 await db.query('INSERT INTO project_owners(project_id,user_id) VALUES($1,10)',[joint.id]);
 await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'完成任务',1,'done',CURRENT_DATE,NOW()-INTERVAL '1 hour')`,[joint.id]);
 const makeBody=async(actor)=>{const scope=(await s.preview(actor,+joint.id)).scope;return {...body,scope:{...body.scope,identity:scope.identity,projectDeptId:6,decisions:settings.rules.filter(r=>r.mode==='conditional').map(r=>({ruleId:r.id,answer:'no'}))}};};
 const aBody=await makeBody(user(8));
 await assert.rejects(s.submit(user(10),+joint.id,aBody),{status:409});checks++; // cannot reuse A's preview as B
 for(const [actor,expected] of [[user(8),[3,8]],[user(10),[3,6]],[user(1,['admin']),[3,6,8]]]) {
  const submitted=await s.submit(actor,+joint.id,await makeBody(actor));
  assert.deepEqual(submitted.snapshot.workflow.reviews.map(r=>r.departmentId).sort((a,b)=>a-b),expected);checks++;
  check(!submitted.snapshot.workflow.reviews.some(r=>r.userId===actor.userId));
  await s.withdraw(actor,+submitted.id,'隔离测试切换提交人');
 }
 const staleOwnerBody=await makeBody(user(8));
 await db.query('DELETE FROM project_owners WHERE project_id=$1',[joint.id]);
 await assert.rejects(s.submit(user(8),+joint.id,staleOwnerBody),{status:409});checks++;
 await db.query('INSERT INTO project_owners(project_id,user_id) VALUES($1,10)',[joint.id]);
 const staleHeadBody=await makeBody(user(8));
 await db.query('UPDATE departments SET head_user_id=12 WHERE id=8');
 await assert.rejects(s.submit(user(8),+joint.id,staleHeadBody),{status:409});checks++;
 await db.query('UPDATE departments SET head_user_id=10 WHERE id=8');
 // Persisted worker results from a real DOCX extraction and fake model response.
 const [a]=await db.query(`INSERT INTO projects(name,created_by,owner_id,dept_id) VALUES('解析项目',1,1,8) RETURNING *`);
 const JSZip=require('jszip');const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>立项背景为自动化产线建设，目标是提高生产效率和产品质量。</w:t></w:r></w:p></w:body></w:document>');const buffer=await zip.generateAsync({type:'nodebuffer'});
 const file=await s.uploadCharter(user(1),+a.id,{buffer,size:buffer.length,originalname:'report.docx'});paths.push((await db.query('SELECT file_path FROM closure_application_files WHERE id=$1',[file.id]))[0].file_path);
 const worker=new CharterAnalysisService(db,rules);config.llm.enabled=true;config.llm.apiKey='offline-test-no-network';
 worker.callModel=async(sources,r)=>({fields:{background:{value:'产线建设',evidence:[{sourceId:sources[0].id,quote:'自动化产线建设'}]},outcome:{value:'不应保存'}},decisions:r.map(x=>({ruleId:x.id,answer:x.id===9?'yes':'unknown',reason:'需要核实',evidence:x.id===9?[{sourceId:sources[0].id,quote:'自动化产线建设'}]:[]}))});
 await assert.rejects(worker.start(user(14),+a.id,{fileIds:[+file.id]}),{status:403});checks++;
 const job=await worker.start(user(1),+a.id,{fileIds:[+file.id]});const duplicate=await worker.start(user(1),+a.id,{fileIds:[+file.id]});check(job.id===duplicate.id);
 await worker.processQueue();const result=await worker.latest(user(1),+a.id);check(result.status==='partial');check(result.result.fields.outcome===undefined);check(result.result.decisions.some(d=>d.ruleId===9));check(!result.result.decisions.some(d=>d.ruleId===8));
 await db.query('UPDATE projects SET end_at=CURRENT_DATE,plan_locked=true WHERE id=$1',[a.id]);
 await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'完成任务',1,'done',CURRENT_DATE,NOW()-INTERVAL '1 hour')`,[a.id]);
 const analyzedBody={...body,charterFileIds:[+file.id],noCharterReason:'',scope:{...body.scope,identity:(await s.preview(user(1),+a.id)).scope.identity,decisions:settings.rules.filter(r=>r.mode==='conditional').map(r=>({ruleId:r.id,answer:'no'}))}};
 const manual=await s.submit(user(1),+a.id,analyzedBody);
 check(manual.snapshot.approvalScope.decisions.some(d=>d.ruleId===9&&d.answer==='no'&&!d.reason));
 check(manual.snapshot.approvalScope.analysisResult.decisions.some(d=>d.ruleId===9&&d.answer==='yes'));
 check(Number(manual.snapshot.approvalScope.analysisId)===Number(job.id));
 check(manual.snapshot.application.outcome==='人工实际成果');
 settings=await rules.save(user(1),{version:settings.version,rule:{...settings.rules[8],question:'更新条件'}});check((await worker.latest(user(1),+a.id)).stale);
 console.log(JSON.stringify({checks,schema,result:'passed'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const p of paths)fs.unlinkSync(p);if(db?.isInitialized)await db.destroy();if(created)await control.query(`DROP SCHEMA ${schema} CASCADE`);if(control.isInitialized)await control.destroy();});
