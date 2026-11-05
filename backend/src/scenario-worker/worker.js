const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const lifecycle = require('../services/scenario-lease.service');
const { requestForJob } = require('../services/scenario-engine.adapter');

class ScenarioWorker {
  constructor({ db, client, service = lifecycle, workerId = `scenario-${randomUUID()}`, leaseMs = 30000, pollMs = 1000 } = {}) {
    if (!db || !client) throw new TypeError('Scenario worker requires db and engine client');
    service.leaseDuration(leaseMs);
    if (!Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60000) throw new TypeError('Invalid poll interval');
    Object.assign(this, { db, client, service, workerId, leaseMs, pollMs });
  }
  async runOnce({ signal } = {}) {
    signal?.throwIfAborted();
    const claim = await this.service.claimNext(this.db, { workerId: this.workerId,
      engineVersion: 'scenario-evaluator:1.0.0', contractVersion: 'scenario-engine:1.0', leaseMs: this.leaseMs });
    if (!claim) return { outcome: 'idle' };
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, heartbeat, stopped = false, lost = false;
    const stop = async () => { stopped = true; clearTimeout(timer); await heartbeat; };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => { heartbeat = (async () => {
        try { await this.service.heartbeat(this.db, claim, this.leaseMs); schedule(); }
        catch { lost = true; controller.abort(); }
      })(); }, Math.floor(this.leaseMs / 3));
      timer.unref?.();
    };
    schedule();
    try {
      const remaining = claim.deadline_at - Date.now();
      if (remaining < 1) throw Object.assign(new Error(), { code: 'SCENARIO_TIMEOUT' });
      const request = requestForJob(claim, remaining);
      const result = await this.client.execute(request, { signal: combined,
        requestId: claim.id, correlationId: `scenario:${claim.id}:${claim.attempt}` });
      combined.throwIfAborted();
      // Keep renewals active during expensive response validation; persistence
      // takes the same factory lock and validates the lease again at commit.
      await this.service.persist(this.db, claim, result, { signal: combined });
      return { outcome: 'completed', jobId: claim.id };
    } catch (error) {
      await stop();
      if (lost || error.code === 'SCENARIO_LEASE_CONFLICT') return { outcome: 'lease-lost', jobId: claim.id };
      try {
        if (signal?.aborted) await this.service.release(this.db, claim);
        else await this.service.reject(this.db, claim, error);
      } catch (failure) { if (failure.code !== 'SCENARIO_LEASE_CONFLICT') throw failure; }
      return { outcome: signal?.aborted ? 'released' : 'failed', jobId: claim.id, code: error.code };
    } finally { await stop(); controller.abort(); }
  }
  async start({ signal } = {}) {
    while (!signal?.aborted) {
      const result = await this.runOnce({ signal });
      if (result.outcome === 'idle' || result.outcome === 'failed') {
        try { await delay(this.pollMs, undefined, { signal }); }
        catch (error) { if (!signal?.aborted) throw error; }
      }
    }
  }
}
module.exports = { ScenarioWorker };
