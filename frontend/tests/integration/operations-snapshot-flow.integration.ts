import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CurrentSchedule } from "@/components/pages/integrated-schedule-page";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import canonical from "../../../contracts/v3/fixtures/demo-health-alert.json";
import { createOperationsApiClient } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";

const backend = createRequire(new URL("../../../backend/package.json", import.meta.url));
const db = backend("./src/config/prisma");
const app = backend("./src/app");
const jwt = backend("jsonwebtoken");
const { loadCanonicalSeedPlan, contentHash } = backend("./src/services/operations-contract.service");
const { seedOperations } = backend("./src/services/operations-context.service");
const { resetDemoScope } = backend("./scripts/reset-operations");
const factoryId = canonical.factory_snapshot.factory_id;
const otherFactory = "factory-integration-preserve";

describe("canonical fixture → PostgreSQL → authenticated snapshot API → frontend client", () => {
  let server: Server;
  let plan: Awaited<ReturnType<typeof loadCanonicalSeedPlan>>;
  let client: ReturnType<typeof createOperationsApiClient>;
  let baseUrl: string;
  let userId: string;
  const reset = () => resetDemoScope(db, plan, { factoryId, databaseUrl: process.env.DATABASE_URL });
  const rows = async (scope = factoryId) => ({
    snapshots: await db.factorySnapshot.findMany({ where: { factoryId: scope } }),
    schedules: await db.operationSchedule.findMany({ where: { factoryId: scope } }),
    heads: await db.operationsHead.findMany({ where: { factoryId: scope } }),
  });

  beforeAll(async () => {
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
    if (!schema || !/^product_api_it_[a-zA-Z0-9_]+$/.test(schema)) throw new Error("Use backend npm run test:operations-flow to create an isolated test schema");
    plan = await loadCanonicalSeedPlan();
    const user = await db.user.create({ data: { username: `flow-${randomUUID()}`, passwordHash: "test-only", role: "ADMIN" } });
    userId = user.id;
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP listener");
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    client = createOperationsApiClient({ baseUrl, fetcher: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    } });
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
  });

  it("seeds twice without changing records, then reads identical mock and real HTTP DTOs", async () => {
    const first = await seedOperations(db, plan, { factoryId });
    const before = await rows();
    const second = await seedOperations(db, plan, { factoryId });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(await rows()).toEqual(before);
    expect(before.snapshots).toHaveLength(1);
    expect(before.schedules).toHaveLength(1);
    expect(before.heads).toHaveLength(1);
    expect(before.snapshots[0].payloadJson).toEqual(canonical.factory_snapshot);
    const mock = createMockOperationsApiClient();
    expect(await client.getOperationsSnapshot(factoryId)).toEqual(await mock.getOperationsSnapshot(factoryId));
    expect(await client.getCurrentSchedule(factoryId)).toEqual(await mock.getCurrentSchedule(factoryId));
  });

  it("propagates actual canonical HTTP authentication errors", async () => {
    const anonymous = createOperationsApiClient({ baseUrl, fetcher: fetch });
    for (const method of ["getOperationsSnapshot", "getCurrentSchedule"] as const) {
      await expect(anonymous[method](factoryId)).rejects.toMatchObject({ status: 401, contractError: { schema_version: "3.0", code: "UNAUTHORIZED", retryable: false } });
    }
  });

  it("reads persisted empty schedules and noncanonical data rather than fixture fallback", async () => {
    const snapshot = { ...structuredClone(canonical.factory_snapshot), factory_id: otherFactory, snapshot_id: "snapshot-preserve", current_schedule: null };
    await db.factorySnapshot.create({ data: { factoryId: otherFactory, snapshotId: snapshot.snapshot_id, schemaVersion: "3.0", contentHash: contentHash(snapshot), payloadJson: snapshot, capturedAt: new Date(snapshot.captured_at) } });
    await db.operationsHead.create({ data: { factoryId: otherFactory, snapshotId: snapshot.snapshot_id } });
    expect((await client.getOperationsSnapshot(otherFactory)).snapshot).toEqual(snapshot);
    expect(await client.getCurrentSchedule(otherFactory)).toMatchObject({ factory_id: otherFactory, schedule: null, plan_version: 0, commit: null });
  });

  it("rejects mismatched reset scopes and targets without changing records", async () => {
    const before = await rows();
    await expect(resetDemoScope(db, plan, { factoryId: otherFactory, databaseUrl: process.env.DATABASE_URL })).rejects.toThrow("canonical demo scope");
    const wrong = new URL(process.env.DATABASE_URL!);
    wrong.searchParams.set("schema", "public");
    await expect(resetDemoScope(db, plan, { factoryId, databaseUrl: wrong.toString() })).rejects.toThrow("explicitly selected");
    await expect(resetDemoScope(db, plan, { factoryId })).rejects.toThrow("explicit");
    expect(await rows()).toEqual(before);
  });

  it("rolls back reset and trigger changes on failure", async () => {
    const before = await rows();
    // A restrictive FK simulates a future descendant the reset adapter cannot
    // safely clean. It must fail atomically rather than delete around it.
    await db.$executeRawUnsafe('CREATE TABLE reset_blocker (factory_id TEXT, snapshot_id TEXT, FOREIGN KEY (factory_id, snapshot_id) REFERENCES factory_snapshots(factory_id, snapshot_id))');
    await db.$executeRaw`INSERT INTO reset_blocker VALUES (${factoryId}, ${canonical.factory_snapshot.snapshot_id})`;
    try {
      await expect(reset()).rejects.toThrow();
      expect(await rows()).toEqual(before);
      await expect(db.$executeRaw`UPDATE factory_snapshots SET content_hash = content_hash WHERE factory_id = ${factoryId}`).rejects.toThrow("immutable");
    } finally {
      await db.$executeRawUnsafe('DROP TABLE reset_blocker');
    }
  });

  it("resets only demo rows, preserves other factories/users, and supports repeat reset/reseed", async () => {
    const otherBefore = await rows(otherFactory);
    const userBefore = await db.user.findUnique({ where: { id: userId } });
    // Include a later immutable observation, not only IDs from the original plan.
    const fresh = { ...structuredClone(canonical.factory_snapshot), snapshot_id: "snapshot-demo-later" };
    await db.factorySnapshot.create({ data: { factoryId, snapshotId: fresh.snapshot_id, schemaVersion: "3.0", payloadJson: fresh, contentHash: contentHash(fresh), capturedAt: new Date(fresh.captured_at) } });
    expect(await reset()).toEqual({ factory_id: factoryId, deleted: { heads: 1, schedules: 1, snapshots: 2 } });
    expect(await rows()).toEqual({ snapshots: [], schedules: [], heads: [] });
    expect(await rows(otherFactory)).toEqual(otherBefore);
    expect(await db.user.findUnique({ where: { id: userId } })).toEqual(userBefore);
    await expect(client.getOperationsSnapshot(factoryId)).rejects.toMatchObject({ status: 404 });
    expect((await reset()).deleted).toEqual({ heads: 0, schedules: 0, snapshots: 0 });
    await seedOperations(db, plan, { factoryId });
    expect((await client.getOperationsSnapshot(factoryId)).snapshot).toEqual(canonical.factory_snapshot);
    for (const table of ["factory_snapshots", "operation_schedules"]) {
      await expect(db.$executeRawUnsafe(`UPDATE ${table} SET content_hash = content_hash WHERE factory_id = $1`, factoryId)).rejects.toThrow("immutable");
    }
  });

  it("renders P1 with immutable S1 after ingesting changed resources in S2", async () => {
    const snapshotResponse = await client.getOperationsSnapshot(factoryId);
    const scheduleResponse = await client.getCurrentSchedule(factoryId);
    const oldHead = await db.operationsHead.findUnique({ where: { factoryId } });
    const published = scheduleResponse.schedule!;
    expect((published.assignments ?? []).some(a => a.machine_id === snapshotResponse.snapshot.machines[0].machine_id)).toBe(true);
    const projection = (data: Parameters<typeof CurrentSchedule>[0]["data"]) => {
      const html = renderToStaticMarkup(createElement(CurrentSchedule, { data }));
      return html.slice(html.indexOf('Schedule filters'));
    };
    const before = projection({ snapshotResponse, scheduleResponse });
    const next = structuredClone(snapshotResponse.snapshot);
    next.snapshot_id = "snapshot-resource-changes";
    next.current_schedule = null;
    next.technicians = [];
    next.machines.forEach(m => { m.display_name = "Changed in S2"; });
    (next.jobs ?? []).forEach(j => { j.priority = 99; j.operations.forEach(o => { o.predecessor_operation_ids = []; }); });
    const { ingestFactorySnapshot } = backend("./src/services/operations-snapshot.service");
    await ingestFactorySnapshot({ factoryId, expectedHeadRevision: oldHead.revision, snapshot: next, sourceId: "gantt-regression" }, db);
    const currentSnapshot = await client.getOperationsSnapshot(factoryId);
    const currentSchedule = await client.getCurrentSchedule(factoryId);
    expect(currentSnapshot.snapshot.technicians).toEqual([]);
    expect(currentSchedule.snapshot_id).toBe(next.snapshot_id);
    expect(currentSchedule.basis_snapshot).toEqual(snapshotResponse.snapshot);
    expect(currentSchedule.schedule).toEqual(published);
    const after = projection({ snapshotResponse: currentSnapshot, scheduleResponse: currentSchedule });
    expect(after).toBe(before);
    for (const tech of snapshotResponse.snapshot.technicians ?? []) expect(after).toContain(tech.technician_id + " lane");
    expect(after).not.toContain("Changed in S2");
    expect(after).not.toContain("priority 99");
  });
});
