const { randomUUID } = require('node:crypto');
const { ApiError } = require('../lib/api-error');
const { lockFactory } = require('./factory-access.service');
const { event } = require('./scenario-workspace.service');
const conflict = () => new ApiError(409, 'SCENARIO_LEASE_CONFLICT', 'Worker lease is no longer current');
function leaseDuration(value = 30000) {
  if (!Number.isInteger(value) || value < 1000 || value > 60000) throw new Error('Scenario lease must be 1000..60000 milliseconds');
  return value;
}
const workspaceOf = row => ({ id: row.workspace_id, factory_id: row.factory_id });
async function now(tx) { return (await tx.$queryRaw`SELECT clock_timestamp() AS at`)[0].at; }
async function lockedRow(tx, id, factoryId) {
  await lockFactory(tx, factoryId);
  const [row] = await tx.$queryRaw`SELECT * FROM scenario_jobs WHERE id=${id}::uuid AND factory_id=${factoryId} FOR UPDATE`;
  if (!row) throw conflict();
  return row;
}
function owns(row, claim, at) {
  return row.status === 'RUNNING' && row.lease_token === claim.lease_token && row.attempt === claim.attempt &&
    row.lease_expires_at > at && row.deadline_at > at;
}
async function endAttempt(tx, row, status, errorCode) {
  await tx.$executeRaw`UPDATE scenario_attempts SET status=${status},completed_at=clock_timestamp(),error_code=${errorCode}
    WHERE factory_id=${row.factory_id} AND workspace_id=${row.workspace_id}::uuid AND job_id=${row.id}::uuid
      AND attempt=${row.attempt} AND lease_token=${row.lease_token}::uuid AND status='RUNNING'`;
}
async function fail(tx, row, errorCode) {
  if (row.status === 'RUNNING') await endAttempt(tx, row, 'FAILED', errorCode);
  await tx.$executeRaw`UPDATE scenario_points SET status=${errorCode === 'SCENARIO_DEADLINE_EXCEEDED' ? 'TIMEOUT' : 'FAILED'},
    completed_at=clock_timestamp(),error_code=${errorCode} WHERE factory_id=${row.factory_id}
    AND workspace_id=${row.workspace_id}::uuid AND job_id=${row.id}::uuid AND status IN ('QUEUED','RUNNING')`;
  await tx.$executeRaw`UPDATE scenario_jobs SET status='FAILED',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
    error_code=${errorCode},lease_token=NULL,lease_expires_at=NULL,worker_id=NULL WHERE id=${row.id}::uuid`;
  await event(tx, workspaceOf(row), null, 'JOB_FAILED', { error_code: errorCode, attempt: row.attempt }, row.id);
}
async function recover(tx, row, at) {
  if (row.deadline_at <= at) { await fail(tx, row, 'SCENARIO_DEADLINE_EXCEEDED'); return; }
  if (row.attempt >= 3) { await fail(tx, row, 'SCENARIO_ATTEMPTS_EXHAUSTED'); return; }
  await endAttempt(tx, row, 'EXPIRED', 'SCENARIO_LEASE_EXPIRED');
  await tx.$executeRaw`UPDATE scenario_points SET status='QUEUED' WHERE factory_id=${row.factory_id}
    AND workspace_id=${row.workspace_id}::uuid AND job_id=${row.id}::uuid AND status='RUNNING'`;
  await tx.$executeRaw`UPDATE scenario_jobs SET status='QUEUED',lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,
    updated_at=clock_timestamp() WHERE id=${row.id}::uuid`;
  await event(tx, workspaceOf(row), null, 'JOB_LEASE_EXPIRED', { attempt: row.attempt }, row.id);
}
async function claimNext(db, { workerId, engineVersion, contractVersion, leaseMs = 30000 }) {
  leaseDuration(leaseMs);
  if (![workerId, engineVersion, contractVersion].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)))
    throw new Error('Explicit worker and engine contract identities are required');
  const candidates = await db.$queryRaw`SELECT id,factory_id FROM scenario_jobs
    WHERE engine_version=${engineVersion} AND contract_version=${contractVersion}
      AND ((status='QUEUED' AND NOT EXISTS(SELECT 1 FROM scenario_jobs running
        WHERE running.factory_id=scenario_jobs.factory_id AND running.status='RUNNING' AND running.lease_expires_at>clock_timestamp()))
        OR (status='RUNNING' AND lease_expires_at<=clock_timestamp()))
    ORDER BY created_at,id LIMIT 32`;
  for (const candidate of candidates) {
    const claimed = await db.$transaction(async tx => {
      let row = await lockedRow(tx, candidate.id, candidate.factory_id);
      const at = await now(tx);
      if (['SUCCEEDED', 'FAILED'].includes(row.status)) return null;
      if (row.status === 'RUNNING') {
        if (row.lease_expires_at > at) return null;
        await recover(tx, row, at);
        [row] = await tx.$queryRaw`SELECT * FROM scenario_jobs WHERE id=${row.id}::uuid`;
      }
      if (row.status !== 'QUEUED') return null;
      if (row.deadline_at <= at || row.attempt >= 3) {
        await fail(tx, row, row.deadline_at <= at ? 'SCENARIO_DEADLINE_EXCEEDED' : 'SCENARIO_ATTEMPTS_EXHAUSTED');
        return null;
      }
      const running = await tx.$queryRaw`SELECT id FROM scenario_jobs WHERE factory_id=${row.factory_id} AND status='RUNNING' LIMIT 1`;
      if (running.length) return null;
      const token = randomUUID();
      const [result] = await tx.$queryRaw`UPDATE scenario_jobs SET status='RUNNING',attempt=attempt+1,lease_token=${token}::uuid,
        worker_id=${workerId},lease_expires_at=LEAST(deadline_at,clock_timestamp()+${leaseMs}*interval '1 millisecond'),
        started_at=COALESCE(started_at,GREATEST(created_at,clock_timestamp())),updated_at=GREATEST(updated_at,clock_timestamp()) WHERE id=${row.id}::uuid RETURNING *`;
      await tx.$executeRaw`INSERT INTO scenario_attempts(factory_id,workspace_id,job_id,attempt,lease_token,worker_id,status)
        VALUES(${row.factory_id},${row.workspace_id}::uuid,${row.id}::uuid,${result.attempt},${token}::uuid,${workerId},'RUNNING')`;
      await event(tx, workspaceOf(row), null, 'JOB_CLAIMED', { attempt: result.attempt, worker_id: workerId }, row.id);
      return result;
    }, { timeout: 15000 });
    if (claimed) return claimed;
  }
  return null;
}
async function fenced(db, claim, action) {
  return db.$transaction(async tx => {
    const row = await lockedRow(tx, claim.id, claim.factory_id);
    if (!owns(row, claim, await now(tx))) throw conflict();
    const result = await action(tx, row);
    const finishedAt = await now(tx);
    if (finishedAt >= row.lease_expires_at || finishedAt >= row.deadline_at) throw conflict();
    return result;
  }, { timeout: 15000 });
}
async function heartbeat(db, claim, leaseMs = 30000) {
  leaseDuration(leaseMs);
  return fenced(db, claim, async (tx, row) => {
    const [updated] = await tx.$queryRaw`UPDATE scenario_jobs SET
      lease_expires_at=LEAST(deadline_at,clock_timestamp()+${leaseMs}*interval '1 millisecond'),updated_at=clock_timestamp()
      WHERE id=${row.id}::uuid RETURNING lease_expires_at`;
    return updated.lease_expires_at;
  });
}
async function release(db, claim) {
  return fenced(db, claim, async (tx, row) => {
    await endAttempt(tx, row, 'FAILED', 'SCENARIO_WORKER_STOPPED');
    await tx.$executeRaw`UPDATE scenario_points SET status='QUEUED' WHERE job_id=${row.id}::uuid AND status='RUNNING'`;
    if (row.attempt >= 3) {
      await fail(tx, row, 'SCENARIO_ATTEMPTS_EXHAUSTED');
    } else {
      await tx.$executeRaw`UPDATE scenario_jobs SET status='QUEUED',lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,
        updated_at=clock_timestamp() WHERE id=${row.id}::uuid`;
      await event(tx, workspaceOf(row), null, 'JOB_RELEASED', { attempt: row.attempt }, row.id);
    }
  });
}
async function persist(db, claim, result, { signal } = {}) {
  const { requestForJob } = require('./scenario-engine.adapter');
  const { validateScenarioResult } = require('./scenario-engine.client');
  const { contentHash } = require('./operations-contract.service');
  // Canonical validation and CPU work are outside the fenced transaction.
  await validateScenarioResult(requestForJob(claim, Math.max(1, claim.deadline_at - Date.now())), result, { signal });
  return fenced(db, claim, async (tx, row) => {
    const points = await tx.$queryRaw`SELECT * FROM scenario_points WHERE job_id=${row.id}::uuid ORDER BY point_index`;
    for (const point of points) {
      const evaluated = row.kind === 'RUN' ? result[point.role.toLowerCase()]
        : result.points.find(item => item.value === point.value)?.evaluation;
      if (!evaluated) throw new ApiError(502, 'INVALID_SCENARIO_RESPONSE', 'Engine point mapping is incomplete');
      const successful = ['FEASIBLE', 'NO_FEASIBLE_PLAN'].includes(evaluated.outcome);
      const errorCode = successful ? null : evaluated.outcome === 'TIMEOUT' ? 'SCENARIO_DEADLINE_EXCEEDED' : 'SCENARIO_ENGINE_FAILURE';
      await tx.$executeRaw`UPDATE scenario_points SET status=${evaluated.outcome},
        result_json=${successful ? JSON.stringify(evaluated) : null}::jsonb,result_hash=${successful ? contentHash(evaluated) : null},
        error_code=${errorCode},completed_at=clock_timestamp() WHERE job_id=${row.id}::uuid AND point_index=${point.point_index}`;
    }
    await endAttempt(tx, row, 'SUCCEEDED', null);
    await tx.$executeRaw`UPDATE scenario_jobs SET status='SUCCEEDED',result_json=${JSON.stringify(result)}::jsonb,
      result_hash=${contentHash(result)},completed_at=clock_timestamp(),updated_at=clock_timestamp(),
      lease_token=NULL,lease_expires_at=NULL,worker_id=NULL WHERE id=${row.id}::uuid`;
    await event(tx, workspaceOf(row), null, 'JOB_SUCCEEDED', { attempt: row.attempt, result_hash: contentHash(result) }, row.id);
    return result;
  });
}
async function reject(db, claim, error) {
  const safe = new Set(['INVALID_SCENARIO_REQUEST', 'INVALID_SCENARIO_RESPONSE', 'SCENARIO_TIMEOUT',
    'SCENARIO_UNAVAILABLE', 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'SCENARIO_VALIDATOR_UNAVAILABLE']);
  const code = safe.has(error.code) ? error.code : 'SCENARIO_ENGINE_FAILURE';
  return fenced(db, claim, async (tx, row) => {
    if (error.retryable && row.attempt < 3 && row.deadline_at > await now(tx)) {
      await endAttempt(tx, row, 'FAILED', code);
      await tx.$executeRaw`UPDATE scenario_jobs SET status='QUEUED',lease_token=NULL,lease_expires_at=NULL,
        worker_id=NULL,updated_at=clock_timestamp() WHERE id=${row.id}::uuid`;
      await event(tx, workspaceOf(row), null, 'JOB_RETRY_QUEUED', { attempt: row.attempt, error_code: code }, row.id);
    } else await fail(tx, row, code);
  });
}
module.exports = { claimNext, heartbeat, release, fenced, owns, leaseDuration, persist, reject };
