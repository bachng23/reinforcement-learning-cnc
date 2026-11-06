const R = require('../../src/services/work-order-read.service');
const golden = require('../../examples/maintenance-analytics-golden.json');
async function seedGolden(f) {
  const originalClock = R.clock;
  try {
    const p = await f.publish(await f.factory());
    let row;
    for (const [offset, command] of golden.events) {
      R.clock = async () => new Date(Date.parse(golden.base) + offset * 1000);
      let result;
      if (command === 'CREATE') result = await f.create(p);
      else {
        const manager = ['ASSIGN', 'REQUEST_REWORK', 'REASSIGN_FOR_REWORK', 'CLOSE'].includes(command);
        const fields =
          {
            ASSIGN: { assignee_user_id: f.users.OPERATOR.id },
            BLOCK: { reason: 'Waiting for safe access' },
            RESUME: { reason: 'Access available' },
            COMPLETE: {
              report: {
                outcome: offset === 80 ? 'PARTIAL' : 'SUCCESS',
                work_performed: 'PRIVATE work report',
                result: 'PRIVATE result',
              },
            },
            REQUEST_REWORK: { reason: 'Additional work required' },
            REASSIGN_FOR_REWORK: { assignee_user_id: f.users.OTHER.id, reason: 'Replacement required' },
            CLOSE: { verification: { result: 'VERIFIED', note: 'PRIVATE verification' } },
          }[command] ?? {};
        result = await f.command(
          row,
          command,
          fields,
          manager ? f.users.MANAGER : offset >= 170 ? f.users.OTHER : f.users.OPERATOR,
        );
      }
      if (result.status !== (command === 'CREATE' ? 201 : 200))
        throw Error('Golden HTTP command failed: ' + JSON.stringify(result));
      row = result.body.data;
    }
    return { publication: p, order: row };
  } finally {
    R.clock = originalClock;
  }
}
module.exports = { seedGolden };
