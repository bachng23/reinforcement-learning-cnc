const { randomUUID } = require('node:crypto');
const { ApiError } = require('../lib/api-error');
const { validatePayload } = require('./operations-contract.service');

const failures = {
  INVALID_PLANNING_REQUEST: [422, 'Planning request does not conform to contract v3'],
  NO_FEASIBLE_PLAN: [409, 'No feasible operations plan was found'],
  PLANNING_TIMEOUT: [504, 'Operations planning exceeded its deadline'],
  AI_UNAVAILABLE: [503, 'Operations AI service is unavailable'],
  INVALID_AI_RESPONSE: [502, 'Operations AI returned an invalid recommendation'],
  PLANNING_CANCELLED: [499, 'Operations planning was cancelled'],
};
function failure(code, retryable = false) {
  return Object.assign(new ApiError(failures[code][0], code, failures[code][1]), { retryable });
}

function positiveInteger(value, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new ApiError(500, 'INVALID_AI_CONFIGURATION', 'Invalid planning transport configuration');
  }
  return number;
}

async function readJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel().catch(() => {});
    throw failure('INVALID_AI_RESPONSE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw failure('INVALID_AI_RESPONSE');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw failure('INVALID_AI_RESPONSE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure('INVALID_AI_RESPONSE'); }
}

class OperationsPlanningClient {
  constructor({ baseUrl = process.env.AI_SERVICE_URL,
    transportAllowanceMs = process.env.AI_TRANSPORT_ALLOWANCE_MS,
    timeoutMs, fetcher = fetch } = {}) {
    try {
      this.url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password
          || this.url.search || this.url.hash) throw new Error();
      this.url.pathname = this.url.pathname.replace(/\/$/, '') + '/v1/operations/plan';
    } catch { throw new ApiError(500, 'INVALID_AI_CONFIGURATION', 'AI_SERVICE_URL must be an explicit HTTP(S) service URL'); }
    this.allowanceMs = positiveInteger(transportAllowanceMs, 2000, 30000);
    this.timeoutMs = timeoutMs === undefined ? Infinity : positiveInteger(timeoutMs, undefined, 330000);
    this.fetcher = fetcher;
  }

  async plan(payload, { signal, requestId = randomUUID(), correlationId = requestId } = {}) {
    if (signal?.aborted) throw failure('PLANNING_CANCELLED');
    if (![requestId, correlationId].every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id))) {
      throw failure('INVALID_PLANNING_REQUEST');
    }
    const seconds = payload?.planning_config?.solver_timeout_seconds ?? 30;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw failure('INVALID_PLANNING_REQUEST');
    // One absolute budget covers validation, response bodies and BOTH attempts.
    const controller = new AbortController();
    const budget = Math.min(this.timeoutMs, seconds * 1000 + this.allowanceMs);
    const timer = setTimeout(() => controller.abort(), budget);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      let request;
      try { request = await validatePayload(payload, 'planning-request', { signal: combined }); }
      catch (error) {
        if (error.code === 'INVALID_OPERATIONS_SCHEMA') throw failure('INVALID_PLANNING_REQUEST');
        throw error;
      }
      const body = JSON.stringify(request);
      for (let attempt = 0; attempt < 2; attempt++) {
        combined.throwIfAborted();
        let response, data;
        try {
          response = await this.fetcher(this.url, {
            method: 'POST', redirect: 'error', signal: combined,
            headers: { 'content-type': 'application/json', accept: 'application/json',
              'x-request-id': requestId, 'x-correlation-id': correlationId }, body,
          });
          const terminal = { 422: 'INVALID_PLANNING_REQUEST', 409: 'NO_FEASIBLE_PLAN', 504: 'PLANNING_TIMEOUT' }[response.status];
          if (terminal || (response.status >= 400 && response.status < 500)) {
            await response.body?.cancel().catch(() => {});
            throw failure(terminal || 'AI_UNAVAILABLE');
          }
          // Error bodies are advisory only. Gateways commonly produce HTML/text
          // for 502/503, which must retain the documented retry semantics.
          if (!response.ok) {
            try { data = await readJson(response); }
            catch { data = undefined; }
          } else {
            data = await readJson(response);
          }
        } catch (error) {
          combined.throwIfAborted();
          if (error instanceof ApiError) throw error;
          // Only transport failures retry. Never replay a malformed/invalid DTO.
          if (attempt === 0) continue;
          throw failure('AI_UNAVAILABLE', true);
        }
        if (!response.ok) {
          const retryable = response.status >= 500 && response.status <= 599
            && (data?.retryable === true || ([502, 503].includes(response.status) && data?.retryable !== false));
          if (retryable && attempt === 0) continue;
          throw failure('AI_UNAVAILABLE', retryable);
        }
        let recommendation;
        try { recommendation = await validatePayload(data, 'recommendation', { signal: combined }); }
        catch (error) {
          if (error.code === 'INVALID_OPERATIONS_SCHEMA') throw failure('INVALID_AI_RESPONSE');
          throw error;
        }
        const candidates = recommendation.candidate_plans;
        if (recommendation.decision_case_id !== request.decision_case_id
            || recommendation.snapshot_id !== request.factory_snapshot.snapshot_id
            || candidates.length > Math.min(3, request.planning_config.candidate_limit)
            || candidates.some(plan => plan.schedule.factory_id !== request.factory_snapshot.factory_id)) {
          throw failure('INVALID_AI_RESPONSE');
        }
        combined.throwIfAborted();
        return recommendation;
      }
    } catch (error) {
      const mapped = signal?.aborted ? failure('PLANNING_CANCELLED')
        : controller.signal.aborted ? failure('PLANNING_TIMEOUT') : error;
      mapped.requestId = requestId;
      mapped.correlationId = correlationId;
      throw mapped;
    } finally { clearTimeout(timer); }
  }
}
module.exports = { OperationsPlanningClient };
