const { randomUUID } = require('node:crypto');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { fixture } = require('../helpers/work-order-fixtures');
let f;
const oldMode = process.env.FACTORY_ACCESS_SOURCE;
beforeAll(async () => { process.env.FACTORY_ACCESS_SOURCE = 'database'; f = await fixture(db, app); }, 30000);
afterAll(async () => {
  await f?.close(); await db.$disconnect();
  if (oldMode === undefined) delete process.env.FACTORY_ACCESS_SOURCE; else process.env.FACTORY_ACCESS_SOURCE = oldMode;
});
const data = r => { expect(r.status).toBe(200); return r.body.data; };
const command = (row, command, fields = {}, user = f.users.MANAGER, key = randomUUID()) =>
  f.http('/incidents/' + row.id + '/commands', { method: 'POST', user, key,
    body: { command, expected_revision: row.revision, ...fields } });
async function setup() {
  // Contract-shaped recommendation here tests transactional producer integration;
  // real planner evidence is supplied separately by the Chromium suite.
  const publication = await f.publish(await f.factory());
  const createdOrder = await f.create(publication); expect(createdOrder.status).toBe(201);
  const created = await f.http('/incidents', { method: 'POST', body: {
    factory_id: publication.body.factory_id, source: { type: 'manual', source_event_id: randomUUID() },
    title: 'Linked verification', description: 'Human inspection', category: 'EQUIPMENT', severity: 'WARNING',
    machine: { machine_id: createdOrder.body.data.machine_id, basis_snapshot_id: publication.snapshot.snapshot_id },
  } });
  expect(created.status).toBe(201);
  let row = created.body.data.incident;
  row = data(await command(row, 'ASSIGN', { owner_user_id: f.users.MANAGER.id })).incident;
  row = data(await command(row, 'ACKNOWLEDGE')).incident;
  row = data(await command(row, 'START_INVESTIGATION')).incident;
  return { row, order: createdOrder.body.data, publication };
}
const link = (row, target, key = randomUUID()) => f.http('/incidents/' + row.id + '/links',
  { method: 'POST', key, body: { expected_revision: row.revision, target } });
const resolution = { code: 'FIXED', summary: 'Reviewed', evidence: 'Recorded inspection' };

test('real Work Order overrides are explicit and audited; unlink keeps history and never changes producer state', async () => {
  let { row, order } = await setup();
  const target = { type: 'work_order', id: order.id };
  let response = data(await link(row, target)); row = response.incident;
  expect(response.work_orders[0]).toMatchObject({ id: order.id, status: 'UNASSIGNED' });
  const before = await db.workOrder.findUnique({ where: { id: order.id } });
  expect(await command(row, 'MARK_RESOLVED', { resolution })).toMatchObject({ status: 409, body: { error: { code: 'INCIDENT_WORK_ORDER_ACTIVE' } } });
  row = data(await command(row, 'MARK_RESOLVED', { resolution, work_order_override_reason: 'Manager accepts documented nonterminal risk' })).incident;
  expect(await command(row, 'CLOSE', { verification: { resolution_code: 'FIXED', note: 'Independent review' } }, f.users.ADMIN))
    .toMatchObject({ status: 409, body: { error: { code: 'INCIDENT_WORK_ORDER_ACTIVE' } } });
  row = data(await command(row, 'CLOSE', { verification: { resolution_code: 'FIXED', note: 'Independent review' },
    work_order_override_reason: 'Independent manager authorizes closure with order still active' }, f.users.ADMIN)).incident;
  expect(row.status).toBe('CLOSED');
  const events = data(await f.http('/incidents/' + row.id + '/events'));
  expect(events.find(e => e.command === 'MARK_RESOLVED').payload.work_order_override_reason).toBeTruthy();
  expect(events.find(e => e.command === 'CLOSE').payload.work_order_override_reason).toBeTruthy();
  const linkId = response.links[0].id;
  response = data(await f.http('/incidents/' + row.id + '/links/' + linkId, { method: 'DELETE',
    body: { expected_revision: row.revision, reason: 'Association no longer required; retain audit' } }));
  expect(response.links).toHaveLength(0);
  const retained = await db.incidentWorkOrderLink.findUnique({ where: { id: linkId } });
  expect(retained.removalReason).toBe('Association no longer required; retain audit');
  expect(retained.removedAt).toBeInstanceOf(Date);
  expect(await db.workOrder.findUnique({ where: { id: order.id } })).toEqual(before);
}, 60000);

