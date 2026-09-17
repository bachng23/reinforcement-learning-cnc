process.env.JWT_SECRET = 'maintenance-candidate-test-secret';
jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  policyRecommendation: { findMany: jest.fn(), findFirst: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const db = require('../src/config/prisma');
const app = require('../src/app');
const { toCandidate } = require('../src/services/maintenance-candidate.service');

const userId = '84f17b7f-250e-4b68-af93-338cff87bd12';
const otherUserId = 'c60d01c3-3a2a-4e02-b197-e109bf2d9624';
const experimentId = 'b54092cc-a79d-4db7-82b3-c5160c69be8c';
const otherExperimentId = 'cd6ba4a8-df5f-46c4-aa85-5c9eec0f28e8';
const recommendationId = '7d9d3d39-6208-4ea7-9668-c7781744ef12';
const secondRecommendationId = '31936c12-70d6-44b7-9437-38bc7bff6303';
const policyId = '10d03b67-e956-4344-8063-42f71e9510bf';
const date = new Date('2026-09-17T08:00:00.000Z');

function machine(machineId, nearFailure, observedWearUm) {
  return {
    machine_id: machineId,
    tool_id: `tool-${machineId}`,
    job_id: 'job-08',
    cutting_condition: { condition_id: 'heavy-cut', load_class: 'HEAVY' },
    tool_state: {
      observed_wear_um: observedWearUm,
      posterior_median_wear_um: observedWearUm - 4,
      rul_distribution: {
        support_steps: [0, 1, 2],
        probability_mass: [nearFailure / 2, nearFailure / 2, 0.9 - nearFailure],
        survival_beyond_horizon: 0.1,
      },
    },
  };
}

function recommendation({ id, ownerId = userId, experiment = experimentId, machines, actions, spares, status, attempt = 1, currentAttempt = 1 }) {
  return {
    id,
    policyId,
    createdAt: date,
    payloadJson: {
      policy_version: '1.0',
      actions: { actions: actions.map((action, index) => ({ machine_id: machines[index].machine_id, action })) },
      estimated_expected_cost: 25,
      estimated_cvar_cost: null,
    },
    maintenanceDecision: status ? { id: '71879b8e-16d0-471f-9f46-a34fd11cd17c', status } : null,
    observation: {
      id: '39c4a00a-330b-4e2a-93b9-3de2f3e8ad90',
      step: 8,
      attempt,
      payloadJson: { machines, inventory: { spares_available: spares, capacity: 2 } },
      stepResult: {
        id: '0bd5b4b8-2e31-4b41-b759-15bb38257668',
        payloadJson: { outcomes: machines.map((m, index) => ({
          machine_id: m.machine_id,
          outcome: actions[index] === 'REPLACE' ? 'REPLACED' : 'CONTINUED',
          incurred_cost: actions[index] === 'REPLACE' ? 25 : 0,
        })) },
      },
      episode: {
        id: 'f58e5427-655c-4e32-867a-32d5d59f09c1',
        episodeIndex: 0,
        attempt: currentAttempt,
        experimentId: experiment,
        experiment: {
          id: experiment,
          createdById: ownerId,
          environmentConfig: { failure_threshold_um: 300, costs: { failure_cost: 500 } },
        },
      },
    },
  };
}

let rows;
let server;
let base;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/maintenance/decisions`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  jest.clearAllMocks();
  rows = [
    recommendation({
      id: recommendationId,
      machines: [machine('machine-01', 0.7, 280), machine('machine-02', 0.36, 245)],
      actions: ['CONTINUE', 'REPLACE'],
      spares: 1,
    }),
    recommendation({
      id: secondRecommendationId,
      machines: [machine('machine-03', 0.08, 60)],
      actions: ['REPLACE'],
      spares: 0,
      status: 'APPROVED',
    }),
  ];
  db.user.findUnique.mockResolvedValue({ id: userId, active: true, role: 'VIEWER' });
  const visible = (where) => rows.filter((row) => {
    const episode = where.observation.episode;
    return (!episode.experimentId || row.observation.episode.experimentId === episode.experimentId)
      && (!episode.experiment?.createdById || row.observation.episode.experiment.createdById === episode.experiment.createdById)
      && (!where.id || row.id === where.id);
  });
  db.policyRecommendation.findMany.mockImplementation(async ({ where }) => visible(where));
  db.policyRecommendation.findFirst.mockImplementation(async ({ where }) => visible(where)[0] ?? null);
});

function request(path = '', role = 'VIEWER') {
  db.user.findUnique.mockResolvedValue({ id: userId, active: true, role });
  return fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET)}` } });
}

