// Run: node -r ts-node/register/transpile-only --test test/project-closures.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { of } = require('rxjs');
const { completionFacts, validateClosure, validateSupplement, beijingDate, closureTimingAlerts } = require('../src/modules/closures/closure-rules');
const { ClosuresService } = require('../src/modules/closures/closures.service');
const { ProjectFreezeInterceptor } = require('../src/modules/closures/project-freeze.interceptor');
const { renderClosureReport } = require('../src/modules/closures/closure-report');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const user = (id, roles = ['member']) => ({ userId: id, roles });
const application = {background:'项目背景',objective:'项目目标',outcome:'项目成果',noCharterReason:'历史项目',charterFileIds:[],scope:{version:1,projectDeptId:1,heads:{2:40},decisions:[]}};
const checked=[1,2].map(departmentId=>({departmentId,items:[{answer:'yes',note:''}]}));
const done = (id, date, extra = {}) => ({ id, title: `任务${id}`, status: 'done', completed_at: new Date(date), ...extra });
const facts = (now = '2026-09-17T02:00:00Z', end = '2026-09-20') => completionFacts([done(1, '2026-09-14T02:00:00Z')], end, new Date(now));

test('latest scheduled task done cannot hide unfinished earlier task', () => {
  const f = completionFacts([done(1, '2026-09-14T02:00:00Z', { due_at: '2026-09-20' }), { id: 2, status: 'doing', due_at: '2026-09-01' }], '2026-09-20');
  assert.equal(f.ready, false); assert.equal(f.completedAt, null);
  assert.throws(() => validateClosure(f, {}), /全部有效任务/);
});
test('completion uses leaf acceptance, not parent refresh or latest supplementary activity', () => {
  const f = completionFacts([done(1, '2026-09-17T02:00:00Z'), done(2, '2026-09-14T02:00:00Z', { parent_id: '1', updated_at: new Date('2026-09-17') })], '2026-09-20', new Date('2026-09-17T04:00Z'));
  assert.equal(f.completedDate, '2026-09-14'); assert.equal(f.waitingDays, 3);
});
test('empty, all cancelled, missing timestamps and rejected tasks cannot close', () => {
  for (const tasks of [[], [{ id: 1, status: 'cancelled' }], [{ id: 1, status: 'done' }], [{ id: 1, status: 'rejected' }]]) assert.equal(completionFacts(tasks, '2026-09-20').ready, false);
});
test('cancelled tasks do not block otherwise complete project', () => {
  assert.equal(completionFacts([done(1, '2026-09-01'), { id: 2, status: 'cancelled' }], '2026-09-20').ready, true);
});
test('three-day delay is recorded without requiring a reason to submit', () => {
  assert.doesNotThrow(() => validateClosure(facts('2026-09-16T02:00Z'), {}));
  assert.doesNotThrow(() => validateClosure(facts(), {}));
  assert.deepEqual(closureTimingAlerts(facts('2026-09-16T02:00Z')), []);
  assert.match(closureTimingAlerts(facts()).join('\n'), /完成后 3 天才申请结项/);
});
test('Beijing midnight determines calendar day, not UTC day', () => {
  assert.equal(beijingDate(new Date('2026-09-16T16:00:00Z')), '2026-09-17');
  assert.equal(facts('2026-09-16T15:59:59Z').waitingDays, 2);
  assert.equal(facts('2026-09-16T16:00:00Z').waitingDays, 3);
});
test('late application is allowed without explanation and automatically flagged', () => {
  assert.doesNotThrow(() => validateClosure(facts('2026-09-14T12:00Z', '2026-09-14'), {}));
  const f = facts('2026-09-15T02:00Z', '2026-09-14');
  assert.equal(f.lateDays, 0); assert.equal(f.requestOverdueDays, 1);
  assert.doesNotThrow(() => validateClosure(f, {}));
  assert.match(closureTimingAlerts(f).join('\n'), /申请结项时已超过批准截止日期 1 天/);
});

