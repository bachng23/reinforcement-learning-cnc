const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const { ApiError } = require('../lib/api-error');
const { artifactStore, canonical, sha } = require('./artifact-store');
const { bridge } = require('./bridge');

const scope = user => user.role === 'ADMIN' ? {} : { ownerId: user.id };
const campaignScope = user => ({ campaign: scope(user) });
const notFound = () => new ApiError(404, 'RESEARCH_NOT_FOUND', 'Research resource was not found');
const store = artifactStore();

async function getCampaign(user, id) {
  const row = await prisma.researchCampaign.findFirst({ where: { id, ...scope(user) }, include: {
    runs: { orderBy: { createdAt: 'desc' }, include: { episodes: true, artifacts: true } },
  } });
  if (!row) throw notFound(); return row;
}
async function getEpisode(user, id) {
  const row = await prisma.researchEpisode.findFirst({ where: { id, run: campaignScope(user) } });
  if (!row) throw notFound(); return row;
}
async function getJob(user, id) {
  const row = await prisma.researchJob.findFirst({ where: { id, ...scope(user) }, include: { reviews: true } });
  if (!row) throw notFound(); return row;
}
async function enqueue(user, kind, inputJson, key) {
  const inputHash = sha(canonical({ kind, inputJson }));
  const where = { ownerId_idempotencyKey: { ownerId: user.id, idempotencyKey: key } };
  const existing = await prisma.researchJob.findUnique({ where });
  if (existing) {
    if (existing.inputHash !== inputHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key belongs to a different research request');
    return { job: existing, replayed: true };
  }
  try {
    const predecessor = inputJson.retryOf ? await prisma.researchJob.findFirst({ where: { id: inputJson.retryOf, ...scope(user) } }) : null;
    const job = await prisma.$transaction(async tx => {
      const row = await tx.researchJob.create({ data: { kind, inputJson, inputHash, ownerId: user.id, idempotencyKey: key, attempt: predecessor ? predecessor.attempt + 1 : 1 } });
      await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: row.id, action: `RESEARCH_${kind}_QUEUED`, actorUserId: user.id, payloadJson: { inputHash } } });
      return row;
    });
    return { job, replayed: false };
  } catch (error) {
    if (error.code === 'P2002') return enqueue(user, kind, inputJson, key);
    throw error;
  }
}
async function enqueueImport(user, bundle, key) {
  const bytes = canonical(bundle);
  if (Buffer.byteLength(bytes) > 8_000_000) throw new ApiError(413, 'BUNDLE_TOO_LARGE', 'Bundle exceeds 8 MB; import a bounded trace subset');
  const bundleHash = await store.put(bytes);
  return enqueue(user, 'IMPORT', { bundleHash }, key);
}
async function enqueueBranch(user, input, key) {
  const row = await getEpisode(user, input.episode_id);
  if (row.contentHash !== input.expected_episode_hash) throw new ApiError(409, 'STALE_EPISODE', 'Episode basis hash does not match');
  if (input.tick >= row.horizon) throw new ApiError(400, 'INVALID_OVERRIDE_TICK', 'Override must be inside the controlled horizon');
  return enqueue(user, 'BRANCH', { ...input, episodeHash: row.contentHash }, key);
}
async function enqueueInference(user, input, key) {
  const row = await getEpisode(user, input.episode_id);
  if (input.tick >= row.horizon) throw new ApiError(400, 'INVALID_INFERENCE_TICK', 'Tick must be inside the controlled horizon');
  return enqueue(user, 'INFER', { ...input, episodeHash: row.contentHash }, key);
}

async function publishImport(tx, job, verified) {
  const b = verified.bundle;
  // Serialize publication of the same campaign across worker processes.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${job.ownerId + ':' + b.campaign_key}, 0))::text`;
  let campaign = await tx.researchCampaign.findUnique({ where: { ownerId_campaignKey: { ownerId: job.ownerId, campaignKey: b.campaign_key } } });
  if (campaign && (campaign.title !== b.title || campaign.objective !== b.objective)) throw new ApiError(409, 'CAMPAIGN_CONFLICT', 'Campaign metadata differs; use a new campaign key');
  if (!campaign) campaign = await tx.researchCampaign.create({ data: { ownerId: job.ownerId, campaignKey: b.campaign_key, title: b.title, objective: b.objective } });
  const identity = { campaignId_studyKey_runKey: { campaignId: campaign.id, studyKey: b.study_key, runKey: b.run_key } };
  const existing = await tx.researchRun.findUnique({ where: identity });
  if (existing) {
    if (existing.bundleHash !== job.inputJson.bundleHash) throw new ApiError(409, 'RUN_IDENTITY_CONFLICT', 'Run identity belongs to different bytes');
    return { campaignId: campaign.id, runId: existing.id, duplicate: true };
  }
  const { artifacts, episodes, ...metadataJson } = b;
  const run = await tx.researchRun.create({ data: { campaignId: campaign.id, studyKey: b.study_key, runKey: b.run_key,
    origin: b.origin, bundleHash: job.inputJson.bundleHash, metadataJson, physicalReplayJson: verified.physical_replay } });
  for (const a of artifacts) {
    const bytes = Buffer.from(a.content, 'utf8');
    await tx.researchArtifact.create({ data: { runId: run.id, artifactKey: a.artifact_id, contentHash: a.sha256, mediaType: a.media_type, byteLength: bytes.length } });
  }
  for (const e of episodes) {
    const contentHash = sha(canonical(e));
    await tx.researchEpisode.create({ data: { runId: run.id, episodeKey: e.episode_id, caseId: e.case_id, controller: e.controller,
      physicalSeed: e.physical_seed, horizon: e.horizon, tail: e.tail, controlledCost: e.controlled_cost, tailCost: e.tail_cost, totalCost: e.total_cost, contentHash } });
  }
  return { campaignId: campaign.id, runId: run.id, duplicate: false };
}

