const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const helper = { exports: {}, URL };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/modules/tasks/daily-report.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, helper);
const { dailyReportDate } = helper.exports;
const scopeHelper = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/modules/tasks/daily-report-scope.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, scopeHelper);
const { dailyReportProjectScope } = scopeHelper.exports;
test('report defaults to yesterday in Shanghai across UTC day and year boundaries', () => {
  assert.equal(dailyReportDate(undefined, new Date('2026-10-20T16:05:00Z')), '2026-10-20');
  assert.equal(dailyReportDate(undefined, new Date('2026-01-01T00:05:00Z')), '2025-12-31');
  assert.equal(dailyReportDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-30', '2026-13-01', 'invalid', '2999-01-01', '2026-1-1']) assert.throws(() => dailyReportDate(value));
});
const source = ts.createSourceFile('service.ts', fs.readFileSync(path.join(__dirname, '../src/modules/tasks/tasks.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const method = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'TasksService').members.filter(node => ['dailyReport', 'dailyReportStatus', 'previousReportWorkday', 'queryDailyReport', 'sendDailyWorkReport', 'sendDailyWorkReportWithSummary'].includes(node.name?.getText(source)));
function setup() {
  const clauses = [];
  const qb = {};
  for (const name of ['innerJoin', 'leftJoin', 'select', 'where', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[name] = (...args) => { clauses.push([name, ...args]); return qb; };
  }
  qb.getRawMany = async () => [{ id: '1', content: '完成技术评审' }];
  const context = { dailyReportProjectScope, dailyReportCard: report => ({ card: report, fallback: '' }), dailyReportDate, ForbiddenException: Error, BadRequestException: Error, Task: {}, Project: {}, User: {}, Department: {} };
  vm.runInNewContext(ts.transpileModule(`class Subject { ${method.map(node => node.getText(source)).join('\n')} }\nglobalThis.subject = new Subject();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText, context);
  const subject = context.subject;
  subject.weeklyNotifications = { withLeaderSummary: async (_now, deliver) => deliver(null) };
  subject.closures = { recipient: async () => 42 };
  subject.holidays = { isWorkday: async date => ![0, 6].includes(new Date(date).getUTCDay()) };
  subject.dailyUpdates = { createQueryBuilder: () => qb };
  subject.tasks = { query: async () => [] };
  subject.isAdminOrLeader = user => user.roles.some(role => ['admin', 'leader'].includes(role));
  subject.isDeptHead = user => user.roles.includes('dept_head');
  return { subject, clauses };
}

test('all users can read reports; ordinary roles are scoped to owned or executed projects', async () => {
  const { subject, clauses } = setup();
  for (const role of ['member', 'leader', 'dept_head']) {
    clauses.length = 0;
    assert.equal((await subject.dailyReportStatus({ userId: 9, roles: [role] })).canView, true);
    await subject.dailyReport({ userId: 9, roles: [role] }, '2026-01-01');
    const scope = clauses.find(row => row[1] === dailyReportProjectScope());
    assert.equal(scope[2].reportUserId, 9);
    assert.match(scope[1], /participation.project_id=project.id/);
    assert.match(scope[1], /report_assignee.role='assignee'/);
    assert.match(scope[1], /project.owner_id/);
    assert.match(scope[1], /project_owners/);
    assert.doesNotMatch(scope[1], /progress.user_id|employee.dept_id|participation.id=task.id/);
  }
  for (const user of [{ userId: 9, roles: ['admin'] }, { userId: 42, roles: ['dept_head'] }]) {
    clauses.length = 0;
    const report = await subject.dailyReport(user, '2026-01-01');
    assert.equal(report.items.length, 1);
    assert.ok(!clauses.some(row => row[1] === dailyReportProjectScope()));
  }
  assert.ok(!clauses.some(row => row[1] === 'employee.dept_id IN (:...departments)'));
  const period = clauses.find(row => row[1] === 'progress.created_at >= :start AND progress.created_at < :end');
  assert.equal(period[2].start, '2026-01-01T00:00:00+08:00');
  assert.equal(period[2].end, '2026-01-01T16:00:00.000Z');
});

test('unread dates use the same project scope while existing privileged and read-only access stays unchanged', async () => {
  const { subject } = setup();
  const queries = [];
  subject.tasks.query = async (sql, args) => { queries.push([sql, args]); return []; };
  await subject.dailyReportStatus({ userId: 9, roles: ['member'] });
  const unread = queries.find(([sql]) => sql.includes('generate_series'));
  assert.ok(unread[0].includes(dailyReportProjectScope('$1')));
  assert.equal(unread[1][0], 9);
  assert.match(unread[0], /AT TIME ZONE 'Asia\/Shanghai'/);
  queries.length = 0;
  await subject.dailyReportStatus({ userId: 9, roles: ['admin'] });
  assert.ok(!queries.find(([sql]) => sql.includes('generate_series'))[0].includes('report_assignee'));
  queries.length = 0;
  const result = await subject.dailyReportStatus({ userId: 9, roles: ['member'], readOnly: true });
  assert.equal(result.canView, true);
  assert.equal(result.unreadCount, 0);
  assert.equal(queries.length, 0);
});
test('previous workday respects rest days and makeup days', async () => {
  const { subject } = setup();
  assert.equal(await subject.previousReportWorkday(new Date('2026-10-19T01:00:00Z')), '2026-10-16');
  subject.holidays.isWorkday = async date => date === '2026-10-18';
  assert.equal(await subject.previousReportWorkday(new Date('2026-10-19T01:00:00Z')), '2026-10-18');
});
test('daily notification skips rest days, uses GM, sends empty report and deduplicates', async () => {
  const { subject } = setup();
  const calls = [];
  subject.queryDailyReport = async date => ({ date, items: [] });
  subject.systemUrl = path => 'https://reports.example.test' + path;
  subject.feishuNotify = { hasSuccessfulSince: async () => false, sendCard: async (...args) => { calls.push(args); return { success: true }; } };
  assert.equal((await subject.sendDailyWorkReport(new Date('2026-10-18T01:00:00Z'))).skipped, 'rest_day');
  assert.equal((await subject.sendDailyWorkReport(new Date('2026-10-19T01:00:00Z'))).date, '2026-10-16');
  assert.equal(calls[0][1], 42);
  subject.feishuNotify.hasSuccessfulSince = async () => true;
  assert.equal((await subject.sendDailyWorkReport(new Date('2026-10-19T01:00:00Z'))).skipped, 'already_sent');
  subject.closures.recipient = async () => null;
  assert.equal((await subject.sendDailyWorkReport(new Date('2026-10-19T01:00:00Z'))).skipped, 'no_general_manager');
  assert.equal(calls.length, 1);
});

test('default endpoint resolves the latest workday rather than a browser date', async () => {
  const {subject} = setup();
  subject.previousReportWorkday = async () => '2026-10-20';
  assert.equal((await subject.dailyReport({userId: 1, roles: ['admin']})).date, '2026-10-20');
});