test('duplicate/concurrent links have one winner and cross-factory targets fail closed', async () => {
  let { row, order, publication } = await setup();
  const responses = await Promise.all([link(row, { type: 'work_order', id: order.id }), link(row, { type: 'work_order', id: order.id })]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  row = responses.find(r => r.status === 200).body.data.incident;
  const eventCount = await db.incidentEvent.count({ where: { incidentId: row.id } });
  const duplicate = data(await link(row, { type: 'work_order', id: order.id }));
  expect(duplicate.incident.revision).toBe(row.revision);
  expect(await db.incidentEvent.count({ where: { incidentId: row.id } })).toBe(eventCount);
  expect(await db.incidentWorkOrderLink.count({ where: { incidentId: row.id } })).toBe(1);
  const foreign = await f.publish(await f.factory());
  const foreignOrder = await f.create(foreign); expect(foreignOrder.status).toBe(201);
  expect(await link(row, { type: 'work_order', id: foreignOrder.body.data.id })).toMatchObject({ status: 503 });
  expect(await link(row, { type: 'case', id: foreign.id })).toMatchObject({ status: 404 });
  // Generic manual-replan cases have no trusted trigger machine: label case scope.
  const caseLink = data(await link(row, { type: 'case', id: publication.id }));
  expect(caseLink.links.find(l => l.type === 'case').association_scope).toBe('case');
}, 60000);

test('missing linked target cannot be bypassed with a manager override', async () => {
  let { row } = await setup();
  // Deliberately simulate a producer record absent from an already persisted link.
  await db.incidentWorkOrderLink.create({ data: { incidentId: row.id, targetId: randomUUID(),
    associationScope: 'machine', createdBy: f.users.ADMIN.id } });
  const response = await command(row, 'MARK_RESOLVED', { resolution, work_order_override_reason: 'Must not bypass missing target' });
  expect(response).toMatchObject({ status: 503, body: { error: { code: 'INCIDENT_LINK_TARGET_UNAVAILABLE' } } });
  const read = data(await f.http('/incidents/' + row.id));
  expect(read.incident.revision).toBe(row.revision);
  expect(read.links[0].availability).toBe('unavailable');
  expect(read.work_orders).toEqual([]);
}, 60000);

test('linked resolution and producer cancellation serialize against the same factory boundary', async () => {
  let { row, order, publication } = await setup();
  row = data(await link(row, { type: 'work_order', id: order.id })).incident;
  let attempts;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${publication.body.factory_id}, 0))::text`;
    attempts = [command(row, 'MARK_RESOLVED', { resolution }),
      f.command(order, 'CANCEL', { reason: 'Maintenance no longer required after independent inspection' }, f.users.MANAGER)];
    // Observe both real HTTP transactions waiting before releasing the barrier.
    const deadline = Date.now() + 10000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const locks = await tx.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
      waiting = locks[0].count;
      if (waiting >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBeGreaterThanOrEqual(2);
  }, { timeout: 15000 });
  const [resolved, cancelled] = await Promise.all(attempts);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.data.status).toBe('CANCELLED');
  // Either serial order is legal; a blocked resolution must leave no effects.
  expect([200, 409]).toContain(resolved.status);
  if (resolved.status === 409) {
    expect(resolved.body.error.code).toBe('INCIDENT_WORK_ORDER_ACTIVE');
    expect(data(await f.http('/incidents/' + row.id)).incident.revision).toBe(row.revision);
    row = data(await command(row, 'MARK_RESOLVED', { resolution })).incident;
  } else row = resolved.body.data.incident;
  expect(row.status).toBe('RESOLVED');
  expect(await db.incidentEvent.count({ where: { incidentId: row.id, command: 'MARK_RESOLVED' } })).toBe(1);
  expect((await db.workOrder.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED');
}, 60000);
