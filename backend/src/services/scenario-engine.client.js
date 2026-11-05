const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const aiRoot = path.resolve(__dirname, '../../../ai_services');
const { pythonExecutable } = require('./operations-contract.service');
const fail = (code, retryable = false) => Object.assign(new Error(code), { code, retryable });

// Use the authoritative Python DTO/validator, also exported as generated JSON
// Schema. No duplicated Node scoring, application jobs or database writes.
function validate(envelope, python, signal, code) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const child = spawn(python, [path.join(aiRoot, 'scripts/validate_scenario_transport.py')],
      { cwd: aiRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    let output = '', overflow = false;
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024) { overflow = true; child.kill(); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { signal.removeEventListener('abort', abort); reject(fail('SCENARIO_VALIDATOR_UNAVAILABLE')); });
    child.once('close', exit => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return reject(signal.reason);
      if (exit !== 0 || overflow) return reject(fail(code));
      try { if (JSON.parse(output).ok !== true) throw Error(); resolve(); }
      catch { reject(fail(code)); }
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}

async function readResult(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw fail('INVALID_SCENARIO_RESPONSE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail('INVALID_SCENARIO_RESPONSE');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024 * 1024) { await reader.cancel(); throw fail('INVALID_SCENARIO_RESPONSE'); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('INVALID_SCENARIO_RESPONSE'); }
  } finally { reader.releaseLock(); }
}

class ScenarioEngineClient {
  constructor({ baseUrl = process.env.AI_SERVICE_URL, python = pythonExecutable(),
    fetcher = fetch, transportAllowanceMs = 2000 } = {}) {
    try {
      this.url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password || this.url.search || this.url.hash) throw Error();
    } catch { throw fail('INVALID_SCENARIO_CONFIGURATION'); }
    if (!python || !Number.isSafeInteger(transportAllowanceMs) || transportAllowanceMs < 0 || transportAllowanceMs > 30000) throw fail('INVALID_SCENARIO_CONFIGURATION');
    this.python = python;
    this.fetcher = fetcher;
    this.allowance = transportAllowanceMs;
  }

  async execute(payload, { signal, requestId = randomUUID(), correlationId = requestId } = {}) {
    if (signal?.aborted) throw fail('SCENARIO_CANCELLED');
    if (![requestId, correlationId].every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id))) throw fail('INVALID_SCENARIO_REQUEST');
    const request = structuredClone(payload);
    const route = { EVALUATE: 'evaluate', SENSITIVITY: 'sensitivity', COMPARE: 'compare' }[request.operation];
    const budget = request.operation === 'SENSITIVITY' ? request.input?.budget : request.budget;
    if (!route || !Number.isSafeInteger(budget?.remaining_ms) || budget.remaining_ms < 1 || budget.remaining_ms > 300000) throw fail('INVALID_SCENARIO_REQUEST');
    const deadline = performance.now() + budget.remaining_ms;
    const timerSignal = AbortSignal.timeout(budget.remaining_ms + this.allowance);
    const combined = signal ? AbortSignal.any([signal, timerSignal]) : timerSignal;
    try {
      await validate({ request }, this.python, combined, 'INVALID_SCENARIO_REQUEST');
      for (let attempt = 0; attempt < 2; attempt++) {
        combined.throwIfAborted();
        budget.remaining_ms = Math.floor(deadline - performance.now());
        if (budget.remaining_ms < 1) throw fail('SCENARIO_TIMEOUT', true);
        const url = new URL(this.url);
        url.pathname = url.pathname.replace(/\/$/, '') + '/v1/scenarios/' + route;
        let response;
        try {
          response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal: combined,
            headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-correlation-id': correlationId },
            body: JSON.stringify(request) });
        } catch (error) {
          combined.throwIfAborted();
          if (attempt === 0) continue;
          throw fail('SCENARIO_UNAVAILABLE', true);
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (attempt === 0 && [500, 502, 503].includes(response.status)) continue;
          throw fail(response.status === 422 ? 'INVALID_SCENARIO_REQUEST' : response.status === 504 ? 'SCENARIO_TIMEOUT' : 'SCENARIO_UNAVAILABLE', response.status >= 500);
        }
        const result = await readResult(response);
        await validate({ request, result }, this.python, combined, 'INVALID_SCENARIO_RESPONSE');
        return result;
      }
    } catch (error) {
      if (signal?.aborted) throw fail('SCENARIO_CANCELLED');
      if (timerSignal.aborted) throw fail('SCENARIO_TIMEOUT', true);
      throw error;
    }
  }
}

async function validateScenarioResult(request, result, { signal = AbortSignal.timeout(15000), python = pythonExecutable() } = {}) {
  if (!python) throw fail('INVALID_SCENARIO_CONFIGURATION');
  return validate({ request, result }, python, signal, 'INVALID_SCENARIO_RESPONSE');
}
module.exports = { ScenarioEngineClient, validateScenarioResult };
