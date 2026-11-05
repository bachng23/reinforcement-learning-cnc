const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { accessError } = require('../../services/factory-access.service');
const policy = require('../../services/scenario-policy');
const service = require('../../services/scenario-workspace.service');
const jobs = require('../../services/scenario-job.service');
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(requireAuth);
router.get('/', async (req, res) => res.json(await service.list(db, req.user, req.query)));
router.get('/:workspace_id', async (req, res) => {
  policy.parse(policy.empty, req.query);
  res.json(await service.get(db, req.user, req.params.workspace_id));
});
router.get('/:workspace_id/scenarios', async (req, res) => res.json(await service.list(db, req.user, req.query, req.params.workspace_id)));
router.get('/:workspace_id/baseline-entities', async (req, res) => {
  policy.parse(policy.empty, req.query);
  res.json(await service.baselineEntities(db, req.user, req.params.workspace_id));
});
router.get('/:workspace_id/scenarios/:scenario_id', async (req, res) => {
  policy.parse(policy.empty, req.query);
  res.json(await service.get(db, req.user, req.params.workspace_id, req.params.scenario_id));
});
router.get('/:workspace_id/runs', async (req, res) => res.json(await jobs.list(db, req.user, req.params.workspace_id, req.query)));
router.get('/:workspace_id/runs/:run_id', async (req, res) => {
  policy.parse(policy.empty, req.query);
  res.json(await jobs.get(db, req.user, req.params.workspace_id, req.params.run_id));
});
router.get('/:workspace_id/sensitivity-jobs', async (req, res) => res.json(await jobs.list(db, req.user, req.params.workspace_id, req.query, 'SENSITIVITY')));
router.get('/:workspace_id/sensitivity-jobs/:job_id', async (req, res) => {
  policy.parse(policy.empty, req.query);
  res.json(await jobs.get(db, req.user, req.params.workspace_id, req.params.job_id, 'SENSITIVITY'));
});
router.get('/:workspace_id/compare', async (req, res) => {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', abort);
  try { res.json(await jobs.compare(db, req.user, req.params.workspace_id, req.query, { signal: controller.signal })); }
  finally { res.removeListener('close', abort); }
});
for (const [method, path, command] of [['post', '/', 'create'], ['post', '/:workspace_id/scenarios', 'createDraft'],
  ['patch', '/:workspace_id/scenarios/:scenario_id', 'updateDraft'], ['post', '/:workspace_id/runs', 'enqueueRun'],
  ['post', '/:workspace_id/sensitivity-jobs', 'enqueueSensitivity'],
  ['post', '/:workspace_id/live-evaluations', 'liveEvaluation']]) {
  router[method](path, async (req, res) => {
    policy.parse(policy.empty, req.query);
    const result = await service.write(db, req.user, command, req.params.workspace_id, req.body, req.get('Idempotency-Key'), req.params.scenario_id);
    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  });
}
router.use((raw, req, res, _next) => {
  const error = accessError(raw), known = { UNAUTHORIZED: 401, FORBIDDEN: 403, DB_UNAVAILABLE: 503 };
  const status = error.statusCode ?? known[error.message] ?? 500;
  res.status(status).json({ success: false, error: { code: error.statusCode ? error.code : known[error.message] ? error.message : 'SCENARIO_INTERNAL_ERROR',
    message: status >= 500 ? 'Scenario service is unavailable' : error.statusCode ? error.message : 'Authentication or permission is required' }, requestId: req.requestId });
});
module.exports = router;
