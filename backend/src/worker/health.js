class WorkerHealth {
  constructor() {
    this.startedAt = new Date();
    this.lastPollAt = null;
    this.lastCompletedAt = null;
    this.lastErrorAt = null;
    this.state = 'STARTING';
  }
  polling() { this.state = 'HEALTHY'; this.lastPollAt = new Date(); }
  completed() { this.state = 'HEALTHY'; this.lastCompletedAt = new Date(); }
  failed() { this.state = 'DEGRADED'; this.lastErrorAt = new Date(); }
  snapshot() {
    return {
      state: this.state,
      startedAt: this.startedAt.toISOString(),
      lastPollAt: this.lastPollAt?.toISOString() || null,
      lastCompletedAt: this.lastCompletedAt?.toISOString() || null,
      lastErrorAt: this.lastErrorAt?.toISOString() || null,
    };
  }
}

module.exports = { WorkerHealth };
