const { collectEngineEvents } = require('./event-collector');
const { createLogger } = require('./logger');
const { WorkerHealth } = require('./health');

class EpisodeWorker {
  constructor({ repository, runner, timeoutMs = 30000, staleAfterMs = 120000, logger = createLogger(), health = new WorkerHealth() }) {
    this.repository = repository;
    this.runner = runner;
    this.timeoutMs = timeoutMs;
    this.staleAfterMs = staleAfterMs;
    this.logger = logger;
    this.health = health;
  }

  async recoverStale() {
    const result = await this.repository.recoverStale(new Date(Date.now() - this.staleAfterMs));
    if (result.count) this.logger.warn('episodes_recovered', { count: result.count });
    return result.count;
  }

  async processNext() {
    this.health.polling();
    const episode = await this.repository.claimNext();
    if (!episode) return false;
    const context = { experimentId: episode.experimentId, episodeId: episode.id, engineVersion: this.runner.version || 'unknown' };
    this.logger.info('episode_claimed', context);
    try {
      const request = {
        episodeId: episode.id,
        attempt: episode.attempt,
        environmentConfig: episode.experiment.environmentConfig,
        policyId: episode.policy.policyKey,
        policyVersion: episode.policy.version,
        seed: episode.seed,
      };
      this.logger.info('engine_started', context);
      const events = await collectEngineEvents(this.runner, request, { timeoutMs: this.timeoutMs });
      await this.repository.persistCompleted(episode, events);
      this.health.completed();
      this.logger.info('episode_completed', {
        ...context,
        simulationStep: events.at(-1).payload.steps_completed - 1,
      });
      return true;
    } catch (error) {
      this.health.failed();
      const code = error.code || 'ENGINE_EXECUTION_FAILED';
      this.logger.error(code === 'ENGINE_TIMEOUT' ? 'episode_timeout' : 'episode_failed', { ...context, code, message: error.message });
      try {
        await this.repository.markFailed(episode, error);
      } catch (persistenceError) {
        this.logger.error('failure_status_persistence_failed', { ...context, message: persistenceError.message });
      }
      return true;
    }
  }
}

module.exports = { EpisodeWorker };
