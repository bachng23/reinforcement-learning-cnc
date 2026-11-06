const { randomUUID, createHmac, timingSafeEqual } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const access = require('./factory-access.service');
const policy = require('./incident-policy');
const { contentHash, validatePayload } = require('./operations-contract.service');
const { parse } = policy;
const { readBasis: snapshot, projectSource: sourceProjection } = require('./incident-source.service');
const { linkedWorkOrders: workOrders } = require('./incident-work-orders.service');
const managers = ['ADMIN', 'ENGINEER'];
const ownerCommands = ['ACKNOWLEDGE', 'START_INVESTIGATION', 'MARK_RESOLVED'];
const uuid = z.string().uuid();
const empty = z.object({}).strict();
const notFound = () => new ApiError(404, 'INCIDENT_NOT_FOUND', 'Incident was not found');
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const serial = value => JSON.parse(JSON.stringify(value));
const meta = () => ({ read_at: new Date().toISOString() });
const pageSize = max => z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(max));
const listSchema = z.object({ factory_id: access.identifier, status: z.enum(policy.statuses).optional(),
  severity: z.enum([...policy.severities, 'UNCONFIRMED']).optional(), owner_user_id: uuid.optional(),
  machine_id: access.identifier.optional(), q: z.string().trim().min(1).max(200).optional(),
  limit: pageSize(100).default(25), cursor: z.string().max(4096).optional() }).strict();
const historySchema = z.object({ after_sequence: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().max(2147483647)).default(0),
  limit: pageSize(200).default(100) }).strict();

