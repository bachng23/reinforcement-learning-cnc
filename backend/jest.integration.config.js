module.exports = {
  testEnvironment: 'node',
  // Avoid Windows path escaping in <rootDir> when checkout lives in .worktrees.
  testMatch: ['**/tests/integration/**/*.test.js'],
  testTimeout: 30_000,
  maxWorkers: 1,
};
