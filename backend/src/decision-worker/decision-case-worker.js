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
    const scheduleHeartbeat = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        try {
          const owned = await this.lifecycle.heartbeatDecisionCase(this.db, claim, { leaseMs: this.leaseMs });
          if (stopped) return;
          if (!owned) { leaseLost = true; controller.abort(); return; }
          scheduleHeartbeat();
        } catch (error) {
          leaseLost = true;
          this.logger.error?.('Decision Case heartbeat failed', { caseId: claim.id, code: error.code || 'HEARTBEAT_FAILED' });
          controller.abort();
        }
      }, this.heartbeatMs);
      timer.unref?.();
    };
    scheduleHeartbeat();
    try {
      const request = await this.lifecycle.buildPlanningRequest(claim, { signal: combined });
      const recommendation = await this.client.plan(request, { signal: combined,
        requestId: claim.requestId, correlationId: claim.correlationId });
      await this.lifecycle.persistDecisionRecommendation(this.db, claim, recommendation);
      return { outcome: 'completed', caseId: claim.id, recommendationId: recommendation.recommendation_id };
    } catch (error) {
      if (leaseLost || error?.code === 'DECISION_CASE_LEASE_LOST') {
        return { outcome: 'lease-lost', caseId: claim.id };
      }
      if (signal?.aborted) {
        const released = await this.lifecycle.releaseDecisionCaseClaim(this.db, claim).catch(releaseError => {
          if (releaseError?.code !== 'DECISION_CASE_LEASE_LOST') throw releaseError;
          return false;
        });
        return { outcome: released ? 'released' : 'lease-lost', caseId: claim.id };
      }
      try { await this.lifecycle.blockDecisionCase(this.db, claim, error); }
      catch (blockError) {
        if (blockError?.code === 'DECISION_CASE_LEASE_LOST') return { outcome: 'lease-lost', caseId: claim.id };
        throw blockError;
      }
      return { outcome: 'blocked', caseId: claim.id, code: error.code || 'AI_UNAVAILABLE' };
    } finally {
      stopped = true;
      clearTimeout(timer);
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
