jest.mock('../src/services/operations-contract.service', () => ({ validatePayload: jest.fn(async value => value) }));
const { validatePayload } = require('../src/services/operations-contract.service');
const { OperationsPlanningClient } = require('../src/services/operations-planning.client');
const { ApiError } = require('../src/lib/api-error');

const request = { planning_config: { solver_timeout_seconds: 1, candidate_limit: 3 },
  decision_case_id: 'case', factory_snapshot: { factory_id: 'factory', snapshot_id: 'snapshot' } };
const recommendation = { decision_case_id: 'case', snapshot_id: 'snapshot', candidate_plans: [{ schedule: { factory_id: 'factory' } }] };
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

test('requires configured AI URL and rejects unsafe transport configuration', () => {
  for (const baseUrl of ['', 'file:///tmp/ai', 'http://user:secret@example.test', 'https://example.test?override=true']) {
    expect(() => new OperationsPlanningClient({ baseUrl })).toThrow('AI_SERVICE_URL');
  }
  expect(() => new OperationsPlanningClient({ baseUrl: 'https://example.test', transportAllowanceMs: -1 })).toThrow();
});

test('total deadline including retry cannot exceed solver timeout plus allowance', async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn()
    .mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return Response.json({ retryable: true }, { status: 503 });
    })
    .mockImplementation((_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const client = new OperationsPlanningClient({ baseUrl: 'https://example.test', timeoutMs: 10000, transportAllowanceMs: 100, fetcher });
  const pending = expect(client.plan(request)).rejects.toMatchObject({ code: 'PLANNING_TIMEOUT' });
  await jest.advanceTimersByTimeAsync(1100);
  await pending;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('cancellation during contract validation reaches the validator and prevents HTTP', async () => {
  const controller = new AbortController();
  validatePayload.mockImplementationOnce((_value, _mode, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const fetcher = jest.fn();
  const client = new OperationsPlanningClient({ baseUrl: 'https://example.test', fetcher });
  const pending = expect(client.plan(request, { signal: controller.signal })).rejects.toMatchObject({ code: 'PLANNING_CANCELLED' });
  controller.abort();
  await pending;
  expect(fetcher).not.toHaveBeenCalled();
});

test('validator unavailability is not treated as a valid response or retried', async () => {
  validatePayload.mockResolvedValueOnce(request).mockRejectedValueOnce(new ApiError(503, 'OPERATIONS_VALIDATOR_UNAVAILABLE', 'unavailable'));
  const fetcher = jest.fn(async () => Response.json(recommendation));
  const client = new OperationsPlanningClient({ baseUrl: 'https://example.test', fetcher });
  await expect(client.plan(request)).rejects.toMatchObject({ code: 'OPERATIONS_VALIDATOR_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('HTTP 200 still requires both canonical request and recommendation validation', async () => {
  const client = new OperationsPlanningClient({ baseUrl: 'https://example.test', fetcher: async () => Response.json(recommendation) });
  await expect(client.plan(request)).resolves.toEqual(recommendation);
  expect(validatePayload.mock.calls.map(args => args[1])).toEqual(['planning-request', 'recommendation']);
});

test('a broken response stream cannot turn an observed 4xx into a transport retry', async () => {
  const fetcher = jest.fn(async () => ({ status: 422, body: {
    cancel: async () => { throw new TypeError('broken stream'); },
  } }));
  const client = new OperationsPlanningClient({ baseUrl: 'https://example.test', fetcher });
  await expect(client.plan(request)).rejects.toMatchObject({ code: 'INVALID_PLANNING_REQUEST' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
