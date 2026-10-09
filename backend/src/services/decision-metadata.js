function commitMetadata(row) {
  return row ? { decision_case_id: row.caseId, factory_id: row.factoryId, snapshot_id: row.snapshotId,
    schedule_id: row.scheduleId, schedule_revision: row.scheduleRevision, schedule_hash: row.scheduleHash,
    plan_version: row.planVersion, actor_id: row.actorId, committed_at: row.committedAt.toISOString() } : null;
}
function humanMetadata(row) {
  return row ? { decision: row.decision, recommendation_id: row.recommendationId,
    candidate_plan_id: row.candidateId, candidate_version: row.candidateVersion,
    candidate_hash: row.candidateHash, schedule_hash: row.scheduleHash, note: row.note,
    actor_id: row.actorId, decided_at: row.decidedAt.toISOString() } : null;
}
module.exports = { commitMetadata, humanMetadata };
