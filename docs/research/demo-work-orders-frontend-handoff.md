# Frontend handoff: simulator work orders

Backend branch: `backend/jcst-maintenance-work-orders`, based on main ddf7a05.
This is the Backend 2 producer needed by `frontend/simulation-incident-workflow`.

## Ready to consume

- `GET /api/v1/research/demo/sessions/:id/work-orders?machineIndex=2&limit=20`
- OpenAPI: `backend/research-openapi.yaml`, DemoWorkOrders / DemoWorkOrder.
- TypeScript declaration: `backend/docs/contracts/demo-work-orders.d.ts`.
- Consumer fixtures: `backend/examples/demo-work-orders.json`.
- Physical source snapshots: `backend/examples/demo-work-orders-trace.json`.
- Shared event IDs: Backend 1 eff27fe `je1_` encoding, verified by the direct
  cross-projector script and golden identity vectors.

## Consumer changes needed

The new frontend branch currently uses `serviceEvidence(health, session.primary)`
to group retained trace events. Replace that source for maintenance cards with
the durable work-orders response; keep machine-health data for its chart/status.
Do not silently fall back to grouped trace if the endpoint fails.

Read health, session and work orders for the same session and machine. Require
matching revision/tick before publishing the combined view. If autoplay advances
between reads, cancel obsolete requests and retry/coalesce reads only; never
reissue a mutation. This endpoint does not accept expectedRevision, so compare
the returned revision with the session snapshot on the client.

Use workOrderId as the card key. Render assignmentSource as automatic / manually
approved / override / unknown. Display null as unavailable, never zero. Display
historyCoverage=PARTIAL explicitly. COMPLETED does not imply the machine is healthy.
Indexes are zero-based; display M/C/T labels with +1. Use stepSeconds for durations.
The response total is before limit; the default result is the newest 20 orders.

## Joint acceptance still required

Integrate this backend with Backend 1 and frontend commit 1d60a3e (or a documented
successor). Run real authenticated API + PostgreSQL + JCST + Chromium:

1. base/990000001/policy/corrective/wait/continuous, auto-approve and pause-on-failure off.
2. At t5 M3/C2 failure: no new M3 work order before approval.
3. Approve T2/M3/C2: t6 shows one CM card with one tick remaining and manual source.
4. Approve any t6 review to reach t7: same workOrderId, COMPLETED, completion tick 7.
5. Reload and verify stable ID/history with no mutation. Check defer, machine switch,
   partial legacy history and owner-scoped reads.

Record actual three SHAs, HTTP/browser logs and cleanup. The frontend's existing
intercepted-response Playwright runs are component evidence, not this acceptance.
