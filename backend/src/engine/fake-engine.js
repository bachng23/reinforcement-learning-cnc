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

class FakeEngineRunner extends EngineRunner {
  constructor({ version = 'fake-fixture-v1' } = {}) {
    super();
    if (!['development', 'test'].includes(process.env.NODE_ENV)) {
      throw new Error('FakeEngineRunner is restricted to development/test');
    }
    this.version = version;
  }

  async *execute(rawRequest, { signal } = {}) {
    const request = validateEngineRequest(rawRequest);
    const random = mulberry32(request.seed);
    const machineCount = Math.max(2, Math.min(20, Number(request.environmentConfig.machineCount) || 3));
    const stepCount = Math.max(2, Math.min(1000, Number(request.environmentConfig.steps) || 4));
    const spareCount = Math.max(1, Number(request.environmentConfig.spareCount) || 1);
    let totalCost = 0;
    let failureCount = 0;
    let replacementCount = 0;
    let waitingSteps = 0;

    for (let step = 0; step < stepCount; step += 1) {
      if (signal?.aborted) throw signal.reason || new Error('Engine execution aborted');
      const machines = Array.from({ length: machineCount }, (_, index) => {
        const risk = rounded(Math.min(0.99, 0.08 + step * 0.13 + index * 0.09 + random() * 0.12));
        const center = Math.max(0, Math.round((1 - risk) * 10));
        const probabilities = [rounded(0.2 + random() * 0.1), rounded(0.35 + random() * 0.1)];
        probabilities.push(rounded(1 - probabilities[0] - probabilities[1]));
        return {
          machineId: `fixture-machine-${index + 1}`,
          toolAge: step,
          risk,
          waitingForSpare: false,
          rulDistribution: { bins: [Math.max(0, center - 2), center, center + 2], probabilities },
        };
      });

      yield { type: 'FleetObservation', schemaVersion: '2.0', episodeId: request.episodeId, step, fixture: true, machines };

      const recommendations = machines.map((machine, index) => ({
        machineId: machine.machineId,
        action: (step + index) % 2 === 1 ? 'REPLACE' : 'CONTINUE',
        estimatedRisk: machine.risk,
        estimatedCost: (step + index) % 2 === 1 ? 25 : rounded(machine.risk * 8, 2),
      }));
      yield { type: 'PolicyRecommendation', schemaVersion: '2.0', episodeId: request.episodeId, step, fixture: true, recommendations };

      let sparesUsed = 0;
      const outcomes = recommendations.map((recommendation) => {
        let outcome = 'CONTINUED';
        let cost = rounded(recommendation.estimatedRisk * 5, 2);
        if (recommendation.action === 'REPLACE' && sparesUsed < spareCount) {
          outcome = 'REPLACED';
          cost = 25;
          sparesUsed += 1;
          replacementCount += 1;
        } else if (recommendation.action === 'REPLACE') {
          outcome = 'WAITING_FOR_SPARE';
          cost = 7;
          waitingSteps += 1;
        }
        totalCost += cost;
        return { machineId: recommendation.machineId, outcome, cost, failed: false };
      });
      const stepCost = rounded(outcomes.reduce((sum, outcome) => sum + outcome.cost, 0), 2);
      yield {
        type: 'StepResult', schemaVersion: '2.0', episodeId: request.episodeId, step, fixture: true,
        outcomes, stepCost, episodeTerminated: step === stepCount - 1,
      };
    }

    yield {
      type: 'EpisodeSummary', schemaVersion: '2.0', episodeId: request.episodeId, fixture: true,
      stepsCompleted: stepCount, totalCost: rounded(totalCost, 2), failureCount, replacementCount, waitingSteps,
    };
  }
}

module.exports = { FakeEngineRunner, mulberry32 };