test('lists prioritized machine candidates with persisted risk, policy and result context', async () => {
  const response = await request(`?experiment=${experimentId}`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
  expect(body.data.map((item) => [item.machineId, item.severity, item.recommendedAction]))
    .toEqual([
      ['machine-01', 'CRITICAL', 'DEFER'],
      ['machine-02', 'HIGH', 'REPLACE_NOW'],
      ['machine-03', 'HIGH', 'SCHEDULE_REPLACEMENT'],
    ]);
  const first = body.data[0];
  expect(first.risk).toMatchObject({ failureProbabilityNextStep: 0.7, observedWearUm: 280, predictedRulSteps: 1 });
  expect(first.costOfDelay).toEqual({ amount: 350, basis: 'ONE_STEP_FAILURE_EXPOSURE' });
  expect(first.predictedCost).toEqual({ expected: 25, cvar: null, scope: 'JOINT_RECOMMENDATION' });
  expect(first.result).toEqual({ outcome: 'CONTINUED', incurredCost: 0 });
  expect(first.rationaleSource).toBe('DERIVED_FROM_PERSISTED_EVENTS');
  expect(first.source).toMatchObject({ experimentId, recommendationId, policyId, step: 8, attempt: 1 });
  expect(body.data[2]).toMatchObject({ status: 'APPROVED', decisionId: expect.any(String) });
  expect(db.policyRecommendation.findMany.mock.calls[0][0].where.observation.episode)
    .toMatchObject({ experimentId, experiment: { createdById: userId } });
});

test('filters before pagination and returns stable totals and empty pages', async () => {
  const response = await request('?severity=HIGH&status=APPROVED&machine=machine-03&page=1&limit=1');
  const body = await response.json();
  expect(body.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
  expect(body.data.map((item) => item.machineId)).toEqual(['machine-03']);

  const secondPage = await request('?page=2&limit=1');
  expect((await secondPage.json()).data.map((item) => item.machineId)).toEqual(['machine-02']);
  const empty = await request('?page=5&limit=1');
  expect((await empty.json()).meta).toEqual({ page: 5, limit: 1, total: 3, totalPages: 3 });
  const noMatch = await request(`?experiment=${otherExperimentId}`);
  expect((await noMatch.json()).meta.total).toBe(0);
});

test('gets a candidate by its composite id and enforces owner scope', async () => {
  const response = await request(`/${recommendationId}~machine-02`);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    id: `${recommendationId}~machine-02`,
    machineId: 'machine-02',
    recommendedAction: 'REPLACE_NOW',
    risk: { predictedRulSteps: 2 },
  });
  expect((await request(`/${recommendationId}~absent`)).status).toBe(404);
  rows[0].observation.episode.experiment.createdById = otherUserId;
  expect((await request(`/${recommendationId}~machine-02`)).status).toBe(404);
  expect((await request(`/${recommendationId}~machine-02`, 'ADMIN')).status).toBe(200);
});

test('rejects invalid filters and ids and requires authentication', async () => {
  for (const query of ['?status=OPEN', '?severity=URGENT', '?page=0', '?limit=101', '?experiment=bad', '?machine=bad%20id', '?unknown=x']) {
    expect((await request(query)).status).toBe(400);
  }
  expect((await request('/invalid-id')).status).toBe(400);
  expect((await fetch(base)).status).toBe(401);
});

test('omits incomplete events and prior episode attempts', () => {
  const stale = recommendation({ id: recommendationId, machines: [machine('machine-01', 0.2, 100)], actions: ['CONTINUE'], spares: 1, attempt: 1, currentAttempt: 2 });
  expect(toCandidate(stale, stale.observation.payloadJson.machines[0])).toBeNull();
  stale.observation.attempt = 2;
  stale.observation.stepResult = null;
  expect(toCandidate(stale, stale.observation.payloadJson.machines[0])).toBeNull();
});