test('report separates application delay from approval waiting and flags late effective closure', () => {
  const f = facts('2026-09-14T02:00Z', '2026-09-14');
  const alerts = closureTimingAlerts({ ...f, closedAt: '2026-09-16T16:00:00Z', approvalWaitingDays: 3 });
  assert.match(alerts.join('\n'), /验收完成至结项生效相隔 3 天/);
  assert.match(alerts.join('\n'), /申请前 0 天，审批等待 3 天/);
  assert.match(alerts.join('\n'), /结项生效时已超过批准截止日期 3 天/);
  assert.doesNotMatch(alerts.join('\n'), /才申请结项/);
});
test('missing deadline and future completion are rejected', () => {
  assert.throws(() => validateClosure(facts(undefined, null), { delayReason: '原因' }), /截止日期/);
  assert.throws(() => facts('2026-09-13T02:00Z'), /验收时间晚于/);
});
test('reasonable supplement compares work date, including deadline itself', () => {
  assert.doesNotThrow(() => validateSupplement('2026-05-14', '2026-05-15'));
  assert.doesNotThrow(() => validateSupplement('2026-05-15', '2026-05-15'));
  assert.throws(() => validateSupplement('2026-05-16', '2026-05-15'), /工作日期超过/);
  assert.throws(() => validateSupplement('2026-05-14', null), /未设置截止/);
});

