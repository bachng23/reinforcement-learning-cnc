const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const identifier = z.string().min(1).max(128);
const timestamp = z.string().datetime({ offset: true });
const probability = z.number().finite().min(0).max(1);
const healthFields = ['health_snapshot_id','machine_id','observed_at','health_index','failure_probability_horizon_minutes','failure_probability','confidence','source_model_version'];
const healthSchema = z.object({ health_snapshot_id: identifier, machine_id: identifier, observed_at: timestamp,
  health_index: probability, failure_probability_horizon_minutes: z.number().int().positive(), failure_probability: probability,
  confidence: z.enum(['LOW','MEDIUM','HIGH']), source_model_version: identifier }).strict();
const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), report_text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('case_health_alert'), case_id: z.string().uuid(), factory_id: identifier,
    basis_snapshot_id: identifier, case_created_at: timestamp, machine_id: identifier,
    trigger: z.object({ type: z.literal('HEALTH_ALERT'), failure_probability: probability, alert_threshold: probability }).strict()
      .refine(t => t.failure_probability >= t.alert_threshold),
    health_samples: z.array(healthSchema) }).strict(),
]);
// Caller supplies the authorized, integrity-validated immutable case and basis,
// never HTTP evidence. Pure projection: no fetching, threshold inference or writes.
function projectCaseEvidence({ caseId, factoryId, mode, createdAt, trigger, snapshot }) {
  const invalid = () => new ApiError(409, 'INCIDENT_SOURCE_INVALID', 'A scoped LIVE health alert with immutable machine evidence is required');
  if (mode !== 'LIVE' || trigger?.type !== 'HEALTH_ALERT' || snapshot?.factory_id !== factoryId
    || !snapshot.machines?.some(m => m.machine_id === trigger.machine_id)) throw invalid();
  const result = { kind: 'case_health_alert', case_id: caseId, factory_id: factoryId,
    basis_snapshot_id: snapshot.snapshot_id, case_created_at: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    machine_id: trigger.machine_id,
    trigger: { type: 'HEALTH_ALERT', failure_probability: trigger.failure_probability, alert_threshold: trigger.alert_threshold },
    health_samples: (snapshot.health_snapshots ?? []).filter(h => h.machine_id === trigger.machine_id)
      .map(h => Object.fromEntries(healthFields.map(k => [k, h[k]]))) };
  const parsed = evidenceSchema.safeParse(result);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
module.exports = { evidenceSchema, projectCaseEvidence };
