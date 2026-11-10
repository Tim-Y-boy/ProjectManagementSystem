const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { ProjectWeeklyNotificationsService, weeklyLeaderLines } = require('../src/modules/tasks/project-weekly-notifications.service');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');
const { config } = require('../src/config/config');

function fixture(rows = [], weeks = ['2026-11-02']) {
  const delivered = new Set();
  const runner = {
    connect: async () => {}, release: async () => {},
    query: async (sql, args) => {
      if (sql.includes('pg_try')) return [{ locked: true }];
      if (sql.startsWith('SELECT 1')) return delivered.has(args[1]) ? [1] : [];
      if (sql.includes('FROM project_weekly_reports')) {
        const pendingWeeks = weeks.filter(week => !delivered.has(week)
          && new Date(`${week}T09:00:00+08:00`).getTime() + 7 * 86400000 <= new Date(args[0]).getTime()).sort();
        return pendingWeeks.map(week=>({week_start:week}));
      }
      if (sql.startsWith('INSERT')) delivered.add(args[0]);
      return [];
    },
  };
  const summary = { weekStart: '2026-11-02', weekEnd: '2026-11-08', total: 2, submittedCount: 1, missingCount: 1, highlights: [], missing: [] };
  const reports = { collect: async () => {}, notificationRows: async () => rows, summaryForLeader: async week => ({ ...summary, weekStart: week }) };
  return { service: new ProjectWeeklyNotificationsService({ createQueryRunner: () => runner }, reports), delivered };
}

test('Beijing deadline and cross-year weeks work', async () => {
  const { service } = fixture([], ['2026-12-28']);
  const seen = [];
  for (const time of ['2027-01-04T09:00:00+08:00', '2027-01-05T09:00:00+08:00']) {
    await service.withLeaderSummary(new Date(time), async summary => { seen.push(summary?.summaries.map(s=>s.weekStart) || null); return { sent: true }; });
  }
  assert.deepEqual(seen, [['2026-12-28'], null]);
});

test('leader summary attaches only once per week, retries failed delivery, and preserves the daily callback', async () => {
  const { service, delivered } = fixture();
  const now = new Date('2026-11-10T09:00:00+08:00');
  const seen = [];
  await service.withLeaderSummary(now, async summary => { seen.push(summary); return { sent: false }; });
  assert.equal(delivered.size, 0);
  await service.withLeaderSummary(now, async summary => { seen.push(summary); return { sent: true }; });
  await service.withLeaderSummary(now, async summary => { seen.push(summary); return { sent: true }; });
  assert.equal(seen.filter(Boolean).length, 2);
  assert.equal(seen[2], null);
  assert.equal(delivered.size, 1);
});

test('after multi-week downtime all pending weeks merge into the first successful daily report', async () => {
  const { service } = fixture([], ['2026-11-02', '2026-11-09', '2026-11-16']);
  const seen = [];
  for (let day = 24; day <= 27; day++) {
    await service.withLeaderSummary(new Date(`2026-11-${day}T09:00:00+08:00`), async summary => {
      seen.push(summary?.summaries.map(s=>s.weekStart) || null); return { sent: true };
    });
  }
  assert.deepEqual(seen, [['2026-11-02', '2026-11-09', '2026-11-16'], null, null, null]);
});

test('Monday 09:00 may catch up an older closed week and the just-ended week', async () => {
  const { service } = fixture([], ['2026-11-02', '2026-11-09']);
  const seen = [];
  for (let count = 0; count < 2; count++) {
    await service.withLeaderSummary(new Date('2026-11-16T09:00:00+08:00'), async summary => {
      seen.push(summary?.summaries.map(s=>s.weekStart) || null); return { sent: true };
    });
  }
  assert.deepEqual(seen, [['2026-11-02', '2026-11-09'], null]);
});

test('reminders exclude submitted reports and separate one-hour deadline window from overdue work', async () => {
  const base = { dueAt: '2026-11-09T09:00:00+08:00', ownerId: 12 };
  const { service } = fixture([
    { ...base, projectId: 1, status: 'draft', overdue: false },
    { ...base, projectId: 2, status: 'submitted', overdue: false },
    { ...base, projectId: 3, status: 'missing', overdue: true },
  ]);
  const now = new Date('2026-11-09T08:00:00+08:00');
  assert.deepEqual((await service.reminderRows(now, true)).map(r => r.projectId), [1]);
  assert.deepEqual((await service.reminderRows(now)).map(r => r.projectId), [3]);
  assert.equal((await service.reminderRows(new Date('2026-11-09T07:59:00+08:00'), true)).length, 0);
});

