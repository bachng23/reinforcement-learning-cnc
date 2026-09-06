const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../prisma/migrations/20260902090000_execution_api_foundation/migration.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

describe('Week 1 execution migration contract', () => {
  test('is recoverable as one PostgreSQL transaction', () => {
    expect(migration.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  test('contains idempotency, worker-claim, retry-history, and summary constraints', () => {
    expect(migration).toContain('experiments_created_by_id_run_idempotency_key_key');
    expect(migration).toContain('episodes_status_queued_at_idx');
    expect(migration).toContain('fleet_observations_episode_id_attempt_step_key');
    expect(migration).toContain('episode_summaries_episode_id_attempt_key');
    expect(migration).toContain('episodes_experiment_policy_consistent_fkey');
  });

  test('enforces lifecycle transitions for external workers', () => {
    expect(migration).toContain('episodes_status_transition_guard');
    expect(migration).toContain('Invalid episode status transition');
    expect(migration).toContain('episodes_sync_experiment_status');
  });

  test('protects populated legacy experiments from duplicate execution', () => {
    expect(migration).toContain("'legacy:' || experiment.\"id\"::TEXT");
    expect(migration).toContain(
      'Cannot migrate experiments containing episodes from multiple policies',
    );
  });
});
