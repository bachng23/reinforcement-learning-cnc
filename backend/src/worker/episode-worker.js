const { consumeEngineEvents } = require('./event-collector');
const { createLogger } = require('./logger');
const { WorkerHealth } = require('./health');
class EpisodeWorker {
  constructor({ repository, runner, timeoutMs = 30000, staleAfterMs = 120000, heartbeatMs = Math.floor(staleAfterMs / 3), shutdownMs = 30000, logger = createLogger(), health = new WorkerHealth() }) {
    if (!(heartbeatMs > 0 && heartbeatMs < staleAfterMs)) throw new Error('Heartbeat interval must be positive and shorter than lease');
    Object.assign(this, { repository, runner, timeoutMs, staleAfterMs, heartbeatMs, shutdownMs, logger, health });
    this.stopping = false;
    this.active = null;
  }
  async recoverStale() {
    const result = await this.repository.recoverStale(new Date());
    if (result.count) this.logger.warn('episodes_recovered', { count: result.count });
    return result.count;
  }
  stop() {
    this.stopping = true;
    if (this.active && !this.shutdownTimer) {
      this.shutdownTimer = setTimeout(() => this.controller?.abort(Object.assign(new Error('Worker shutdown grace period exceeded'), { code: 'WORKER_SHUTDOWN' })), this.shutdownMs);
    }
    return this.active || Promise.resolve();
  }
  processNext() {
    if (this.stopping || this.active) return Promise.resolve(false);
    this.controller = new AbortController();
    this.active = this.run().finally(() => {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      this.active = null;
      this.controller = null;
    });
    return this.active;
  }
  async run() {
    this.health.polling();
    const episode = await this.repository.claimNext(this.staleAfterMs);
    if (!episode) return false;
    const context = { experimentId: episode.experimentId, episodeId: episode.id, engineVersion: this.runner.version || 'unknown' };
    this.logger.info('episode_claimed', context);
    let timer;
    let heartbeat = Promise.resolve();
    let finished = false;
    const schedule = () => {
      timer = setTimeout(() => {
        heartbeat = this.repository.heartbeat(episode, this.staleAfterMs).then(() => {
          if (!finished) schedule();
        }).catch((error) => { this.controller.abort(error); });
      }, this.heartbeatMs);
    };
    const stopHeartbeat = async () => { finished = true; clearTimeout(timer); await heartbeat; };
    schedule();
    try {
      if (this.stopping) throw Object.assign(new Error('Worker stopped during claim'), { code: 'WORKER_SHUTDOWN' });
      const request = { episodeId: episode.id, attempt: episode.attempt, environmentConfig: episode.experiment.environmentConfig,
        policyId: episode.policy.policyKey, policyVersion: episode.policy.version, seed: episode.seed };
      const summary = await consumeEngineEvents(this.runner, request, {
        timeoutMs: this.timeoutMs, signal: this.controller.signal,
        onStep: (step) => this.repository.persistStep(episode, step),
      });
      await stopHeartbeat();
      this.controller.signal.throwIfAborted();
      await this.repository.persistSummary(episode, summary);
      this.health.completed();
      this.logger.info('episode_completed', { ...context, simulationStep: summary.payload.steps_completed - 1 });
    } catch (error) {
      await stopHeartbeat();
      this.health.failed();
      this.logger.error('episode_failed', { ...context, code: error.code || 'ENGINE_EXECUTION_FAILED', message: error.message });
      try { await this.repository.markFailed(episode, error); }
      catch (failure) { this.logger.error('failure_status_persistence_failed', { ...context, message: failure.message }); }
    } finally { await stopHeartbeat(); }
    return true;
  }
}
module.exports = { EpisodeWorker };
