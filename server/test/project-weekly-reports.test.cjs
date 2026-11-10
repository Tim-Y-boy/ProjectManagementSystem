const assert = require('node:assert/strict');
const { weekOf, weekWindow } = require('../src/modules/project-weekly-reports/project-weekly-reports.rules');
assert.equal(weekOf(new Date('2026-11-01T16:00:00Z')), '2026-11-02');
assert.equal(weekOf(new Date('2027-01-01T00:00:00Z')), '2026-12-28');
assert.deepEqual(weekWindow('2026-11-02'), {
  weekEnd: '2026-11-08', opensAt: '2026-11-01T16:00:00.000Z', dueAt: '2026-11-09T01:00:00.000Z',
});
assert.throws(() => weekWindow('2026-11-03'));
assert.throws(() => weekWindow('2026-02-30'));
console.log('project weekly report date boundaries passed');