function workflow() {
  const f = { ...facts(), project: { id: 9, dept_id:1, name: '测试项目', status: 'active', closure_state: 'none', plan_locked: true }, tasks: [] };
  const state = { row: null, events: [], updates: [], pendingChange: false };
  const query = async (sql, p = []) => {
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ held: true }];
    if(sql.startsWith('SELECT version,data FROM closure_application_drafts')||sql.startsWith('DELETE FROM closure_application_drafts'))return [];
    if(sql.startsWith('SELECT version,rules'))return [{version:1,rules:[1,2].map(id=>({id,departmentId:id,departmentName:'部门'+id,enabled:true,mode:'required',checklist:['核验']}))}];
    if(sql.startsWith('SELECT d.id,d.name,d.head_user_id'))return [1,2].map(id=>({id,name:'部门'+id,head_user_id:40,head_name:'核验人',is_active:true}));
    if (sql.startsWith('SELECT id FROM plan_changes')) return state.pendingChange ? [{ id: 7 }] : [];
    if (sql.startsWith('SELECT id,name FROM users WHERE is_active')) return [{id:30,name:'总经理'},{id:40,name:'核验人'}];
    if (sql.startsWith('SELECT id,name FROM users')) return [{ id: p[0], name: `用户${p[0]}` }];
    if (sql.startsWith('INSERT INTO project_closures')) {
      state.row = { id: 1, project_id: p[0], requester_id: p[1], approver_id: p[2], snapshot: structuredClone(p[3]), delay_reason: p[4], overdue_reason: p[5], status: 'pending', requested_at: new Date('2026-09-17T02:00Z') }; return [state.row];
    }
    if (sql.startsWith('SELECT project_id FROM project_closures')) return state.row ? [state.row] : [];
    if (sql.startsWith('SELECT * FROM project_closures')) return [state.row];
    if (sql.startsWith('UPDATE projects')) { f.project.closure_state = sql.includes("'closed'") ? 'closed' : sql.includes("'pending'") ? 'pending' : 'none'; if (f.project.closure_state === 'closed') f.project.status = 'archived'; return []; }
    if (sql.startsWith('UPDATE project_closures SET snapshot')) {
      state.row.snapshot=structuredClone(p[1]);
      if(p.length>2)Object.assign(state.row,{status:p[2],review_comment:p[3],reviewed_at:p[4]});
      return [[state.row],1];
    }
    if (sql.startsWith('UPDATE project_closures')) { Object.assign(state.row, { status: p[1], review_comment: p[2], reviewed_at: p[3], report: p[4] }); return [[state.row],1]; }
    if (sql.startsWith('SELECT d.*')) return state.updates;
    if (sql.includes('max(created_at)')) return [{ at: new Date('2026-09-17T01:00Z') }];
    if (sql.startsWith('SELECT * FROM project_plan_baselines')) return [];
    if (sql.startsWith('SELECT count(*)::int')) return [{count:0}];
    if (sql.startsWith('UPDATE closure_notices') || sql.startsWith('SELECT * FROM task_assets') || sql.startsWith('SELECT c.*') || sql.startsWith('SELECT * FROM project_delay_records') || sql.startsWith('SELECT n.*')) return [];
    throw new Error('Unhandled SQL ' + sql);
  };
  const m = { query }; const db = { manager: m, query, transaction: (fn) => fn(m) };
  const s = new ClosuresService(db, { syncReviewCards: async () => {}, sendCard: () => { throw new Error('No live notifications in tests'); } });
  s.owners = async () => [{ id: '16', name: '负责人' }]; s.facts = async () => structuredClone(f);
  s.recipient = async () => 30; s.observeProject = async () => {};
  s.enqueue = async (...args) => state.events.push(args.slice(1)); s.enqueueHr = async () => state.events.push(['hr']);
  const originalSubmit=s.submit.bind(s);
  s.submit=async(u,id,body)=>originalSubmit(u,id,{...body,scope:{...body.scope,identity:require('../src/modules/closures/closure-department-rules').scopeIdentity(1,u.userId,[16],await query('SELECT d.id,d.name,d.head_user_id')),heads:{1:40,2:40}}});
  return { s, f, state };
}
test('administrator can apply on behalf of the owner without bypassing review or changing ownership', async () => {
  const { s, f, state } = workflow();
  assert.equal((await s.preview(user(1, ['admin']), 9)).ready, true);
  await s.submit(user(1, ['admin']), 9, application);
  assert.equal(state.row.requester_id, 1);
  assert.equal(state.row.approver_id, 30);
  assert.equal(state.row.status, 'pending');
  assert.equal(state.row.snapshot.owners[0].id, '16');
  assert.equal(f.project.closure_state, 'pending');
});
test('unrelated ordinary users and leaders cannot apply for closure', async () => {
  for (const roles of [['member'], ['leader']]) {
    const { s, state } = workflow();
    await assert.rejects(s.preview(user(99, roles), 9), { status: 403 });
    await assert.rejects(s.submit(user(99, roles), 9, application), { status: 403 });
    assert.equal(state.row, null);
  }
});
test('owner submission freezes, stays active until approval, duplicate submission rejected', async () => {
  const { s, f, state } = workflow(); await s.submit(user(16), 9, application);
  assert.match(state.row.snapshot.timingAlerts.join('\n'), /完成后 3 天才申请结项/);
  assert.equal(f.project.status, 'active'); assert.equal(f.project.closure_state, 'pending');
  await assert.rejects(s.submit(user(16), 9, application), /重复提交/);
});
test('pending plan change and missing reviewer prevent submission', async () => {
  const a = workflow(); a.state.pendingChange = true; await assert.rejects(a.s.submit(user(16), 9, {...application,delayReason:'出差' }), /计划变更/);
  const b = workflow(); b.s.recipient = async () => null; await assert.rejects(b.s.submit(user(16), 9, {...application,delayReason:'出差' }), /总经办负责人/);
});
test('only assigned reviewer can approve, not owner or unrelated admin', async () => {
  const { s } = workflow(); await s.submit(user(16), 9, {...application,delayReason:'出差' });
  for (const u of [user(16), user(1, ['admin'])]) await assert.rejects(s.review(u, 1, true, ''), { status: 403 });
});
test('approval locks project and snapshots report once; waiting is based on application facts', async () => {
  const { s, f, state } = workflow(); await s.submit(user(16), 9, {...application,delayReason:'出差' }); await s.review(user(40), 1, true, 'verified',checked);
  f.waitingDays = 20; // 审批等待不改写负责人提交时的天数。
  await s.review(user(30), 1, true, '同意');
  assert.equal(f.project.closure_state, 'closed'); assert.equal(f.project.status, 'archived');
  assert.equal(state.row.report.waitingDays, 3); assert.equal(state.row.report.reportNumber, 'JX-1');
  assert.equal(state.events.filter((v) => v[0] === 'hr' || String(v[0]).endsWith(':lead-report')).length, 0);
  await assert.rejects(s.review(user(30), 1, true, ''), /已处理/);
});
test('changed completion evidence cannot be approved', async () => {
  const { s, f } = workflow(); await s.submit(user(16), 9, {...application,delayReason:'出差' }); await s.review(user(40), 1, true, 'verified',checked); f.completedAt = '2026-09-15T02:00:00.000Z';
  await assert.rejects(s.review(user(30), 1, true, ''), /依据已变化/); assert.equal(f.project.closure_state, 'pending');
});
test('a changed earlier task cannot hide behind unchanged latest completion time', async () => {
  const { s, f } = workflow(); f.tasks = [done(2, '2026-09-12T02:00Z')];
  await s.submit(user(16), 9, {...application,delayReason:'出差' }); await s.review(user(40), 1, true, 'verified',checked); f.tasks[0].due_at = '2026-09-30';
  await assert.rejects(s.review(user(30), 1, true, ''), /依据已变化/);
});
test('rejection requires reason and restores editable state without report', async () => {
  const { s, f, state } = workflow(); await s.submit(user(16), 9, {...application,delayReason:'出差' }); await s.review(user(40), 1, true, 'verified',checked);
  await assert.rejects(s.review(user(30), 1, false, ' '), /退回原因/);
  await s.review(user(30), 1, false, '原因需补充'); assert.equal(f.project.closure_state, 'none'); assert.equal(state.row.report, null);
});

