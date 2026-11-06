const { publicEvent } = require('../src/services/work-order-read.service');

test('event projection removes private fields recursively from reports and verification', () => {
  expect(publicEvent({
    revision: 7,
    planner_artifact: { secret: true },
    report: { outcome: 'SUCCESS', work_performed: 'Inspection', result: 'Passed', token: 'secret' },
    verification: { result: 'VERIFIED', note: 'Reviewed', passwordHash: 'secret', actor_id: 'spoof' },
  })).toEqual({
    revision: 7,
    report: { outcome: 'SUCCESS', work_performed: 'Inspection', result: 'Passed' },
    verification: { result: 'VERIFIED', note: 'Reviewed' },
  });
});
