const { EngineRunner } = require('./runner');
const { validateEngineRequest } = require('./contracts');

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const rounded = (number, digits = 4) => Number(number.toFixed(digits));

const makeRulDistribution = (risk) => {
  const nearFailure = rounded(risk * 0.25, 6);
  const mediumTerm = rounded(risk * 0.35, 6);
  const longTerm = rounded(risk - nearFailure - mediumTerm, 6);
  const survival = rounded(1 - nearFailure - mediumTerm - longTerm, 6);
  return {
    support_steps: [0, 1, 2],
    probability_mass: [nearFailure, mediumTerm, longTerm],
    survival_beyond_horizon: survival,
    model_version: 'fake-rul-v1',
  };
};

class FakeEngineRunner extends EngineRunner {
  constructor({ version = 'fake-fixture-v2' } = {}) {
    super();
    if (!['development', 'test'].includes(process.env.NODE_ENV)) {
      throw new Error('FakeEngineRunner is restricted to development/test');
    }
    this.version = version;
  }

  async *execute(rawRequest, { signal } = {}) {
    const request = validateEngineRequest(rawRequest);
    const config = request.environmentConfig;
    const random = mulberry32(request.seed);
    const machines = Array.from({ length: config.number_of_machines }, (_, index) => ({
      machineId: `fixture-machine-${index + 1}`,
      toolId: `fixture-tool-${index + 1}-generation-1`,
      generation: 1,
      age: 0,
    }));
    let sparesAvailable = config.initial_spares;
    let totalCost = 0;
    let failureCount = 0;
    let replacementCount = 0;
    let waitingSteps = 0;

    for (let step = 0; step < config.horizon_steps; step += 1) {
      if (signal?.aborted) throw signal.reason || new Error('Engine execution aborted');
      const observationId = `observation:${request.episodeId}:attempt:${request.attempt}:step:${step}`;
      const machineObservations = machines.map((machine, index) => {
        const risk = rounded(Math.min(0.95, 0.08 + step * 0.13 + index * 0.09 + random() * 0.12), 6);
        const observedWear = rounded(Math.min(
          config.failure_threshold_um,
          (machine.age + 1) * (config.failure_threshold_um / Math.max(2, config.horizon_steps))
            * (0.8 + random() * 0.2),
        ));
        return {
          machine_id: machine.machineId,
          tool_id: machine.toolId,
          job_id: `fixture-job-${step + 1}`,
          cutting_condition: {
            condition_id: index % 2 === 0 ? 'fixture-nominal' : 'fixture-heavy',
            load_class: index % 2 === 0 ? 'NOMINAL' : 'HEAVY',
          },
          tool_state: {
            tool_age_steps: machine.age,
            observed_wear_um: observedWear,
            posterior_median_wear_um: rounded(observedWear * 0.95),
            posterior_std_wear_um: rounded(Math.max(1, observedWear * 0.08)),
            rul_distribution: makeRulDistribution(risk),
          },
        };
      });

      const observation = {
        schema_version: '2.0',
        observation_id: observationId,
        episode_id: request.episodeId,
        step,
        machines: machineObservations,
        inventory: { spares_available: sparesAvailable, capacity: config.spare_capacity },
      };
      yield { type: 'FleetObservation', payload: observation };

      const actions = machineObservations.map((machine, index) => ({
        machine_id: machine.machine_id,
        action: (step + index) % 2 === 1 ? 'REPLACE' : 'CONTINUE',
      }));
      const expectedCost = rounded(actions.reduce((sum, action) => (
        sum + (action.action === 'REPLACE' ? config.costs.replacement_cost : 0)
      ), 0));
      yield {
        type: 'PolicyRecommendation',
        payload: {
          schema_version: '2.0',
          observation_id: observationId,
          policy_id: request.policyId,
          policy_version: request.policyVersion,
          actions: { schema_version: '2.0', observation_id: observationId, actions },
          estimated_expected_cost: expectedCost,
          estimated_cvar_cost: config.risk.objective === 'CVAR'
            ? rounded(expectedCost / config.risk.cvar_alpha)
            : null,
        },
      };

      const outcomes = actions.map((action, index) => {
        const machine = machines[index];
        const toolIdBefore = machine.toolId;
        let outcome = 'CONTINUED';
        let toolIdAfter = null;
        let incurredCost = 0;

        if (action.action === 'REPLACE' && sparesAvailable > 0) {
          outcome = 'REPLACED';
          incurredCost = config.costs.replacement_cost;
          sparesAvailable -= 1;
          replacementCount += 1;
          machine.generation += 1;
          machine.toolId = `fixture-tool-${index + 1}-generation-${machine.generation}`;
          machine.age = 0;
          toolIdAfter = machine.toolId;
        } else if (action.action === 'REPLACE') {
          outcome = 'WAITING_FOR_SPARE';
          incurredCost = config.costs.waiting_cost_per_step;
          waitingSteps += 1;
          machine.age += 1;
        } else {
          machine.age += 1;
        }

        totalCost += incurredCost;
        if (outcome === 'FAILED') failureCount += 1;
        return {
          machine_id: action.machine_id,
          requested_action: action.action,
          outcome,
          tool_id_before: toolIdBefore,
          tool_id_after: toolIdAfter,
          incurred_cost: rounded(incurredCost),
        };
      });
      const stepCost = rounded(outcomes.reduce((sum, outcome) => sum + outcome.incurred_cost, 0));
      yield {
        type: 'StepResult',
        payload: {
          schema_version: '2.0',
          observation_id: observationId,
          episode_id: request.episodeId,
          step,
          outcomes,
          inventory_after: { spares_available: sparesAvailable, capacity: config.spare_capacity },
          total_cost: stepCost,
          episode_terminated: step === config.horizon_steps - 1,
        },
      };
    }

    yield {
      type: 'EpisodeSummary',
      payload: {
        schema_version: '2.0',
        episode_id: request.episodeId,
        policy_id: request.policyId,
        seed: request.seed,
        steps_completed: config.horizon_steps,
        total_cost: rounded(totalCost),
        failure_count: failureCount,
        replacement_count: replacementCount,
        waiting_steps: waitingSteps,
      },
    };
  }
}

module.exports = { FakeEngineRunner, mulberry32 };