function guardFixture(status, locked = true) {
  let ran = false; let released = false; let unlocked = false;
  const runner = { connect: async () => {}, release: async () => { released = true; }, manager: {}, query: async (sql) => {
    if (sql.includes('pg_try_advisory_lock')) return [{ held: locked }];
    if (sql.includes('pg_advisory_unlock')) { unlocked = true; return []; }
    return [{ closure_state: status, status: status === 'closed' ? 'archived' : 'active' }];
  } };
  const db = { createQueryRunner: () => runner, query: async () => [{ project_id: 9 }] };
  const guard = new ProjectFreezeInterceptor(db, { observeProject: async () => {} });
  return { guard, next: { handle: () => { ran = true; return of('ok'); } }, state: () => ({ ran, released, unlocked }) };
}
test('closed or pending project rejects every existing project/task/plan-change write route', async () => {
  for (const status of ['closed', 'pending']) for (const route of ['projects/:id', 'projects/:id/unarchive', 'projects/:id/plan-lock', 'tasks/:id/transition', 'tasks/:id/assets/upload', 'tasks/:id/daily-updates/:updateId/exempt', 'plan-changes/:id/approve', 'tasks', 'tasks/reorder', 'plan-changes']) {
    const f = guardFixture(status);
    await assert.rejects(f.guard.run({ route: { path: '/api/' + route }, params: { id: 1 }, body: { projectId: 9 }, method: 'POST' }, f.next), /结项/);
    assert.deepEqual(f.state(), { ran: false, released: true, unlocked: true });
  }
});
test('concurrent operation fails fast and releases connection without unlocking unowned lock', async () => {
  const f = guardFixture('none', false); await assert.rejects(f.guard.run({ route: { path: '/projects/:id' }, params: { id: 9 }, method: 'PUT' }, f.next), { status: 409 });
  assert.deepEqual(f.state(), { ran: false, released: true, unlocked: false });
});
test('read and save-as-template remain available when closed', async () => {
  const f = guardFixture('closed'); assert.equal(await f.guard.run({ route: { path: '/projects/:id/save-as-template' }, params: { id: 9 }, method: 'POST' }, f.next), 'ok');
});
test('acknowledgement restricted to receiver and never substitutes for approval', async () => {
  let n = { id: 1, recipient_id: '30', kind: 'supplement_notice', acknowledged_at: null };
  const m = { query: async (sql) => { if (sql.startsWith('UPDATE')) {n.acknowledged_at ||= 'first acknowledgement';return [[n],1];} return [n]; } };
  const s = new ClosuresService({ transaction: (f) => f(m) }, {});
  await assert.rejects(s.acknowledge(user(1, ['admin']), 1), { status: 403 });
  await s.acknowledge(user(30), 1); await s.acknowledge(user(30), 1); assert.equal(n.acknowledged_at, 'first acknowledgement');
  n.kind = 'closure_review'; await assert.rejects(s.acknowledge(user(30), 1), /不能以知晓代替审批/);
});
test('report exports escape user content; do not embed scripts or resource URLs', () => {
  const html = renderClosureReport({ report: { project: { name: '<script>alert(1)</script>' }, owners: [], tasks: [], delays: [], updates: [{ content: '<img src=x onerror=alert(1)>' }], assets: [], changes: [] } });
  assert.equal(html.includes('<script>'), false); assert.equal(html.includes('<img'), false); assert.ok(html.includes('&lt;script&gt;'));
});

