const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { requireAuth, requireRole } = require('../middlewares/auth.middleware');
const { ApiError, fromZodError } = require('../lib/api-error');
const s = require('./service');
const demo = require('./demo-service');
const health = require('./demo-health');
const { bridge } = require('./bridge');
const { canonical, sha } = require('./artifact-store');
const router = express.Router();
const write = requireRole(['ADMIN', 'ENGINEER']);
const id = z.string().uuid();
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const integer = z.number().int().nonnegative();
const demoPolicy = z.enum(['S','A','F','risk','corrective','threshold5','wait']);
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const branch = z.object({ episode_id: id, tick: integer, action: z.array(z.tuple([integer, integer, integer])).max(3),
  reason: z.string().trim().min(1).max(1000), expected_episode_hash: z.string().regex(/^[a-f0-9]{64}$/),
  controller: z.enum(['threshold5', 'risk', 'corrective', 'wait']).default('risk') }).strict();
const parse = (schema, value) => { const r = schema.safeParse(value); if (!r.success) throw fromZodError(r.error); return r.data; };
const key = req => parse(identifier, req.get('Idempotency-Key'));
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const queued = (res, result) => { if (result.replayed) res.set('Idempotency-Replayed', 'true'); return ok(res, result.job, 202); };

router.use('/demo/sessions/:id/machines/:machineIndex/health', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use((req, _res, next) => { if (process.env.RESEARCH_API_ENABLED === 'false') return next(new ApiError(404, 'RESEARCH_DISABLED', 'Research API is disabled')); next(); });
router.use(requireAuth);
// Engineering simulation is isolated from immutable scientific campaign evidence.
router.post('/demo/sessions', write, async (req, res) => {
  const input = parse(z.object({case:z.enum(['base','generalist']).default('base'), seed:z.string().regex(/^99[0-9]{7}$/).default('990000001'), mode:z.enum(['incident','policy']).default('incident'), primary:demoPolicy.default('S'), baseline:demoPolicy.default('F'), continuous:z.boolean().default(true)}).strict().refine(v => v.primary !== v.baseline, 'Choose different comparison policies'), req.body);
  ok(res, await demo.create(req.user, input, key(req)), 201);
});
router.get('/demo/sessions/:id', async (req,res) => ok(res, demo.present(await demo.read(req.user, parse(id,req.params.id)))));
router.get('/demo/sessions/:id/machines/:machineIndex/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const query = parse(health.querySchema, req.query);
  const machineIndex = parse(health.machineIndexSchema, req.params.machineIndex);
  const row = await demo.read(req.user, parse(id, req.params.id));
  ok(res, health.projectHealth(row, machineIndex, query));
});
router.post('/demo/sessions/:id/commands', write, async (req,res) => {
  const shared = { revision: integer };
  const input = parse(z.discriminatedUnion('command', [
    z.object({...shared,command:z.literal('configure'),primary:demoPolicy,baseline:demoPolicy,continuous:z.literal(true)}).strict().refine(v => v.primary !== v.baseline, 'Choose different comparison policies'),
    z.object({...shared,command:z.literal('advance'),autoApprove:z.boolean().default(false)}).strict(),
    z.object({...shared,command:z.literal('autoplay'),stopAt:z.enum(['incident','review','dispatch','repair','complete']),maxTicks:z.number().int().min(1).max(8).default(8)}).strict(),
    z.object({...shared,command:z.literal('approve'),reason:z.string().trim().min(1).max(1000)}).strict(),
    z.object({...shared,command:z.literal('override'),action:z.array(z.tuple([integer,integer,integer])).max(3),reason:z.string().trim().min(1).max(1000)}).strict(),
  ]),req.body);
  ok(res,await demo.command(req.user,parse(id,req.params.id),input,key(req)));
});
router.get('/schema', (_req, res) => res.sendFile(require('node:path').resolve(__dirname, '../../../contracts/jcst/v1/jcst.schema.json')));
router.get('/openapi.yaml', (_req, res) => res.type('application/yaml').sendFile(require('node:path').resolve(__dirname, '../../research-openapi.yaml')));
router.get('/capabilities', async (_req, res) => ok(res, await bridge({ operation: 'capabilities' })));
router.get('/campaigns', async (req, res) => {
  const { page, limit } = parse(pagination, req.query); const where = s.scope(req.user);
  const [items, total] = await Promise.all([prisma.researchCampaign.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, include: { _count: { select: { runs: true } } } }), prisma.researchCampaign.count({ where })]);
  res.json({ success: true, data: items, meta: { page, limit, total } });
});
router.get('/campaigns/:id', async (req, res) => ok(res, await s.getCampaign(req.user, parse(id, req.params.id))));
router.post('/imports', write, async (req, res) => {
  const body = parse(z.object({ bundle: z.record(z.string(), z.unknown()) }).strict(), req.body);
  queued(res, await s.enqueueImport(req.user, body.bundle, key(req)));
});
router.get('/jobs', async (req, res) => {
  const { page, limit } = parse(pagination, req.query);
  ok(res, await prisma.researchJob.findMany({ where: s.scope(req.user), skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { reviews: true } }));
});
router.get('/jobs/:id', async (req, res) => ok(res, await s.getJob(req.user, parse(id, req.params.id))));
router.post('/jobs/:id/cancel', write, async (req, res) => {
  const job = await s.getJob(req.user, parse(id, req.params.id));
  await prisma.$transaction(async tx => {
    const result = await tx.researchJob.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } });
    if (!result.count) throw new ApiError(409, 'INVALID_JOB_TRANSITION', 'Only queued/running jobs can be cancelled');
    await tx.auditLog.create({data:{entityType:'SYSTEM',entityId:job.id,action:'RESEARCH_JOB_CANCELLED',actorUserId:req.user.id}});
  });
  ok(res, await s.getJob(req.user, job.id));
});
router.post('/jobs/:id/retry', write, async (req, res) => {
  const job = await s.getJob(req.user, parse(id, req.params.id));
  if (!['FAILED', 'CANCELLED'].includes(job.status)) throw new ApiError(409, 'INVALID_JOB_TRANSITION', 'Only failed/cancelled jobs can be retried');
  queued(res, await s.enqueue(req.user, job.kind, { ...job.inputJson, retryOf: job.id }, key(req)));
});
router.get('/episodes/:id', async (req, res) => ok(res, await s.getEpisode(req.user, parse(id, req.params.id))));
router.get('/episodes/:id/records', async (req, res) => {
  const row = await s.getEpisode(req.user, parse(id, req.params.id));
  const { page, limit } = parse(pagination, req.query); const episode = await s.store.json(row.contentHash);
  res.json({ success: true, data: { ...episode, records: episode.records.slice((page - 1) * limit, page * limit) }, meta: { page, limit, total: episode.records.length } });
});
router.get('/artifacts/:id', async (req, res) => {
  const row = await prisma.researchArtifact.findFirst({ where: { id: parse(id, req.params.id), run: s.campaignScope(req.user) } });
  if (!row) throw new ApiError(404, 'RESEARCH_NOT_FOUND', 'Artifact was not found');
  res.set('X-Content-SHA256', row.contentHash).type(row.mediaType).send(await s.store.get(row.contentHash));
});
router.post('/branches', write, async (req, res) => queued(res, await s.enqueueBranch(req.user, parse(branch, req.body), key(req))));
router.post('/inference', write, async (req, res) => queued(res, await s.enqueueInference(req.user, parse(z.object({ episode_id: id, tick: integer, release_id: identifier }).strict(), req.body), key(req))));
router.get('/jobs/:id/episode', async (req, res) => {
  const { variant } = parse(z.object({variant:z.enum(['branch','baseline']).default('branch')}).strict(),req.query);
  const job = await s.getJob(req.user, parse(id, req.params.id));
  if (job.kind !== 'BRANCH' || job.status !== 'SUCCEEDED') throw new ApiError(409, 'BRANCH_NOT_READY', 'Branch replay is unavailable');
  ok(res, await s.store.json(variant === 'baseline' ? job.outputJson.baselineEpisodeHash : job.outputJson.episodeHash));
});
router.post('/jobs/:id/review', write, async (req, res) => {
  const input = parse(z.object({ decision: z.enum(['ACCEPT', 'REJECT']), reason: z.string().trim().min(1).max(1000), expected_output_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), req.body);
  const job = await s.getJob(req.user, parse(id, req.params.id));
  if (job.kind !== 'BRANCH' || job.status !== 'SUCCEEDED' || sha(canonical(job.outputJson)) !== input.expected_output_hash) throw new ApiError(409, 'STALE_BRANCH_REVIEW', 'Completed branch output must match the review basis');
  const data = { jobId: job.id, actorId: req.user.id, decision: input.decision, reason: input.reason };
  const review = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM research_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
    const existing = await tx.researchReview.findUnique({where:{jobId:job.id}});
    if (existing) {
      if (existing.actorId !== data.actorId || existing.decision !== data.decision || existing.reason !== data.reason) throw new ApiError(409, 'REVIEW_CONFLICT', 'Branch already has a different immutable review');
      return {row:existing,replayed:true};
    }
    const row = await tx.researchReview.create({ data });
    await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: job.id, action: 'RESEARCH_BRANCH_REVIEW', actorUserId: req.user.id, payloadJson: { ...input, domain: 'SIMULATION_ONLY' } } });
    return {row,replayed:false};
  });
  ok(res, review.row, review.replayed ? 200 : 201);
});
module.exports = router;
