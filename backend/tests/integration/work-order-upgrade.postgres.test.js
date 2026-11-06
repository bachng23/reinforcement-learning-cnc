const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const {
  loadCanonicalSeedPlan,
  validatePayload,
  contentHash,
} = require('../../src/services/operations-contract.service');
const baseline = 'f8d94837159ca5fdc1a0f159fc8c28f75e394f7f';
const root = path.resolve(__dirname, '../..'),
  repo = path.dirname(root),
  migration = '20261022010000_maintenance_work_orders';
const git = (...args) =>
  execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), ...args], { cwd: repo });
test('exact-base populated work-order upgrade preserves publications, history, users and memberships', async () => {
  const schema = 'work_order_upgrade_' + randomUUID().replaceAll('-', ''),
    url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } }),
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-order-upgrade-'));
  const deploy = () =>
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        path.join(temp, 'schema.prisma'),
      ],
      { cwd: temp, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
    );
  try {
    const files = git('ls-tree', '-r', '--name-only', baseline, '--', 'backend/prisma')
      .toString()
      .trim()
      .split('\n')
      .filter((f) => f.endsWith('schema.prisma') || f.includes('/migrations/'));
    for (const f of files) {
      const out = path.join(temp, f.replace('backend/prisma/', ''));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, git('show', baseline + ':' + f));
    }
    deploy();
    const seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    const f = 'historical-with-head',
      h = 'historical-no-head';
    const admin = await db.user.create({
      data: { username: randomUUID(), passwordHash: 'upgrade-test', role: 'ADMIN' },
    });
    const member = await db.user.create({
      data: { username: randomUUID(), passwordHash: 'upgrade-test', role: 'OPERATOR' },
    });
    for (const factoryId of [f, h]) {
      await db.factory.create({ data: { factoryId, name: factoryId } });
      await db.factoryMembership.create({
        data: { factoryId, userId: member.id, grantedBy: admin.id, grantSource: 'http' },
      });
      await db.auditLog.create({
        data: {
          entityType: 'SYSTEM',
          entityId: factoryId,
          factoryId,
          actorUserId: admin.id,
          action: 'FACTORY_ACCESS_GRANTED',
          payloadJson: { user_id: member.id },
        },
      });
    }
    await db.factoryMembership.update({
      where: { factoryId_userId: { factoryId: h, userId: member.id } },
      data: { active: false, revokedBy: admin.id, revokedAt: new Date() },
    });
    for (const factoryId of [f, h])
      for (const snapshotId of ['S1', 'S2']) {
        const p = { ...structuredClone(seed), factory_id: factoryId, snapshot_id: snapshotId };
        p.current_schedule.factory_id = factoryId;
        await db.factorySnapshot.create({
          data: {
            factoryId,
            snapshotId,
            schemaVersion: '3.0',
            contentHash: contentHash(p),
            payloadJson: p,
            capturedAt: new Date(p.captured_at),
          },
        });
      }
    const schedule = { ...seed.current_schedule, factory_id: f };
    await db.operationSchedule.create({
      data: {
        factoryId: f,
        snapshotId: 'S1',
        scheduleId: schedule.schedule_id,
        revision: schedule.revision,
        schemaVersion: '3.0',
        contentHash: contentHash(schedule),
        payloadJson: schedule,
      },
    });
    await db.operationsHead.create({
      data: {
        factoryId: f,
        snapshotId: 'S1',
        scheduleId: schedule.schedule_id,
        scheduleRevision: schedule.revision,
        planVersion: 6,
        revision: 7,
      },
    });
    const actor = admin.id,
      caseId = randomUUID();
    await db.decisionCase.create({
      data: {
        id: caseId,
        factoryId: f,
        snapshotId: 'S1',
        basePlanVersion: 6,
        mode: 'LIVE',
        status: 'AWAITING_APPROVAL',
        processingStatus: 'SUCCEEDED',
        actorId: actor,
        requestJson: { original: true },
        requestHash: contentHash({ original: true }),
      },
    });
    const candidate = {
      ...structuredClone(require('../../../contracts/v3/examples/demo-scenario.json').candidate_plans[0]),
      decision_case_id: caseId,
      snapshot_id: 'S1',
      schedule,
    };
    const recommendation = {
      schema_version: '3.0',
      recommendation_id: 'historical-rec',
      decision_case_id: caseId,
      snapshot_id: 'S1',
      generated_at: candidate.generated_at,
      recommended_plan_id: candidate.candidate_plan_id,
      candidate_plans: [candidate],
      explanation: {
        summary: 'Historical',
        primary_reasons: ['Feasible'],
        tradeoffs: ['No change'],
        residual_risks: [],
        evidence_refs: ['S1'],
      },
    };
    await db.decisionRecommendationArtifact.create({
      data: {
        caseId,
        recommendationId: recommendation.recommendation_id,
        snapshotId: 'S1',
        schemaVersion: '3.0',
        contentHash: contentHash(recommendation),
        payloadJson: recommendation,
        generatedAt: new Date(candidate.generated_at),
      },
    });
    await db.decisionHumanRecord.create({
      data: {
        caseId,
        decision: 'APPROVE',
        recommendationId: recommendation.recommendation_id,
        candidateId: candidate.candidate_plan_id,
        candidateVersion: candidate.plan_version,
        candidateHash: contentHash(candidate),
        scheduleHash: contentHash(schedule),
        actorId: actor,
      },
    });
    await db.decisionCase.update({
      where: { id: caseId },
      data: { status: 'APPROVED', revision: { increment: 1 } },
    });
    await db.decisionCommit.create({
      data: {
        caseId,
        factoryId: f,
        snapshotId: 'S1',
        scheduleId: schedule.schedule_id,
        scheduleRevision: schedule.revision,
        scheduleHash: contentHash(schedule),
        planVersion: 7,
        actorId: actor,
      },
    });
    await db.operationsHead.update({
      where: { factoryId: f },
      data: { planVersion: 7, revision: { increment: 1 } },
    });
    await db.decisionCase.update({
      where: { id: caseId },
      data: { status: 'COMMITTED', revision: { increment: 1 } },
    });
    await db.operationsHead.update({
      where: { factoryId: f },
      data: { snapshotId: 'S2', revision: { increment: 1 } },
    });
    await db.decisionCaseEvent.create({
      data: {
        caseId,
        sequence: 1,
        type: 'CASE_STATUS_CHANGED',
        actorId: actor,
        payloadJson: { historical: true },
      },
    });
    await db.decisionCaseIdempotencyReceipt.create({
      data: {
        caseId,
        factoryId: f,
        actorId: actor,
        key: 'historical-key',
        requestHash: contentHash({}),
        responseJson: { historical: true },
      },
    });
    const tables = [
      'users',
      'factories',
      'factory_memberships',
      'audit_logs',
      'factory_snapshots',
      'operations_heads',
      'operation_schedules',
      'decision_cases',
      'decision_commits',
      'decision_human_records',
      'decision_recommendation_artifacts',
      'decision_case_events',
      'decision_case_idempotency_receipts',
    ];
    const dump = async () =>
      Promise.all(tables.map((t) => db.$queryRawUnsafe('SELECT * FROM ' + t + ' ORDER BY 1,2')));
    const before = await dump();
    const checksums =
      await db.$queryRaw`SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name`;
    await db.$disconnect();
    for (const name of [migration, '20261024010000_work_order_cancelled_source_guard']) {
      fs.cpSync(path.join(root, 'prisma/migrations', name), path.join(temp, 'migrations', name), {
        recursive: true,
      });
    }
    fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(temp, 'schema.prisma'));
    deploy();
    deploy();
    expect(await dump()).toEqual(before);
    expect(
      (await db.factory.findMany({ orderBy: { factoryId: 'asc' } })).map((r) => ({
        id: r.factoryId,
        name: r.name,
      })),
    ).toEqual([
      { id: h, name: h },
      { id: f, name: f },
    ]);
    expect(await db.factoryMembership.count()).toBe(2);
    expect(await db.workOrder.count()).toBe(0);
    const constraints =
      await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid='work_orders'::regclass AND contype='f' AND convalidated`;
    expect(constraints.length).toBeGreaterThanOrEqual(4);
    const after =
      await db.$queryRaw`SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name`;
    expect(after.slice(0, checksums.length)).toEqual(checksums);
    await expect(db.factory.delete({ where: { factoryId: h } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.decisionCaseIdempotencyReceipt.create({
        data: {
          caseId,
          factoryId: h,
          actorId: actor,
          key: 'cross-scope',
          requestHash: contentHash({}),
          responseJson: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  } finally {
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await db.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}, 120000);