test('personal digest merges multiple projects, reuses successful-send idempotency and suppresses read-only recipients', async () => {
  const service = Object.create(TasksService.prototype);
  const sent = [];
  const successful = new Set();
  Object.assign(service, {
    todayString: () => '2026-11-09', addDays: () => '2026-11-12', startOfToday: () => new Date(),
    holidays: { isWorkday: async () => true }, systemUrl: path => 'https://test.invalid' + path,
    weeklyNotifications: { serializedDigest: async (_, action) => action(), reminderRows: async () => [
      { ownerId: 1, projectName: 'Alpha', weekStart: '2026-11-02', weekEnd: '2026-11-08', desktopPath: '/a' },
      { ownerId: 1, projectName: 'Beta', weekStart: '2026-11-02', weekEnd: '2026-11-08', desktopPath: '/b' },
      { ownerId: 2, projectName: 'Read-only', desktopPath: '/c' },
    ] },
    buildDailyDigestCard: () => ({ card: { elements: [] }, fallback: 'existing digest' }),
    feishuNotify: { isReadOnlyRecipient: async id => id === 2, hasSuccessfulSince: async (_, id) => successful.has(id),
      sendCard: async (type, id, card, fallback) => { sent.push({ type, id, card, fallback }); successful.add(id); return { success: true }; } },
  });
  await service.notifyDailyDigests(undefined, '0900');
  await service.notifyDailyDigests(undefined, '0900');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 1);
  assert.match(sent[0].fallback, /existing digest.*\n.*Alpha/s);
  assert.match(sent[0].fallback, /Beta/);
});

test('summary lists every submitted and missing project without report details', () => {
 const highlights=Array.from({length:25},(_,i)=>({projectName:'Submitted'+i,ownerName:'Owner'+i,desktopPath:'/report/'+i,overallStatus:'risk',achievements:'hidden achievement',risks:'hidden risk',nextWeek:'hidden plan'}));
 const missing=Array.from({length:25},(_,i)=>({projectName:'Missing'+i,ownerName:'Owner'+i}));
 const lines=weeklyLeaderLines({weekStart:'2026-11-02',weekEnd:'2026-11-08',total:50,submittedCount:25,missingCount:25,highlights,missing},p=>'https://test.invalid'+p);
 assert.equal(lines.length,3);
 assert.equal(lines[1].split('\n').length,26);
 assert.equal(lines[2].split('\n').length,26);
 assert.match(lines[1],/Submitted24 · Owner24/);
 assert.match(lines[2],/Missing24 · Owner24/);
 assert.match(lines[1],/https:\/\/test.invalid\/report\/24/);
 assert.doesNotMatch(lines.join('\n'),/hidden|<font|更多项目/);
});

test('Friday progress reminder no longer sends a weekly report entry', async () => {
  let ownerEntrySent = false;
  const sent = [];
  const runner = { connect: async () => {}, release: async () => {}, manager: {}, query: async (sql, args) => {
    if (sql.includes('pg_try')) return [{ locked: true }];
    if (sql.startsWith('SELECT sent_check_ids')) return ownerEntrySent ? [{ sent_check_ids: [], owner_entry_sent: true }] : [];
    if (sql.startsWith('UPDATE weekly_progress_deliveries SET success')) ownerEntrySent = args[6];
    return [];
  } };
  const service = new WeeklyProgressService({ createQueryRunner: () => runner, manager: { query: async () => [] } },
    { sendGroupCard: async (...args) => { sent.push(args); return { success: true }; } },
    { notificationRows: async () => [{ weekStart: '2026-11-02' }] });
  service.missingRows = async () => [];
  const original = config.feishu.weeklyProgressGroupTargets;
  config.feishu.weeklyProgressGroupTargets = ['fake-chat'];
  try {
    const now = new Date('2026-11-06T14:00:00+08:00');
    await service.dispatch(now);
    await service.dispatch(now);
    assert.equal(sent.length, 0);
  } finally { config.feishu.weeklyProgressGroupTargets = original; }
});

test('empty submission groups show a compact empty state',()=>{
 const lines=weeklyLeaderLines({total:0,submittedCount:0,missingCount:0,highlights:[],missing:[]},()=>null);
 assert.equal(lines[1],'**已提交周报**\n暂无');
 assert.equal(lines[2],'**未提交周报**\n暂无');
});
