const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { paginationSchema } = require('../validation/experiment.schemas');
const { episodeAccessWhere } = require('./research-access.service');

const machineIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const candidateQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'OVERRIDDEN', 'REJECTED']).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  experiment: z.string().uuid().optional(),
  machine: machineIdSchema.optional(),
});
const candidateIdSchema = z.string().regex(/^([0-9a-fA-F-]{36})~([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/)
  .transform((value) => {
    const separator = value.indexOf('~');
    return { recommendationId: value.slice(0, separator), machineId: value.slice(separator + 1) };
  }).pipe(z.object({ recommendationId: z.string().uuid(), machineId: machineIdSchema }));

const include = {
  maintenanceDecision: true,
  observation: {
    include: {
      stepResult: true,
      episode: { include: { experiment: true } },
    },
  },
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const round = (value) => value === null ? null : Math.round(value * 10000) / 10000;

function riskFrom(machine, config) {
  const state = machine.tool_state;
  const distribution = state.rul_distribution;
  const pairs = distribution.support_steps.map((step, index) => [step, distribution.probability_mass[index]]);
  const failureProbabilityNextStep = round(pairs.reduce((sum, [step, mass]) => sum + (step <= 1 ? mass : 0), 0));
  let cumulative = 0;
  let predictedRulSteps = null;
  for (const [step, mass] of pairs) {
    cumulative += mass;
    if (cumulative >= 0.5) {
      predictedRulSteps = step;
      break;
    }
  }
  return {
    predictedRulSteps,
    failureProbabilityNextStep,
    observedWearUm: state.observed_wear_um,
    posteriorMedianWearUm: state.posterior_median_wear_um,
    failureThresholdUm: config.failure_threshold_um,
    condition: {
      conditionId: machine.cutting_condition.condition_id,
      loadClass: machine.cutting_condition.load_class,
    },
  };
}

function severityFor(risk, action) {
  const wearRatio = risk.observedWearUm / risk.failureThresholdUm;
  if (risk.failureProbabilityNextStep >= 0.5 || wearRatio >= 1) return 'CRITICAL';
  if (risk.failureProbabilityNextStep >= 0.25 || wearRatio >= 0.8 || action === 'REPLACE') return 'HIGH';
  if (risk.failureProbabilityNextStep >= 0.1 || wearRatio >= 0.5) return 'MEDIUM';
  return 'LOW';
}

function toCandidate(recommendation, machine) {
  const observation = recommendation.observation;
  const episode = observation.episode;
  const experiment = episode.experiment;
  const payload = recommendation.payloadJson;
  const action = payload.actions.actions.find((item) => item.machine_id === machine.machine_id)?.action;
  const outcome = observation.stepResult?.payloadJson.outcomes.find((item) => item.machine_id === machine.machine_id);
  if (!action || !outcome || observation.attempt !== episode.attempt) return null;

  const risk = riskFrom(machine, experiment.environmentConfig);
  const resources = {
    sparesAvailable: observation.payloadJson.inventory.spares_available,
    inventoryCapacity: observation.payloadJson.inventory.capacity,
  };
  const recommendedAction = action === 'CONTINUE' ? 'DEFER'
    : resources.sparesAvailable > 0 ? 'REPLACE_NOW' : 'SCHEDULE_REPLACEMENT';
  const severity = severityFor(risk, action);
  const priority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(severity) + 1;
  const failureCost = finite(experiment.environmentConfig.costs?.failure_cost);
  const delayAmount = failureCost === null ? null : round(risk.failureProbabilityNextStep * failureCost);
  const rationale = `Policy ${payload.policy_version} recommends ${action.toLowerCase()}; `
    + `failure probability within one step is ${round(risk.failureProbabilityNextStep * 100)}%; `
    + `observed wear is ${risk.observedWearUm}/${risk.failureThresholdUm} µm; `
    + `${resources.sparesAvailable} spare${resources.sparesAvailable === 1 ? '' : 's'} available.`;

  return {
    id: `${recommendation.id}~${machine.machine_id}`,
    decisionId: recommendation.maintenanceDecision?.id ?? null,
    status: recommendation.maintenanceDecision?.status ?? 'PENDING_REVIEW',
    machineId: machine.machine_id,
    toolId: machine.tool_id,
    jobId: machine.job_id ?? null,
    source: {
      experimentId: experiment.id,
      episodeId: episode.id,
      episodeIndex: episode.episodeIndex,
      attempt: observation.attempt,
      step: observation.step,
      observationId: observation.id,
      recommendationId: recommendation.id,
      policyId: recommendation.policyId,
      resultId: observation.stepResult.id,
    },
    recommendedAction,
    severity,
    priority,
    risk,
    resources,
    predictedCost: {
      expected: finite(payload.estimated_expected_cost),
      cvar: finite(payload.estimated_cvar_cost),
      scope: 'JOINT_RECOMMENDATION',
    },
    costOfDelay: { amount: delayAmount, basis: 'ONE_STEP_FAILURE_EXPOSURE' },
    rationale,
    rationaleSource: 'DERIVED_FROM_PERSISTED_EVENTS',
    result: { outcome: outcome.outcome, incurredCost: outcome.incurred_cost },
    createdAt: recommendation.createdAt,
  };
}

function candidatesFrom(recommendation) {
  return (recommendation.observation.payloadJson.machines || [])
    .map((machine) => toCandidate(recommendation, machine))
    .filter(Boolean);
}

function parseQuery(query) {
  const parsed = candidateQuerySchema.safeParse(query);
  if (!parsed.success) throw fromZodError(parsed.error, 'Maintenance decision list query is invalid');
  return parsed.data;
}

function accessibleWhere(user, experimentId) {
  return {
    observation: {
      episode: {
        ...episodeAccessWhere(user),
        ...(experimentId ? { experimentId } : {}),
      },
    },
  };
}

async function listCandidates(db, user, rawQuery) {
  const query = parseQuery(rawQuery);
  const recommendations = await db.policyRecommendation.findMany({
    where: accessibleWhere(user, query.experiment),
    include,
  });
  const candidates = recommendations.flatMap(candidatesFrom).filter((candidate) => (
    (!query.status || candidate.status === query.status)
    && (!query.severity || candidate.severity === query.severity)
    && (!query.machine || candidate.machineId === query.machine)
  ));
  candidates.sort((a, b) => a.priority - b.priority
    || (b.costOfDelay.amount ?? -1) - (a.costOfDelay.amount ?? -1)
    || new Date(b.createdAt) - new Date(a.createdAt)
    || a.id.localeCompare(b.id));
  const total = candidates.length;
  const start = (query.page - 1) * query.limit;
  return {
    data: candidates.slice(start, start + query.limit),
    meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

async function getCandidate(db, user, id) {
  const parsed = candidateIdSchema.safeParse(id);
  if (!parsed.success) throw fromZodError(parsed.error, 'Maintenance decision candidate id is invalid');
  const { recommendationId, machineId } = parsed.data;
  const recommendation = await db.policyRecommendation.findFirst({
    where: { id: recommendationId, ...accessibleWhere(user) },
    include,
  });
  const candidate = recommendation && candidatesFrom(recommendation).find((item) => item.machineId === machineId);
  if (!candidate) throw new ApiError(404, 'DECISION_CANDIDATE_NOT_FOUND', 'Maintenance decision candidate was not found');
  return candidate;
}

module.exports = { listCandidates, getCandidate, toCandidate };
