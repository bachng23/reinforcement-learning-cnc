const { setTimeout: delay } = require('node:timers/promises');
const lifecycle = require('../services/decision-case-lifecycle.service');

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('Invalid Decision Case worker timing configuration');
  }
  return parsed;
}

class DecisionCaseWorker {
  constructor({ db, planningClient, lifecycleService = lifecycle, leaseMs = process.env.DECISION_CASE_LEASE_MS,
    pollMs = process.env.DECISION_CASE_POLL_MS, heartbeatMs = process.env.DECISION_CASE_HEARTBEAT_MS,
    logger = console } = {}) {
    if (!db || !planningClient) throw new TypeError('DecisionCaseWorker requires db and planningClient');
    this.db = db;
    this.client = planningClient;
    this.lifecycle = lifecycleService;
    this.leaseMs = integer(leaseMs, 30000, 100, 300000);
    this.pollMs = integer(pollMs, 1000, 10, 60000);
    this.heartbeatMs = integer(heartbeatMs, Math.max(50, Math.floor(this.leaseMs / 3)), 10, this.leaseMs);
    this.logger = logger;
  }

  async runOnce({ signal } = {}) {
    signal?.throwIfAborted();
    const claim = await this.lifecycle.claimNextDecisionCase(this.db, { leaseMs: this.leaseMs });
    if (!claim) return { outcome: 'idle' };
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer;
    let leaseLost = false;
    let stopped = false;
    let heartbeat;
    const stopHeartbeat = async () => {
      stopped = true;
      clearTimeout(timer);
      await heartbeat;
    };
    const scheduleHeartbeat = () => {
      if (stopped) return;
      timer = setTimeout(() => { heartbeat = (async () => {
        try {
          const owned = await this.lifecycle.heartbeatDecisionCase(this.db, claim, { leaseMs: this.leaseMs });
          if (!owned) { leaseLost = true; controller.abort(); return; }
          claim.revision = owned.revision;
          claim.leaseExpiresAt = owned.leaseExpiresAt;
          scheduleHeartbeat();
        } catch (error) {
          leaseLost = true;
          this.logger.error?.('Decision Case heartbeat failed', { caseId: claim.id, code: error.code || 'HEARTBEAT_FAILED' });
          controller.abort();
        }
      })(); }, this.heartbeatMs);
      timer.unref?.();
    };
    scheduleHeartbeat();
    try {
      const request = await this.lifecycle.buildPlanningRequest(claim, { signal: combined });
      const recommendation = await this.client.plan(request, { signal: combined,
        requestId: claim.requestId, correlationId: claim.correlationId });
      // Drain an in-flight renewal before passing its revision to persistence.
      // Validation/persistence has its own lease fence and transaction deadline.
      await stopHeartbeat();
      combined.throwIfAborted();
      await this.lifecycle.persistDecisionRecommendation(this.db, claim, recommendation);
      return { outcome: 'completed', caseId: claim.id, recommendationId: recommendation.recommendation_id };
    } catch (error) {
      await stopHeartbeat();
      if (leaseLost || lifecycle.leaseConflict(error)) {
        return { outcome: 'lease-lost', caseId: claim.id };
      }
      if (signal?.aborted) {
        const released = await this.lifecycle.releaseDecisionCaseClaim(this.db, claim).catch(releaseError => {
          if (!lifecycle.leaseConflict(releaseError)) throw releaseError;
          return false;
        });
        return { outcome: released ? 'released' : 'lease-lost', caseId: claim.id };
      }
      try { await this.lifecycle.blockDecisionCase(this.db, claim, error); }
      catch (blockError) {
        if (lifecycle.leaseConflict(blockError)) return { outcome: 'lease-lost', caseId: claim.id };
        throw blockError;
      }
      return { outcome: 'blocked', caseId: claim.id, code: error.code || 'AI_UNAVAILABLE' };
    } finally {
      await stopHeartbeat();
      controller.abort();
    }
  }

  async start({ signal } = {}) {
    while (!signal?.aborted) {
      const result = await this.runOnce({ signal });
      if (result.outcome === 'idle') {
        try { await delay(this.pollMs, undefined, { signal }); }
        catch (error) { if (!signal?.aborted) throw error; }
      }
    }
  }
}

module.exports = { DecisionCaseWorker };