test('exported report highlights timing facts for HR follow-up without empty reason fields', () => {
  const html = renderClosureReport({ report: { project: { name: '测试项目' }, owners: [{ name: '负责人A' }], tasks: [], delays: [], updates: [], assets: [], changes: [], timingAlerts: ['全部任务验收完成后 3 天才申请结项。', '申请结项时已超过批准截止日期 2 天。'] } });
  assert.match(html, /全部任务验收完成后 3 天才申请结项/);
  assert.match(html, /申请结项时已超过批准截止日期 2 天/);
  assert.match(html, /HR 和领导.*项目负责人/);
  assert.doesNotMatch(html, /未触发必填|延迟申请原因|超期申请原因/);
});
test('reasonable supplement authorization awaits asynchronous owner checks', async () => {
  const s = Object.create(TasksService.prototype);
  s.tasks = { findOne: async () => ({ id: 1, projectId: 9, status: 'done' }) };
  s.projects = { findOne: async () => ({ id: 9, planLocked: true }) };
  s.canManageProject = async () => false;
  s.closures = { markSupplement: () => assert.fail('unauthorized mark'), revokeSupplement: () => assert.fail('unauthorized revoke') };
  await assert.rejects(s.exemptDailyUpdate(user(99), 1, 2, '原因'), { status: 403 });
  await assert.rejects(s.unexemptDailyUpdate(user(99), 1, 2), { status: 403 });
});
test('read authorization does not grant unrelated project access to ordinary owner', async () => {
  const s = new ClosuresService({ manager: { query: async () => [] } }, {});
  s.recipient = async () => 30; s.owners = async () => [{ id: '16' }];
  assert.equal(await s.canRead(user(99), 9), false);
  assert.equal(await s.canRead(user(16), 9), true);
  assert.equal(await s.canRead(user(30), 9), true);
});
test('missing, inactive or ambiguous recipient never falls back to arbitrary administrator', async () => {
  const saved = process.env.PLAN_FINAL_APPROVER_USER_ID;
  delete process.env.PLAN_FINAL_APPROVER_USER_ID;
  try {
    for (const rows of [[], [{ id: '1' }, { id: '2' }]]) {
      const s = new ClosuresService({ manager: { query: async () => rows } }, {});
      assert.equal(await s.recipient('gm'), null);
    }
    process.env.PLAN_FINAL_APPROVER_USER_ID = 'not-an-id';
    const s = new ClosuresService({ manager: { query: async () => assert.fail('invalid ID query') } }, {});
    assert.equal(await s.recipient('gm'), null);
  } finally { if (saved === undefined) delete process.env.PLAN_FINAL_APPROVER_USER_ID; else process.env.PLAN_FINAL_APPROVER_USER_ID = saved; }
});
test('service-layer editing and legacy restoration cannot bypass a closed project', async () => {
  const s = Object.create(TasksService.prototype);
  const project = { id: 9, closureState: 'closed', status: 'archived', planLocked: false };
  s.projects = { findOne: async () => project, save: () => assert.fail('closed project must not save') };
  for (const action of [() => s.updateProject(user(1, ['admin']), 9, {}), () => s.deleteProject(user(1, ['admin']), 9), () => s.unarchiveProject(user(1, ['admin']), 9), () => s.assertPlanEditable(9), () => s.assertProjectPlanLocked(9)]) await assert.rejects(action, /结项/);
});