async function rowFor(tx, identity, id, lock = false) {
  if (!uuid.safeParse(id).success) throw notFound();
  const rows = await tx.$queryRaw(Prisma.sql`SELECT * FROM factory_incidents WHERE id=${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  if (!rows[0]) throw notFound();
  try { await access.authorizeFactory(tx, identity, rows[0].factory_id); }
  catch (error) { if (error.statusCode === 404) throw notFound(); throw error; }
  return rows[0];
}
function summary(row) {
  return { id: row.id, factory_id: row.factory_id, title: row.title, category: row.category,
    machine: row.machine_id ? { machine_id: row.machine_id, basis_snapshot_id: row.basis_snapshot_id } : null,
    source: row.source, severity: row.severity, proposed_severity: row.proposed_severity, status: row.status,
    owner_user_id: row.owner_user_id, revision: row.revision, first_occurred_at: row.first_occurred_at,
    last_occurred_at: row.last_occurred_at, occurrence_count: row.occurrence_count, created_at: row.created_at, updated_at: row.updated_at };
}
async function activeLinks(tx, id) {
  return tx.$queryRaw`SELECT id,target_id,association_scope,created_by,created_at,'case' AS type
    FROM incident_case_links WHERE incident_id=${id}::uuid AND removed_at IS NULL
    UNION ALL SELECT id,target_id,association_scope,created_by,created_at,'work_order' AS type
    FROM incident_work_order_links WHERE incident_id=${id}::uuid AND removed_at IS NULL ORDER BY created_at,id`;
}
async function detail(tx, user, row) {
  const links = await activeLinks(tx, row.id);
  const workIds = links.filter(link => link.type === 'work_order').map(link => link.target_id);
  let work = [], workUnavailable = false;
  try { work = await workOrders(tx, user, row.factory_id, workIds); }
  catch (error) { if (![404, 503].includes(error.statusCode)) throw error; workUnavailable = true; }
  // Keep target identity but never fabricate a status from a failed lookup.
  const projected = links.map(link => ({ ...link, availability: link.type === 'work_order' && workUnavailable ? 'unavailable' : 'available' }));
  const commands = [];
  if (managers.includes(user.role)) {
    commands.push('CHANGE_SEVERITY');
    if (['OPEN','ACKNOWLEDGED','INVESTIGATING'].includes(row.status)) commands.push(row.owner_user_id ? 'REASSIGN' : 'ASSIGN', 'APPEND_OCCURRENCE');
    if (['RESOLVED','CLOSED'].includes(row.status)) commands.push('REOPEN');
    if (row.status === 'RESOLVED' && row.resolved_by !== user.id && row.severity !== null) commands.push('CLOSE');
  }
  if (['OPERATOR','ENGINEER'].includes(user.role) && row.owner_user_id === user.id) {
    const next = { OPEN: 'ACKNOWLEDGE', ACKNOWLEDGED: 'START_INVESTIGATION', INVESTIGATING: 'MARK_RESOLVED' }[row.status];
    if (next) commands.push(next);
  }
  return serial({ success: true, data: { incident: summary(row), description: row.description,
    acknowledgment: row.acknowledged_at ? { actor_id: row.acknowledged_by, occurred_at: row.acknowledged_at } : null,
    resolution: row.resolved_at ? { actor_id: row.resolved_by, occurred_at: row.resolved_at, report: row.resolution } : null,
    closure: row.closed_at ? { actor_id: row.closed_by, occurred_at: row.closed_at, verification: row.verification } : null,
    links: projected, work_orders: work.map(({ availability, ...order }) => order), available_commands: commands }, meta: meta() });
}
async function getIncident(db, identity, id) {
  return db.$transaction(async tx => {
    const row = await rowFor(tx, identity, id);
    return detail(tx, await access.currentUser(tx, identity), row);
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}

async function event(tx, row, user, command, payload) {
  await tx.$executeRaw`INSERT INTO incident_events(incident_id,sequence,command,actor_id,payload)
    SELECT ${row.id}::uuid,COALESCE(MAX(sequence),0)+1,${command},${user.id}::uuid,${JSON.stringify(payload)}::jsonb FROM incident_events WHERE incident_id=${row.id}::uuid`;
  await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: row.id, factoryId: row.factory_id,
    action: `INCIDENT_${command}`, actorUserId: user.id, payloadJson: { incident_id: row.id, revision: row.revision } } });
}
async function occurrence(tx, row, user, body, source) {
  await tx.$executeRaw`INSERT INTO incident_occurrences(factory_id,incident_id,sequence,source_type,source_id,source_hash,machine_id,basis_snapshot_id,evidence,actor_id)
    VALUES(${row.factory_id},${row.id}::uuid,${row.occurrence_count},${body.source.type},${source.sourceId}::uuid,${source.hash},${source.machine?.machine_id ?? null},${source.machine?.basis_snapshot_id ?? null},${JSON.stringify(source.evidence)}::jsonb,${user.id}::uuid)`;
}
async function lookupSource(tx, factoryId, type, id) {
  return (await tx.$queryRaw`SELECT * FROM incident_occurrences WHERE factory_id=${factoryId} AND source_type=${type} AND source_id=${id}::uuid`)[0];
}
const columns = { revision:'revision', updatedAt:'updated_at', ownerUserId:'owner_user_id', status:'status', acknowledgedBy:'acknowledged_by', acknowledgedAt:'acknowledged_at',
  resolution:'resolution', resolvedBy:'resolved_by', resolvedAt:'resolved_at', verification:'verification', closedBy:'closed_by', closedAt:'closed_at', severity:'severity' };
async function update(tx, id, patch) {
  const assignments = Object.entries(patch).map(([key,value]) => {
    const column = columns[key]; if (!column) throw new Error('Unsupported incident update');
    const field = Prisma.raw(column);
    if (['resolution','verification'].includes(key)) return Prisma.sql`${field}=${JSON.stringify(value)}::jsonb`;
    if (['ownerUserId','acknowledgedBy','resolvedBy','closedBy'].includes(key)) return Prisma.sql`${field}=${value}::uuid`;
    return Prisma.sql`${field}=${value}`;
  });
  return (await tx.$queryRaw(Prisma.sql`UPDATE factory_incidents SET ${Prisma.join(assignments)} WHERE id=${id}::uuid RETURNING *`))[0];
}
function enforceCommandRole(user, row, input, operation) {
  if (operation === 'report') { policy.initialSeverity(input, user); return; }
  if (operation !== 'command' || !ownerCommands.includes(input.command)) {
    if (!managers.includes(user.role)) fail(403,'FORBIDDEN','A manager is required');
  } else if (!['OPERATOR','ENGINEER'].includes(user.role) || row.owner_user_id !== user.id) {
    fail(403,'INCIDENT_OWNER_REQUIRED','The current eligible owner is required');
  }
}

async function writeIncident(db, identity, operation, id, rawBody, rawKey, linkId) {
  const schemas = { report: policy.reportSchema, command: policy.commandSchema, link: policy.linkSchema, unlink: policy.unlinkSchema };
  const body = parse(schemas[operation], rawBody), key = parse(policy.keySchema, rawKey);
  if (operation === 'unlink' && !uuid.safeParse(linkId).success) throw notFound();
  const initial = operation === 'report' ? null : await rowFor(db, identity, id);
  const factoryId = initial?.factory_id ?? body.factory_id;
  const hash = contentHash({ operation, id: id ?? null, linkId: linkId ?? null, body });
  return db.$transaction(async tx => {
    await access.lockFactory(tx, factoryId);
    let row = initial ? await rowFor(tx, identity, id) : null;
    await access.lockUsers(tx, [identity.id, row?.owner_user_id, body.owner_user_id].filter(Boolean));
    const user = await access.currentUser(tx, identity, ['ADMIN','ENGINEER','OPERATOR']);
    await access.authorizeFactory(tx, user, factoryId);
    if (row) row = await rowFor(tx, user, id, true);
    enforceCommandRole(user, row, body, operation);
    const receipt = (await tx.$queryRaw`SELECT * FROM incident_command_receipts WHERE factory_id=${factoryId} AND actor_id=${user.id}::uuid AND idempotency_key=${key}`)[0];
    if (receipt) {
      if (receipt.request_hash !== hash) fail(409,'IDEMPOTENCY_KEY_REUSED','Key was used for a different command');
      return { status: receipt.response_status, body: receipt.response_body, replayed: true };
    }
    let status = 200;
    if (operation === 'report') {
      const source = await sourceProjection(tx, user, factoryId, body);
      const duplicate = await lookupSource(tx, factoryId, body.source.type, source.sourceId);
      if (duplicate) {
        if (body.source.type === 'manual' && duplicate.source_hash !== source.hash) fail(409,'INCIDENT_SOURCE_CONFLICT','Manual source identity was used for another report');
        row = await rowFor(tx, user, duplicate.incident_id, true);
      } else {
        if (source.machine) {
          const related = await tx.$queryRaw`SELECT id FROM factory_incidents WHERE factory_id=${factoryId} AND machine_id=${source.machine.machine_id} LIMIT 1`;
          if (related.length && !body.related_incident_reason) fail(409,'INCIDENT_RELATED_REASON_REQUIRED','Review related incidents and supply a reason for a distinct report');
        }
        const createdId = randomUUID();
        row = (await tx.$queryRaw`INSERT INTO factory_incidents(id,factory_id,title,description,category,machine_id,basis_snapshot_id,source,severity,proposed_severity)
          VALUES(${createdId}::uuid,${factoryId},${body.title},${body.description},${body.category},${source.machine?.machine_id ?? null},${source.machine?.basis_snapshot_id ?? null},${body.source.type},${policy.initialSeverity(body,user)},${body.proposed_severity ?? null}) RETURNING *`)[0];
        await occurrence(tx,row,user,body,source);
        await event(tx,row,user,'REPORT',{ source:body.source, severity:row.severity, proposed_severity:row.proposed_severity, related_incident_reason:body.related_incident_reason ?? null });
        status = 201;
      }
    } else {
      if (row.revision !== body.expected_revision) fail(409,'INCIDENT_REVISION_CONFLICT','Incident changed; review the latest state');
      if (operation === 'command') {
        let owner;
        if (body.owner_user_id) {
          try {
            owner = await access.currentUser(tx, { id:body.owner_user_id }, ['OPERATOR','ENGINEER']);
            await access.authorizeFactory(tx,owner,factoryId); owner.factoryAuthorized = true;
          } catch (error) {
            if ([401,403,404].includes(error.statusCode)) fail(409,'INCIDENT_OWNER_UNAVAILABLE','Owner must be active and authorized for this factory');
            throw error;
          }
        }
        const links = (await activeLinks(tx,row.id)).filter(l => l.type === 'work_order');
        let linkedWorkOrders;
        if (['MARK_RESOLVED','CLOSE'].includes(body.command)) {
          const targets = await workOrders(tx,user,factoryId,links.map(l => l.target_id), { lock: true });
          linkedWorkOrders = targets.map(target => ({ ...target, availability: 'available' }));
        }
        const value = { ...row, ownerUserId:row.owner_user_id, resolvedBy:row.resolved_by, activeWorkOrderLinkCount:links.length };
        const result = policy.transition(value,body,user,{ now:new Date(),owner,linkedWorkOrders });
        if (body.command === 'APPEND_OCCURRENCE') {
          const sourceBody = { ...body, ...(row.machine_id && body.source.type === 'manual'
            ? { machine: { machine_id:row.machine_id,basis_snapshot_id:row.basis_snapshot_id } } : {}) };
          const source = await sourceProjection(tx,user,factoryId,sourceBody);
          if ((source.machine?.machine_id ?? null) !== row.machine_id) fail(409,'INCIDENT_MACHINE_MISMATCH','Occurrence machine does not match incident');
          const duplicate = await lookupSource(tx,factoryId,body.source.type,source.sourceId);
          if (duplicate && duplicate.incident_id !== row.id) fail(409,'INCIDENT_SOURCE_ALREADY_LINKED','Source already belongs to another incident');
          if (!duplicate) {
            row = (await tx.$queryRaw`UPDATE factory_incidents SET occurrence_count=occurrence_count+1,last_occurred_at=now(),revision=revision+1,updated_at=now() WHERE id=${row.id}::uuid RETURNING *`)[0];
            await occurrence(tx,row,user,body,source); await event(tx,row,user,body.command,{source:body.source,reason:body.reason});
          }
        } else {
          row = await update(tx,row.id,result.patch);
          await event(tx,row,user,body.command,result.event.payload);
        }
      } else {
        const links = await activeLinks(tx,row.id);
        if (operation === 'link') {
          let association = 'case';
          if (body.target.type === 'case') {
            const target = await tx.decisionCase.findUnique({where:{id:body.target.id}});
            if (!target || target.factoryId !== factoryId) throw notFound();
            await access.authorizeFactory(tx,user,target.factoryId);
            if (target.mode !== 'LIVE') fail(400,'INCIDENT_INVALID_SOURCE','Simulation case cannot be linked to an operational incident');
            if (contentHash(target.requestJson) !== target.requestHash) fail(500,'INCIDENT_INTEGRITY_ERROR','Case integrity failed');
            const trigger = (await validatePayload(target.requestJson.request,'case-request')).trigger;
            if (trigger.machine_id) {
              await snapshot(tx,user,factoryId,target.snapshotId,trigger.machine_id);
              if (row.machine_id && row.machine_id !== trigger.machine_id) fail(409,'INCIDENT_MACHINE_MISMATCH','Target machine differs');
              association = 'machine';
            }
          } else {
            const targets = await workOrders(tx,user,factoryId,[body.target.id], { lock: true });
            const target = targets[0];
            if (!target || target.factory_id !== factoryId || target.id !== body.target.id) throw notFound();
            if (row.machine_id && row.machine_id !== target.machine_id) fail(409,'INCIDENT_MACHINE_MISMATCH','Target machine differs');
            association = 'machine';
          }
          if (!links.some(link => link.type === body.target.type && link.target_id === body.target.id)) {
            if (links.length >= 50) fail(409,'INCIDENT_LINK_LIMIT','Maximum 50 active links');
            const table = Prisma.raw(body.target.type === 'case' ? 'incident_case_links' : 'incident_work_order_links');
            await tx.$executeRaw(Prisma.sql`INSERT INTO ${table}(incident_id,target_id,association_scope,created_by) VALUES(${row.id}::uuid,${body.target.id}::uuid,${association},${user.id}::uuid)`);
            row = await update(tx,row.id,{revision:row.revision+1,updatedAt:new Date()});
            await event(tx,row,user,'LINK',{target:body.target,association_scope:association});
          }
        } else {
          const target = links.find(link => link.id === linkId);
          if (!target) throw notFound();
          const table = Prisma.raw(target.type === 'case' ? 'incident_case_links' : 'incident_work_order_links');
          await tx.$executeRaw(Prisma.sql`UPDATE ${table} SET removed_by=${user.id}::uuid,removed_at=now(),removal_reason=${body.reason} WHERE id=${linkId}::uuid`);
          row = await update(tx,row.id,{revision:row.revision+1,updatedAt:new Date()});
          await event(tx,row,user,'UNLINK',{link_id:linkId,reason:body.reason});
        }
      }
    }
    const response = await detail(tx,user,row);
    await tx.$executeRaw`INSERT INTO incident_command_receipts(factory_id,actor_id,idempotency_key,request_hash,incident_id,response_status,response_body)
      VALUES(${factoryId},${user.id}::uuid,${key},${hash},${row.id}::uuid,${status},${JSON.stringify(response)}::jsonb)`;
    return { status,body:response,replayed:false };
  }, { timeout:60000 });
}

function sign(value) {
  if (!process.env.JWT_SECRET) fail(503,'CURSOR_SIGNING_UNAVAILABLE','Cursor signing unavailable');
  return createHmac('sha256',process.env.JWT_SECRET).update('incident-list:v1:').update(value).digest();
}
function cursor(value, scope) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) fail(400,'INVALID_CURSOR','Invalid cursor');
  const [payload,sig] = value.split('.');
  if (!timingSafeEqual(sign(payload),Buffer.from(sig,'base64url'))) fail(400,'INVALID_CURSOR','Invalid cursor');
  let parsed; try { parsed=JSON.parse(Buffer.from(payload,'base64url')); } catch { fail(400,'INVALID_CURSOR','Invalid cursor'); }
  if (parsed.scope !== scope || !uuid.safeParse(parsed.id).success || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(parsed.at)) fail(400,'INVALID_CURSOR','Cursor scope changed');
  return parsed;
}
async function listIncidents(db,identity,input) {
  const q = parse(listSchema,input);
  const scope = JSON.stringify([identity.id,q.factory_id,q.status??null,q.severity??null,q.owner_user_id??null,q.machine_id??null,q.q??null]);
  const after=cursor(q.cursor,scope);
  return db.$transaction(async tx => {
    await access.authorizeFactory(tx,identity,q.factory_id);
    const rows=await tx.$queryRaw(Prisma.sql`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM factory_incidents WHERE factory_id=${q.factory_id}
      ${q.status ? Prisma.sql`AND status=${q.status}` : Prisma.empty}
      ${q.severity === 'UNCONFIRMED' ? Prisma.sql`AND severity IS NULL` : q.severity ? Prisma.sql`AND severity=${q.severity}` : Prisma.empty}
      ${q.owner_user_id ? Prisma.sql`AND owner_user_id=${q.owner_user_id}::uuid` : Prisma.empty}
      ${q.machine_id ? Prisma.sql`AND machine_id=${q.machine_id}` : Prisma.empty}
      ${q.q ? Prisma.sql`AND (strpos(lower(title),lower(${q.q}))>0 OR strpos(lower(description),lower(${q.q}))>0)` : Prisma.empty}
      ${after ? Prisma.sql`AND (created_at,id)<(${after.at}::timestamptz,${after.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC,id DESC LIMIT ${q.limit+1}`);
    const page=rows.slice(0,q.limit),last=page.at(-1); let next=null;
    if (rows.length>q.limit) { const p=Buffer.from(JSON.stringify({scope,id:last.id,at:last.cursor_at})).toString('base64url'); next=`${p}.${sign(p).toString('base64url')}`; }
    return serial({success:true,data:page.map(summary),meta:{...meta(),limit:q.limit,has_more:rows.length>q.limit,next_cursor:next}});
  },{isolationLevel:'RepeatableRead'});
}
async function counts(db,identity,input) {
  const {factory_id}=parse(z.object({factory_id:access.identifier}).strict(),input);
  return db.$transaction(async tx => {
    await access.authorizeFactory(tx,identity,factory_id);
    const groups=await tx.$queryRaw`SELECT status,severity,(owner_user_id IS NULL) AS unassigned,count(*)::int AS count FROM factory_incidents WHERE factory_id=${factory_id} GROUP BY status,severity,(owner_user_id IS NULL)`;
    const data={factory_id,total:0,by_status:Object.fromEntries(policy.statuses.map(k=>[k,0])),by_severity:Object.fromEntries(policy.severities.map(k=>[k,0])),unconfirmed_severity:0,unassigned:0,awaiting_verification:0};
    for (const row of groups) { data.total+=row.count;data.by_status[row.status]+=row.count;if(row.severity)data.by_severity[row.severity]+=row.count;else data.unconfirmed_severity+=row.count;if(row.unassigned)data.unassigned+=row.count;if(row.status==='RESOLVED')data.awaiting_verification+=row.count; }
    return {success:true,data,meta:meta()};
  },{isolationLevel:'RepeatableRead'});
}
async function history(db,identity,id,input,kind) {
  const q=parse(historySchema,input);
  return db.$transaction(async tx=>{
    await rowFor(tx,identity,id);
    const table=Prisma.raw(kind==='events'?'incident_events':'incident_occurrences');
    const rows=await tx.$queryRaw(Prisma.sql`SELECT * FROM ${table} WHERE incident_id=${id}::uuid AND sequence>${q.after_sequence} ORDER BY sequence LIMIT ${q.limit+1}`);
    const page=rows.slice(0,q.limit).map(row=>kind==='events'?row:{id:row.id,incident_id:row.incident_id,sequence:row.sequence,factory_id:row.factory_id,
      source:row.source_type==='manual'?{type:'manual',source_event_id:row.source_id}:{type:'case_health_alert',case_id:row.source_id},
      machine:row.machine_id?{machine_id:row.machine_id,basis_snapshot_id:row.basis_snapshot_id}:null,actor_id:row.actor_id,recorded_at:row.recorded_at,evidence:row.evidence});
    return serial({success:true,data:page,meta:{...meta(),has_more:rows.length>q.limit,next_after_sequence:page.at(-1)?.sequence??q.after_sequence}});
  },{isolationLevel:'RepeatableRead'});
}
module.exports={empty,getIncident,writeIncident,listIncidents,counts,history};
