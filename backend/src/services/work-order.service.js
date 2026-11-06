const { recoverWorkOrder } = require('./work-order-recovery-policy');
const { authorizeFactory, currentUser, lockFactory, lockUsers } = require('./factory-access.service');
const { contentHash, validatePayload } = require('./operations-contract.service');
const P = require('./work-order-policy');
const R = require('./work-order-read.service');
const transaction = { isolationLevel: 'ReadCommitted', timeout: 20000 };
const sourceError = () =>
  P.conflict(
    'INVALID_WORK_ORDER_SOURCE',
    'Source must be an intact committed maintenance assignment with a matching basis',
  );
async function authorizeWrite(tx, identity, factoryId, roles) {
  const user = await currentUser(tx, identity, roles);
  await authorizeFactory(tx, user, factoryId);
  return user;
}
async function receipt(tx, factoryId, user, key, hash) {
  const r = await tx.workOrderCommandReceipt.findUnique({
    where: { factoryId_actorId_key: { factoryId, actorId: user.id, key } },
  });
  if (!r) return null;
  if (r.requestHash !== hash)
    throw P.conflict('IDEMPOTENCY_KEY_REUSED', 'Key belongs to another normalized work-order request');
  return { body: r.responseJson, status: r.statusCode, replayed: true };
}
async function eligibleAssignee(tx, factoryId, id) {
  try {
    const u = await currentUser(tx, { id }, P.executionRoles);
    await authorizeFactory(tx, u, factoryId);
    return u;
  } catch (e) {
    if ([401, 403, 404].includes(e.statusCode))
      throw P.conflict(
        'ASSIGNEE_UNAVAILABLE',
        'Assignee must be an active OPERATOR/ENGINEER with factory access',
      );
    throw e;
  }
}
async function record(tx, row, user, body, at, key, hash, status, previous = null, overlaps = []) {
  const payload = {
    from_status: previous?.status ?? null,
    to_status: row.status,
    revision: row.revision,
    attempt: row.attempt,
    assignee_user_id: row.assigneeUserId,
    ...(body.reason ? { reason: body.reason } : {}),
    ...(body.report ? { report: body.report } : {}),
    ...(body.verification ? { verification: body.verification } : {}),
    ...(body.overlap_override_reason
      ? { overlap_override_reason: body.overlap_override_reason, overlapping_work_order_ids: overlaps }
      : {}),
  };
  const event = await tx.workOrderEvent.create({
    data: {
      workOrderId: row.id,
      factoryId: row.factoryId,
      sequence: row.revision,
      actorId: user.id,
      command: body.command ?? 'CREATE',
      occurredAt: at,
      payloadJson: payload,
    },
  });
  await tx.auditLog.create({
    data: {
      entityType: 'SYSTEM',
      entityId: row.id,
      factoryId: row.factoryId,
      actorUserId: user.id,
      action: 'WORK_ORDER_' + (body.command ?? 'CREATE'),
      createdAt: at,
      payloadJson: {
        work_order_id: row.id,
        event_id: event.id,
        from_status: previous?.status ?? null,
        to_status: row.status,
        revision: row.revision,
        source_case_id: row.sourceCaseId,
      },
    },
  });
  const response = R.detail(row, await R.context(tx, row.factoryId), at, user);
  await tx.workOrderCommandReceipt.create({
    data: {
      factoryId: row.factoryId,
      actorId: user.id,
      key,
      requestHash: hash,
      workOrderId: row.id,
      statusCode: status,
      responseJson: response,
      createdAt: at,
    },
  });
  return { body: response, status, replayed: false };
}
async function createWorkOrder(db, identity, raw, keyValue) {
  const body = P.parse(P.createSchema, raw),
    key = P.parse(P.keySchema, keyValue),
    hash = contentHash({ operation: 'CREATE', body });
  await currentUser(db, identity, P.managerRoles);
  await authorizeFactory(db, identity, body.factory_id);
  return db.$transaction(async (tx) => {
    await lockFactory(tx, body.factory_id);
    await lockUsers(tx, [identity.id]);
    const user = await authorizeWrite(tx, identity, body.factory_id, P.managerRoles);
    const replay = await receipt(tx, body.factory_id, user, key, hash);
    if (replay) return replay;
    await tx.$queryRaw`SELECT factory_id FROM operations_heads WHERE factory_id=${body.factory_id} FOR UPDATE`;
    const head = await tx.operationsHead.findUnique({ where: { factoryId: body.factory_id } }),
      e = body.expected_head,
      s = body.source;
    if (
      !head ||
      head.revision !== e.revision ||
      head.snapshotId !== e.snapshot_id ||
      head.planVersion !== e.plan_version ||
      head.scheduleId !== s.schedule_id ||
      head.scheduleRevision !== s.schedule_revision
    )
      throw P.conflict(
        'SOURCE_PLAN_CHANGED',
        'Published head changed; review the current plan before creating a work order',
      );
    const publication = await tx.decisionCommit.findUnique({
      where: { caseId: s.decision_case_id },
      include: { schedule: { include: { snapshot: true } }, case: { select: { mode: true, status: true } } },
    });
    if (
      !publication ||
      publication.factoryId !== body.factory_id ||
      publication.scheduleId !== s.schedule_id ||
      publication.scheduleRevision !== s.schedule_revision ||
      publication.scheduleHash !== s.schedule_hash ||
      publication.planVersion !== head.planVersion ||
      publication.case.mode !== 'LIVE' ||
      publication.case.status !== 'COMMITTED'
    )
      throw sourceError();
    const schedule = publication.schedule.payloadJson,
      basis = publication.schedule.snapshot.payloadJson;
    if (
      contentHash(schedule) !== publication.scheduleHash ||
      contentHash(basis) !== publication.schedule.snapshot.contentHash
    )
      throw sourceError();
    try {
      await validatePayload({ schedule, snapshot: basis }, 'work-order-source');
    } catch (e) {
      if (e.statusCode === 400) throw sourceError();
      throw e;
    }
    const assignment = schedule.assignments.find((a) => a.assignment_id === s.assignment_id);
    const request = basis.maintenance_requests.find(
      (r) => r.maintenance_request_id === assignment?.maintenance_request_id,
    );
    if (
      !assignment ||
      assignment.assignment_type !== 'MAINTENANCE' ||
      assignment.status === 'CANCELLED' ||
      !request ||
      request.machine_id !== assignment.machine_id ||
      !basis.machines.some((m) => m.machine_id === assignment.machine_id)
    )
      throw sourceError();
    const origin = await tx.workOrder.findUnique({
      where: {
        factoryId_scheduleId_scheduleRevision_assignmentId: {
          factoryId: body.factory_id,
          scheduleId: s.schedule_id,
          scheduleRevision: s.schedule_revision,
          assignmentId: s.assignment_id,
        },
      },
    });
    if (origin)
      throw P.conflict(
        'WORK_ORDER_ORIGIN_EXISTS',
        'A work order already exists for this published assignment',
      );
    const active = { factoryId: body.factory_id, status: { notIn: P.terminal } };
    if (
      await tx.workOrder.findFirst({
        where: {
          ...active,
          basisSnapshotId: publication.snapshotId,
          maintenanceRequestId: request.maintenance_request_id,
        },
        select: { id: true },
      })
    )
      throw P.conflict(
        'ACTIVE_MAINTENANCE_REQUEST_EXISTS',
        'This basis maintenance request already has an active work order',
      );
    const overlaps = await tx.workOrder.findMany({
      where: {
        ...active,
        machineId: assignment.machine_id,
        plannedStartAt: { lt: new Date(assignment.end_at) },
        plannedEndAt: { gt: new Date(assignment.start_at) },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (overlaps.length && !body.overlap_override_reason)
      throw P.conflict(
        'WORK_ORDER_OVERLAP',
        'An active same-machine planned window overlaps; review or supply an explicit override reason',
      );
    const requirements = Object.fromEntries(
      [
        'maintenance_type',
        'action_type',
        'priority',
        'required_skill_ids',
        'minimum_skill_level',
        'mandatory',
        'expected_duration_minutes',
      ].map((k) => [k, request[k]]),
    );
    const at = await R.clock(tx);
    const row = await tx.workOrder.create({
      data: {
        factoryId: body.factory_id,
        sourceCaseId: publication.caseId,
        basisSnapshotId: publication.snapshotId,
        scheduleId: publication.scheduleId,
        scheduleRevision: publication.scheduleRevision,
        scheduleHash: publication.scheduleHash,
        publishedPlanVersion: publication.planVersion,
        basisSnapshotHash: publication.schedule.snapshot.contentHash,
        assignmentId: assignment.assignment_id,
        machineId: assignment.machine_id,
        maintenanceRequestId: request.maintenance_request_id,
        plannedStartAt: new Date(assignment.start_at),
        plannedEndAt: new Date(assignment.end_at),
        sourceTechnicianIds: assignment.technician_ids,
        requirementsJson: requirements,
        actorId: user.id,
        createdAt: at,
        updatedAt: at,
      },
      include: R.detailInclude,
    });
    return record(
      tx,
      row,
      user,
      body,
      at,
      key,
      hash,
      201,
      null,
      overlaps.map((r) => r.id),
    );
  }, transaction);
}
async function commandWorkOrder(db, identity, id, raw, keyValue) {
  const body = P.parse(P.commandSchema, raw),
    key = P.parse(P.keySchema, keyValue),
    hash = contentHash({ operation: 'COMMAND', id, body });
  const initial = await R.scoped(db, identity, id, false);
  return db.$transaction(async (tx) => {
    await lockFactory(tx, initial.row.factoryId);
    // Factory serialization stabilizes the assignee while collecting the user lock set.
    const identityRow = await tx.workOrder.findUnique({ where: { id }, select: { assigneeUserId: true } });
    if (!identityRow) throw P.missing();
    await lockUsers(tx, [
      identity.id,
      ...(body.assignee_user_id ? [body.assignee_user_id] : []),
      ...(body.command === 'REQUEST_REWORK' && identityRow.assigneeUserId
        ? [identityRow.assigneeUserId]
        : []),
    ]);
    let user;
    try {
      user = await authorizeWrite(tx, identity, initial.row.factoryId, ['ADMIN', 'ENGINEER', 'OPERATOR']);
    } catch (e) {
      if (e.statusCode === 404) throw P.missing();
      throw e;
    }
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.workOrder.findUnique({ where: { id }, include: R.detailInclude });
    P.requireCommandRole(row, user, body.command);
    const replay = await receipt(tx, row.factoryId, user, key, hash);
    if (replay) return replay;
    if (row.revision !== body.expected_revision)
      throw P.conflict('WORK_ORDER_REVISION_CONFLICT', 'Work order revision changed');
    const at = await R.clock(tx);
    const target = body.assignee_user_id
      ? await eligibleAssignee(tx, row.factoryId, body.assignee_user_id)
      : null;
    const data = ['MANAGER_HOLD', 'REASSIGN_FOR_REWORK'].includes(body.command)
      ? recoverWorkOrder(
          {
            ...row,
            latestCompletion: row.completions[0] ? { reportedBy: row.completions[0].actorId } : null,
          },
          body,
          user,
          { now: at, assignee: target ? { ...target, factoryAuthorized: true } : undefined },
        ).patch
      : P.transition(row, user, body, at);
    if (body.command === 'REQUEST_REWORK') await eligibleAssignee(tx, row.factoryId, row.assigneeUserId);
    if (body.command === 'COMPLETE')
      await tx.workOrderCompletion.create({
        data: {
          workOrderId: id,
          factoryId: row.factoryId,
          attempt: row.attempt,
          actorId: user.id,
          completedAt: at,
          reportJson: body.report,
        },
      });
    const next = await tx.workOrder.update({ where: { id }, data, include: R.detailInclude });
    return record(tx, next, user, body, at, key, hash, 200, row);
  }, transaction);
}
module.exports = { createWorkOrder, commandWorkOrder };