async function workOnce({ execute = bridge, signal } = {}) {
  const now = new Date();
  await prisma.researchJob.updateMany({ where: { status: 'RUNNING', leaseExpiresAt: { lte: now } }, data: {
    status: 'FAILED', errorCode: 'WORKER_LEASE_EXPIRED', completedAt: now, leaseToken: null, leaseExpiresAt: null,
  } });
  const candidate = await prisma.researchJob.findFirst({ where: { status: 'QUEUED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!candidate) return false;
  const token = crypto.randomUUID(); const duration = 120000;
  const claimed = await prisma.researchJob.updateMany({ where: { id: candidate.id, status: 'QUEUED' }, data: {
    status: 'RUNNING', leaseToken: token, leaseExpiresAt: new Date(Date.now() + duration),
  } });
  if (!claimed.count) return true;
  const guard = () => ({ id: candidate.id, status: 'RUNNING', leaseToken: token, leaseExpiresAt: { gt: new Date() } });
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  let renewing = Promise.resolve();
  const heartbeat = setInterval(() => {
    renewing = renewing.then(async () => {
      const result = await prisma.researchJob.updateMany({ where: guard(), data: { leaseExpiresAt: new Date(Date.now() + duration) } });
      if (!result.count) controller.abort();
    }).catch(() => controller.abort());
  }, 1000);
  try {
    const input = candidate.inputJson; let output; let verified;
    if (candidate.kind === 'IMPORT') {
      const bundle = await store.json(input.bundleHash);
      verified = await execute({ operation: 'validate', bundle }, { signal: controller.signal });
      for (const a of verified.bundle.artifacts) await store.put(a.content);
      for (const e of verified.bundle.episodes) await store.put(canonical(e));
    } else if (candidate.kind === 'BRANCH') {
      const source = await store.json(input.episodeHash);
      const result = await execute({ operation: 'branch', episode: source, tick: input.tick, action: input.action, controller: input.controller }, { signal: controller.signal });
      const episodeHash = await store.put(canonical(result.episode));
      const baselineEpisodeHash = await store.put(canonical(result.baseline));
      output = { episodeHash, sourceEpisodeId: input.episode_id, sourceEpisodeHash: input.episodeHash,
        baselineEpisodeHash, baselineController: input.controller, sourceRecordedTotalCost: source.total_cost,
        baselineTotalCost: result.baseline.total_cost, branchTotalCost: result.episode.total_cost,
        deltaTotalCost: result.episode.total_cost - result.baseline.total_cost, audit: result.audit, baselineAudit: result.baseline_audit,
        note: 'Matched baseline and override use the same copied state, continuation controller and physical noise. Single paired seed; no confidence interval or operational execution.' };
    } else if (candidate.kind === 'INFER') {
      const source = await store.json(input.episodeHash);
      output = await execute({ operation: 'infer', config: source.config, state: source.records[input.tick].before,
        horizon: source.horizon, tail: source.tail, release_id: input.release_id }, { signal: controller.signal });
    } else throw new ApiError(400, 'UNSUPPORTED_JOB_KIND', 'Unsupported research job');
    clearInterval(heartbeat); await renewing;
    await prisma.$transaction(async tx => {
      const fenced = await tx.researchJob.updateMany({ where: guard(), data: { leaseExpiresAt: new Date(Date.now() + duration) } });
      if (!fenced.count) throw new ApiError(409, 'LEASE_LOST', 'Research worker no longer owns this job');
      if (verified) output = await publishImport(tx, candidate, verified);
      await tx.researchJob.update({ where: { id: candidate.id }, data: { status: 'SUCCEEDED', outputJson: output, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } });
      await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: candidate.id, action: `RESEARCH_${candidate.kind}_SUCCEEDED`, actorUserId: candidate.ownerId, payloadJson: output } });
    });
  } catch (error) {
    clearInterval(heartbeat); await renewing;
    await prisma.researchJob.updateMany({ where: guard(), data: { status: controller.signal.aborted ? 'CANCELLED' : 'FAILED',
      errorCode: error instanceof ApiError ? error.code : 'RESEARCH_PROCESSING_FAILED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } });
  } finally { clearInterval(heartbeat); signal?.removeEventListener('abort', abort); }
  return true;
}

module.exports = { scope, campaignScope, store, getCampaign, getEpisode, getJob, enqueue, enqueueImport, enqueueBranch, enqueueInference, workOnce };
