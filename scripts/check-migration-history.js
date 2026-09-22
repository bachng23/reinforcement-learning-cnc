const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const migrationRoot = 'backend/prisma/migrations/';
function git(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

function resolveCommit(root, ref) {
  if (!/^(?:HEAD|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(ref || '')) {
    throw new Error('Supply MIGRATION_BASE_SHA as a full commit SHA (PR: github.event.pull_request.base.sha)');
  }
  try { return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim(); }
  catch { throw new Error(`Migration commit ${ref} is unavailable; fetch base history (checkout fetch-depth: 0)`); }
}

function tree(root, sha) {
  return git(root, ['ls-tree', '-r', '-z', sha, '--', 'backend/prisma/schema.prisma', migrationRoot])
    .toString().split('\0').filter(Boolean).map(record => {
      const [metadata, name] = record.split('\t');
      const [mode, type, oid] = metadata.split(' ');
      return { mode, type, oid, name };
    });
}

function checkHistory({ root = repoRoot, base = process.env.MIGRATION_BASE_SHA, candidate = 'HEAD' } = {}) {
  // HEAD is only a candidate default, never an implicit base/fallback.
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(base || '')) resolveCommit(root, undefined);
  const baseSha = resolveCommit(root, base);
  const candidateSha = resolveCommit(root, candidate);
  const baseFiles = tree(root, baseSha);
  const candidateFiles = tree(root, candidateSha);
  const current = new Map(candidateFiles.map(file => [file.name, file]));
  const previousMigrations = baseFiles.filter(file => file.name.startsWith(migrationRoot));
  const existingDirectories = new Set(previousMigrations.map(file => path.posix.dirname(file.name)));
  const changed = previousMigrations.filter(file => {
    const next = current.get(file.name);
    return !next || next.oid !== file.oid || next.mode !== file.mode;
  }).map(file => `${current.has(file.name) ? 'modified' : 'deleted'}: ${file.name}`);
  const previousNames = new Set(previousMigrations.map(file => file.name));
  for (const file of candidateFiles) {
    if (file.name.startsWith(migrationRoot) && !previousNames.has(file.name)
        && existingDirectories.has(path.posix.dirname(file.name))) {
      changed.push(`added inside existing migration: ${file.name}`);
    }
  }
  if (changed.length) {
    throw new Error(`Existing migrations on base ${baseSha} are immutable:\n${changed.join('\n')}\nAdd a new migration directory instead.`);
  }
  for (const [label, files] of [['base', baseFiles], ['candidate', candidateFiles]]) {
    if (!files.some(file => file.name === 'backend/prisma/schema.prisma')
        || !files.some(file => file.name.endsWith('/migration.sql'))) {
      throw new Error(`${label} must contain a Prisma schema and migration history`);
    }
    if (files.some(file => file.type !== 'blob' || !['100644', '100755'].includes(file.mode))) {
      throw new Error(`${label} Prisma files must be regular files, not symlinks/submodules`);
    }
  }
  return { root, baseSha, candidateSha, baseFiles, candidateFiles };
}

if (require.main === module) {
  try {
    const result = checkHistory();
    console.log(`[migration history] PASS: existing migrations unchanged from ${result.baseSha}`);
  } catch (error) { console.error(`[migration history] ${error.message}`); process.exitCode = 1; }
}
module.exports = { checkHistory, git, tree, repoRoot };
