const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const {
  claimDecisionCase,
  persistDecisionRecommendation,
} = require('../../src/services/decision-planning.service');
const { loadCanonicalSeedPlan, validatePayload } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const example = require('../../../contracts/v3/examples/demo-scenario.json');
async function fixture(db, app) {
  const users = {};
  for (const [name, role, active] of [
    ['ADMIN', 'ADMIN', true],
    ['MANAGER', 'ENGINEER', true],
    ['OPERATOR', 'OPERATOR', true],
    ['OTHER', 'ENGINEER', true],
    ['VIEWER', 'VIEWER', true],
    ['OUTSIDER', 'OPERATOR', true],
    ['INACTIVE', 'OPERATOR', false],
  ])
    users[name] = await db.user.create({
      data: { username: randomUUID(), passwordHash: 'private-test-only', role, active },
    });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const http = async (path, { user = users.ADMIN, method = 'GET', body, key = randomUUID() } = {}) => {
    const r = await fetch(base + path, {
      method,
      signal: AbortSignal.timeout(30000),
      headers: {
        ...(user
          ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET) }
          : {}),
        'X-Request-Id': 'work-order-http-test',
        'Idempotency-Key': key,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: r.status,
      body: await r.json(),
      replay: r.headers.get('idempotency-replayed'),
      cache: r.headers.get('cache-control'),
    };
  };
  const member = (factoryId, user, method = 'PUT') =>
    http(`/factories/${factoryId}/members/${user.id}`, { method });
  const seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
  async function factory() {
    const factoryId = 'wo-' + randomUUID();
    const r = await http('/factories', {
      method: 'POST',
      body: { factory_id: factoryId, name: 'Work order test' },
    });
    if (r.status !== 201) throw Error(JSON.stringify(r));
    const snapshot = structuredClone(seed);
    snapshot.factory_id = factoryId;
    snapshot.current_schedule.factory_id = factoryId;
    await ingestFactorySnapshot(
      { factoryId, expectedHeadRevision: 0, snapshot, sourceId: 'work-order-test' },
      db,
    );
    for (const name of ['MANAGER', 'OPERATOR', 'OTHER', 'VIEWER'])
      if ((await member(factoryId, users[name])).status !== 200) throw Error('fixture grant failed');
    return snapshot;
  }
  async function publish(snapshot, { mode = 'LIVE', commit = true, maintenanceStatus, transformCandidate } = {}) {
    const head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
    const r = await http('/decision-cases', {
      method: 'POST',
      body: {
        schema_version: '3.0',
        factory_id: snapshot.factory_id,
        expected_snapshot_id: snapshot.snapshot_id,
        expected_plan_version: head.planVersion,
        request: {
          mode,
          trigger: { type: 'MANUAL_REPLAN', reason: 'Maintenance execution test' },
          planning_config: { horizon_minutes: 720 },
        },
      },
    });
    if (r.status !== 202) throw Error('case create ' + JSON.stringify(r));
    const id = r.body.data.decision_case_id;
    const lease = await claimDecisionCase(db, { caseId: id, expectedRevision: 1, workerId: randomUUID() });
    const candidate = {
      ...structuredClone(example.candidate_plans[0]),
      decision_case_id: id,
      snapshot_id: snapshot.snapshot_id,
      schedule: {
        ...structuredClone(example.candidate_plans[0].schedule),
        factory_id: snapshot.factory_id,
        schedule_id: 'wo-schedule-' + id,
      },
    };
    if (transformCandidate) transformCandidate(candidate);
    if (maintenanceStatus) {
      const maintenance = candidate.schedule.assignments.find((a) => a.assignment_type === 'MAINTENANCE');
      maintenance.status = maintenanceStatus;
    }
    candidate.validation = {
      schema_version: '3.0',
      validation_id: 'wo-validation-' + id,
      candidate_plan_id: candidate.candidate_plan_id,
      validator_version: 'operations-validator-v1',
      verdict: 'VALID',
      validated_at: candidate.generated_at,
      violations: [],
    };
    const recommendation = {
      schema_version: '3.0',
      recommendation_id: 'wo-rec-' + id,
      decision_case_id: id,
      snapshot_id: snapshot.snapshot_id,
      generated_at: candidate.generated_at,
      recommended_plan_id: candidate.candidate_plan_id,
      candidate_plans: [candidate],
      explanation: {
        summary: 'private planner artifact',
        primary_reasons: ['Feasible'],
        tradeoffs: ['No change'],
        residual_risks: [],
        evidence_refs: [snapshot.snapshot_id],
      },
    };
    await persistDecisionRecommendation(db, {
      caseId: id,
      expectedRevision: lease.revision,
      leaseToken: lease.leaseToken,
      recommendation,
    });
    const command = {
      schema_version: '3.0',
      decision_case_id: id,
      command: 'APPROVE',
      recommendation_id: recommendation.recommendation_id,
      expected_snapshot_id: snapshot.snapshot_id,
      expected_plan_version: head.planVersion,
      expected_case_revision: 6,
      candidate_plan_id: candidate.candidate_plan_id,
      candidate_version: candidate.plan_version,
    };
    const approve = await http(`/decision-cases/${id}/decision`, { method: 'POST', body: command });
    if (approve.status !== 200) throw Error('approve ' + JSON.stringify(approve));
    if (commit) {
      const result = await http(`/decision-cases/${id}/decision`, {
        method: 'POST',
        body: { ...command, command: 'COMMIT', expected_case_revision: 7 },
      });
      if (result.status !== 200) throw Error('commit ' + JSON.stringify(result));
    }
    const current = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
    const assignment = candidate.schedule.assignments.find((a) => a.assignment_type === 'MAINTENANCE');
    return {
      id,
      snapshot,
      candidate,
      body: {
        factory_id: snapshot.factory_id,
        source: {
          decision_case_id: id,
          schedule_id: candidate.schedule.schedule_id,
          schedule_revision: candidate.schedule.revision,
          schedule_hash: require('../../src/services/operations-contract.service').contentHash(
            candidate.schedule,
          ),
          assignment_id: assignment.assignment_id,
        },
        expected_head: {
          snapshot_id: current.snapshotId,
          plan_version: current.planVersion,
          revision: current.revision,
        },
      },
    };
  }
  const create = (p, options = {}) => http('/work-orders', { method: 'POST', body: p.body, ...options });
  const command = (row, cmd, fields = {}, user = users.OPERATOR, key = randomUUID()) =>
    http(`/work-orders/${row.id}/commands`, {
      method: 'POST',
      user,
      key,
      body: { command: cmd, expected_revision: row.revision, ...fields },
    });
  return {
    db,
    users,
    http,
    member,
    factory,
    publish,
    create,
    command,
    close: () => new Promise((r) => server.close(r)),
  };
}
module.exports = { fixture };
