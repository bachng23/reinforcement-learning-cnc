const { authorizeFactory, projectOperationsHead } = require('./operations-context.service');
const { summarySelect, summary } = require('./decision-case-list.service');
const { ApiError } = require('../lib/api-error');
const domain = require('../../../contracts/v3/operations-domain.schema.json').$defs;

const zero = names => Object.fromEntries(names.map(name => [name, 0]));
const modeCounts = () => ({ total: 0, by_status: zero(domain.DecisionCaseStatus.enum),
  by_processing: zero(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']) });

async function readOperationsOverview(db, user, factoryId) {
  const selected = await db.$transaction(async tx => {
    // First SELECT acquires the MVCC snapshot. Record time, not a freshness token.
    const [clock] = await tx.$queryRaw`SELECT clock_timestamp() AS "readAt"`;
    await authorizeFactory(tx, user, factoryId);
    const head = await tx.operationsHead.findUnique({ where: { factoryId },
      include: { snapshot: true, schedule: { include: { snapshot: true, commit: true } } } });
    if (!head) throw new ApiError(404, 'FACTORY_NOT_FOUND', 'Factory was not found');
    // At most mode x lifecycle x processing groups; never load all case payloads.
    const groups = await tx.decisionCase.groupBy({ by: ['mode', 'status', 'processingStatus'],
      where: { factoryId }, _count: { _all: true } });
    const preview = await tx.decisionCase.findMany({ where: { factoryId, mode: 'LIVE', status: 'AWAITING_APPROVAL' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 7, select: summarySelect });
    return { head, groups, preview, readAt: clock.readAt.toISOString() };
  }, { isolationLevel: 'RepeatableRead' });
  // External canonical validator runs after the read transaction closes.
  const { head, groups, preview, readAt } = selected;
  const checked = await projectOperationsHead(head, factoryId);
  const payload = checked.snapshot.snapshot;
  const machines = { total: payload.machines.length, by_status: zero(domain.MachineStatus.enum) };
  for (const machine of payload.machines) machines.by_status[machine.status]++;
  const cases = { LIVE: modeCounts(), SIMULATION_ONLY: modeCounts() };
  for (const group of groups) {
    const target = cases[group.mode];
    if (!target || !Object.hasOwn(target.by_status, group.status) || !Object.hasOwn(target.by_processing, group.processingStatus)) {
      throw new ApiError(500, 'OPERATIONS_INTEGRITY_ERROR', 'Stored case state failed integrity validation');
    }
    target.total += group._count._all;
    target.by_status[group.status] += group._count._all;
    target.by_processing[group.processingStatus] += group._count._all;
  }
  return { success: true, data: {
    context: { factory_id: factoryId, snapshot_id: head.snapshotId, plan_version: head.planVersion,
      head_revision: head.revision, captured_at: payload.captured_at, read_at: readAt,
      publication: head.schedule ? { schedule_id: head.schedule.scheduleId,
        schedule_revision: head.schedule.revision, basis_snapshot_id: head.schedule.snapshotId } : null },
    machines, cases,
    review_preview: { items: preview.slice(0, 6).map(row => summary(row, head)), limit: 6,
      has_more: preview.length > 6, filters: { factory_id: factoryId, mode: 'LIVE', status: 'AWAITING_APPROVAL' } },
    provenance: { machines: { source: 'validated_current_snapshot', snapshot_id: head.snapshotId,
      observed_at: payload.captured_at, population: machines.total, covered: machines.total },
    cases: { source: 'decision_cases', scope: 'all_factory_cases_including_stale_and_terminal', read_at: readAt } },
  } };
}
module.exports = { readOperationsOverview };
