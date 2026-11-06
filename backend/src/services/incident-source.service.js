const { ApiError } = require('../lib/api-error');
const { authorizeFactory } = require('./factory-access.service');
const { contentHash, validatePayload } = require('./operations-contract.service');
const { evidenceSchema, projectCaseEvidence } = require('./incident-evidence');

const integrity = () => new ApiError(500, 'INCIDENT_INTEGRITY_ERROR', 'Immutable source failed integrity validation');
const missing = () => new ApiError(404, 'INCIDENT_SOURCE_NOT_FOUND', 'Source was not found');

// Only call with a validated report/append DTO, inside the caller's transaction.
// Authorization precedes evidence reads; the reviewed projector is the sole
// authority for public evidence, never the raw case request or snapshot.
async function readBasis(tx, user, factoryId, snapshotId, machineId) {
  await authorizeFactory(tx, user, factoryId);
  const row = await tx.factorySnapshot.findUnique({
    where: { factoryId_snapshotId: { factoryId, snapshotId } },
  });
  if (!row) throw missing();
  if (contentHash(row.payloadJson) !== row.contentHash) throw integrity();
  const payload = await validatePayload(row.payloadJson, 'snapshot');
  if (payload.factory_id !== factoryId || payload.snapshot_id !== snapshotId) throw integrity();
  if (!payload.machines.some(machine => machine.machine_id === machineId)) {
    throw new ApiError(409, 'INCIDENT_SOURCE_INVALID', 'Machine is absent from the immutable basis');
  }
  return payload;
}

async function projectSource(tx, user, factoryId, body) {
  await authorizeFactory(tx, user, factoryId);
  if (body.source.type === 'manual') {
    if (body.machine) {
      await readBasis(tx, user, factoryId, body.machine.basis_snapshot_id, body.machine.machine_id);
    }
    return {
      sourceId: body.source.source_event_id,
      machine: body.machine ?? null,
      hash: contentHash(body),
      evidence: evidenceSchema.parse({ kind: 'manual', report_text: body.description ?? body.reason }),
    };
  }
  const row = await tx.decisionCase.findUnique({ where: { id: body.source.case_id } });
  if (!row || row.factoryId !== factoryId) throw missing();
  if (contentHash(row.requestJson) !== row.requestHash) throw integrity();
  const request = await validatePayload(row.requestJson.request, 'case-request');
  if (row.mode !== 'LIVE' || request.mode !== 'LIVE' || request.trigger.type !== 'HEALTH_ALERT') {
    throw new ApiError(409, 'INCIDENT_SOURCE_INVALID', 'A LIVE HEALTH_ALERT case is required');
  }
  const snapshot = await readBasis(tx, user, factoryId, row.snapshotId, request.trigger.machine_id);
  return {
    sourceId: row.id,
    machine: { machine_id: request.trigger.machine_id, basis_snapshot_id: row.snapshotId },
    hash: row.requestHash,
    evidence: projectCaseEvidence({
      caseId: row.id, factoryId, mode: request.mode, createdAt: row.createdAt,
      trigger: request.trigger, snapshot,
    }),
  };
}

module.exports = { readBasis, projectSource };
