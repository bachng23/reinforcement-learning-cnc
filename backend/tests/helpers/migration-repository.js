const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, tree } = require('../../../scripts/check-migration-history');

// Disposable Git history, never edits the application's business migrations.
function migrationRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-gate-test-'));
  const write = (name, text) => {
    const target = path.join(root, 'backend/prisma', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const commit = () => {
    git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Migration Test', '-c', 'user.email=migration@example.test',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test migration']);
    return git(root, ['rev-parse', 'HEAD']).toString().trim();
  };
  git(root, ['init', '-q']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write('schema.prisma', 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n');
  write('migrations/migration_lock.toml', 'provider = "postgresql"\n');
  write('migrations/20260101000000_initial/migration.sql', 'CREATE TABLE example (id INTEGER PRIMARY KEY, existing_column TEXT);\n');
  const base = commit();
  const history = () => {
    const candidateSha = git(root, ['rev-parse', 'HEAD']).toString().trim();
    return { root, baseSha: base, candidateSha,
      baseFiles: tree(root, base), candidateFiles: tree(root, candidateSha) };
  };
  return { root, base, write, commit, history,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
module.exports = { migrationRepository };
