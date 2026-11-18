const { test } = require('node:test');
const assert = require('node:assert/strict');
const { config } = require('../src/config/config');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');

async function withGroups(run) {
  const progress = config.feishu.projectProgressGroupChatId;
  config.feishu.projectProgressGroupChatId = 'oc_old';
  const excluded = config.feishu.weeklyProgressExcludedChatIds;
  config.feishu.weeklyProgressExcludedChatIds = '';
  const old = [config.feishu.briefGroupChatId, config.feishu.briefGroupChatIds];
  config.feishu.briefGroupChatId = 'oc_old';
  config.feishu.briefGroupChatIds = ' oc_new, oc_old, ,oc_new ';
  try { await run(); } finally {
    config.feishu.projectProgressGroupChatId = progress;
    config.feishu.weeklyProgressExcludedChatIds = excluded;
    [config.feishu.briefGroupChatId, config.feishu.briefGroupChatIds] = old;
  }
}

test('group configuration merges legacy and additional groups without duplicates', () => withGroups(async () => {
  assert.deepEqual(config.feishu.briefGroupTargets, ['oc_old', 'oc_new']);
  config.feishu.briefGroupChatIds = '';
  assert.deepEqual(config.feishu.briefGroupTargets, ['oc_old']);
  config.feishu.briefGroupChatId = '';
  assert.deepEqual(config.feishu.briefGroupTargets, []);
}));

test('daily progress brief targets only technical group and retries failed delivery', () => withGroups(async () => {
  const service = Object.create(TasksService.prototype);
  const successful = new Set();
  const calls = [];
  let failOld = true, generated = 0;
  Object.assign(service, {
    logger: { warn() {} }, todayString: () => '2026-10-29', startOfToday: () => new Date(),
    holidays: { isWorkday: async () => true }, closures: { readyProjects: async () => [] },
    projectBriefRows: async () => [{ id: 1, name: 'Project', pct: 20, owners: [], overdueTasks: [], taskSummary: 'In progress' }],
    llmBriefNarrative: async () => { generated++; return null; },
    buildGroupBriefPost: () => ({ title: 'Brief', content: [], fallback: 'Brief' }),
    feishuNotify: {
      hasGroupSuccessfulSince: async (_, id) => successful.has(id),
      uploadBriefImage: async () => 'img_fake',
      sendGroupCard: async (_, id) => {
        calls.push(id);
        if (id === 'oc_old' && failOld) throw Error('simulated failure');
        successful.add(id); return { success: true };
      },
    },
  });


  const first = await service.runProjectBriefToGroup();
  assert.equal(first.sent, false);
  assert.deepEqual(calls, ['oc_old']);
  assert.equal(generated, 1, 'generate content once for both groups');
  failOld = false;
  await service.runProjectBriefToGroup();
  assert.deepEqual(calls, ['oc_old', 'oc_old']);
  assert.equal((await service.runProjectBriefToGroup()).skipped, 'already_sent');
}));

test('weekly progress dispatch targets technical group and retains personal reminders', () => withGroups(async () => {
  const delivered = new Map(), calls = [];
  let failOld = true;
  const runner = {
    connect: async () => {}, release: async () => {}, manager: {},
    query: async (sql, args) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
      if (sql.startsWith('SELECT sent_check_ids')) return [{ sent_check_ids: delivered.get(args[1]) || [] }];
      if (sql.startsWith('UPDATE') && args[3] === true) delivered.set(args[1], args[5]);
      return [];
    },
  };
  const service = new WeeklyProgressService({ createQueryRunner: () => runner }, { isReadOnlyRecipient: async () => false });
  service.missingRows = async () => [{ id: '1', assigneeIds: ['42'], weekStart: '2026-10-26' }];
  service.sendBatch = async batch => {
    calls.push([batch.channel, batch.target]);
    if (batch.target === 'oc_old' && failOld) throw Error('simulated failure');
    return { success: true };
  };
  await service.dispatch();
  assert.deepEqual(calls, [['personal', '42'], ['group', 'oc_old']]);
  failOld = false;
  await service.dispatch();
  assert.deepEqual(calls[2], ['group', 'oc_old']);
  assert.equal(calls.length, 3);
  await service.dispatch();
  assert.equal(calls.length, 3);
}));

test('excluded technical group receives daily progress but no weekly supplement reminder; personal reminders remain', () => withGroups(async () => {
  config.feishu.weeklyProgressExcludedChatIds = ' oc_old, oc_old ';
  assert.deepEqual(config.feishu.briefGroupTargets, ['oc_old', 'oc_new']);
  assert.deepEqual(config.feishu.projectProgressGroupTargets, ['oc_old']);
  assert.deepEqual(config.feishu.weeklyProgressGroupTargets, []);
  const calls = [];
  const runner = { connect: async () => {}, release: async () => {}, manager: {},
    query: async sql => sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [] };
  const service = new WeeklyProgressService({ createQueryRunner: () => runner }, { isReadOnlyRecipient: async () => false });
  service.missingRows = async () => [{ id: '1', assigneeIds: ['42'], weekStart: '2026-10-26' }];
  service.sendBatch = async batch => { calls.push([batch.channel, batch.target]); return { success: true }; };
  await service.dispatch();
  assert.deepEqual(calls, [['personal', '42']]);
}));
