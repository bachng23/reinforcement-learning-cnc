// Deterministic integrated API export. Runtime policy remains the request authority.
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const policy = require('../src/services/scenario-policy');
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const string = { type: 'string' };
const uuid = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const envelope = data => object({ success: { const: true }, data });
const schemas = {};
for (const [name, key] of Object.entries({ CreateWorkspace: 'createWorkspace', CreateDraft: 'createDraft',
  UpdateDraft: 'updateDraft', EnqueueRun: 'enqueueRun', EnqueueSensitivity: 'enqueueSensitivity',
  LiveEvaluation: 'liveEvaluation', PlanningConfig: 'planningConfig', Head: 'head' })) {
  const schema = z.toJSONSchema(policy[key], { io: 'input' });
  delete schema.$schema;
  schemas[name] = schema;
}
schemas.Error = object({ success: { const: false }, error: object({ code: string, message: string }), requestId: string });
schemas.Baseline = object({ factory_id: string, snapshot_id: string, snapshot_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  plan_version: { type: 'integer', minimum: 0 }, publication: nullable(object({ schedule_id: string,
    schedule_revision: { type: 'integer', minimum: 1 }, schedule_hash: string })) });
schemas.Workspace = object({ workspace_id: uuid, name: string, baseline: ref('Baseline'), planning_config: ref('PlanningConfig'),
  engine_version: string, contract_version: string, created_by: uuid, created_at: time,
  current_head: nullable(ref('Head')), stale: { type: 'boolean' } });
schemas.BaselineEntities = object({ workspace_id: uuid, baseline: ref('Baseline'),
  planning_window: object({ start_at: time, end_at: time }),
  technicians: { type: 'array', items: object({ technician_id: string, display_name: string,
    availability: { type: 'array', items: object({ start_at: time, end_at: time }) } }) },
  maintenance_requests: { type: 'array', items: object({ maintenance_request_id: string, machine_id: string,
    expected_duration_minutes: { type: 'number' }, earliest_start_at: nullable(time), latest_start_at: nullable(time),
    mandatory: { type: 'boolean' }, priority: string, status: string }) } });
schemas.Draft = object({ ...schemas.CreateDraft.properties, workspace_id: uuid, scenario_id: uuid,
  revision: { type: 'integer', minimum: 1 }, created_at: time, updated_at: time });
schemas.Job = object({ workspace_id: uuid, job_id: uuid, kind: { enum: ['RUN', 'SENSITIVITY'] },
  status: { enum: policy.jobStatuses }, input_hash: string, source_scenario_id: nullable(uuid),
  source_revision: nullable({ type: 'integer', minimum: 1 }), source_run_id: nullable(uuid),
  engine_version: string, contract_version: string, attempt: { type: 'integer', minimum: 0 },
  created_at: time, started_at: nullable(time), completed_at: nullable(time), deadline_at: time,
  error_code: nullable(string), result: nullable(ref('EngineResult')), points: { type: 'array', items: ref('Point') } });
schemas.Point = object({ point_index: { type: 'integer', minimum: 0 }, value: nullable({ type: 'number' }),
  status: { enum: policy.pointStatuses }, error_code: nullable(string), result: nullable(ref('ScenarioEngine_Evaluation')) });
for (const name of ['EvaluationResult', 'SensitivityResult', 'CompareResult']) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../contracts/scenario/v1/${name}.schema.json`), 'utf8'));
  const generated = JSON.parse(JSON.stringify(raw).replaceAll('#/$defs/', '#/components/schemas/ScenarioEngine_'));
  for (const [key, value] of Object.entries(generated.$defs)) schemas[`ScenarioEngine_${key}`] = value;
  delete generated.$defs; delete generated.$schema;
  schemas[`ScenarioEngine_${name}`] = generated;
}
schemas.EngineResult = { anyOf: [ref('ScenarioEngine_EvaluationResult'), ref('ScenarioEngine_SensitivityResult')] };
schemas.Comparison = ref('ScenarioEngine_CompareResult');
schemas.LiveCreated = object({ workspace_id: uuid, source_run_id: uuid, decision_case_id: uuid,
  mode: { const: 'LIVE' }, current_head: ref('Head') });
const page = item => envelope(object({ items: { type: 'array', items: ref(item) }, next_cursor: nullable(string) }));
const headers = { 'Cache-Control': { schema: { const: 'no-store' } }, 'X-Request-Id': { schema: string },
  'Idempotency-Replayed': { description: 'true only when the stored response is replayed after fresh authorization', schema: { const: 'true' } } };
const response = (description, schema) => ({ description, headers, content: { 'application/json': { schema } } });
const errors = { 400: 'VALIDATION_ERROR / SCENARIO_INVALID_TARGET / SCENARIO_INVALID_WINDOW / INVALID_CURSOR',
  401: 'UNAUTHORIZED: invalid token or inactive user', 403: 'FORBIDDEN: ADMIN or ENGINEER required for writes',
  404: 'SCENARIO_NOT_FOUND: missing or inaccessible scope',
  409: 'SCENARIO_REVISION_CONFLICT / IDEMPOTENCY_KEY_REUSED / SCENARIO_HEAD_CONFLICT / SCENARIO_RUN_NOT_READY / SCENARIO_LIVE_MAPPING_UNSUPPORTED / SCENARIO_ENGINE_VERSION_CONFLICT',
  500: 'SCENARIO_INTERNAL_ERROR / SCENARIO_SOURCE_INTEGRITY_ERROR / OPERATIONS_INTEGRITY_ERROR',
  503: 'DB_UNAVAILABLE / SCENARIO_ENGINE_UNAVAILABLE / SCENARIO_ENGINE_CONTRACT_UNAVAILABLE (no fallback)' };
const query = (name, schema, required = false) => ({ name, in: 'query', required, schema });
const pagination = [query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }), query('cursor', { type: 'string', maxLength: 2048 })];
const paths = {};
function operation(endpoint, method, request, result, status = 200, parameters = []) {
  const ids = [...endpoint.matchAll(/\{([^}]+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true, schema: uuid }));
  const write = method !== 'get';
  if (write) ids.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[!-~]+$' } });
  paths[endpoint] ??= {};
  paths[endpoint][method] = { tags: ['Scenario Planning'], summary: `${method.toUpperCase()} ${endpoint}`,
    description: write ? 'Fresh ADMIN/ENGINEER and factory access before receipt replay. Server owns actor/time. Atomic mutation, audit and receipt.'
      : 'Fresh active user/factory access; missing and inaccessible IDs have identical 404. Read-only.',
    parameters: [...ids, ...parameters],
    ...(request ? { requestBody: { required: true, content: { 'application/json': { schema: ref(request) } } } } : {}),
    responses: { [status]: response('Authoritative persisted result', result),
      ...Object.fromEntries(Object.entries(errors).map(([code, description]) => [code, response(description, ref('Error'))])) } };
}
const root = '/scenario-workspaces', workspace = `${root}/{workspace_id}`;
operation(root, 'post', 'CreateWorkspace', envelope(ref('Workspace')), 201);
operation(root, 'get', null, page('Workspace'), 200, [query('factory_id', { type: 'string', maxLength: 128 }, true), ...pagination]);
operation(workspace, 'get', null, envelope(ref('Workspace')));
operation(`${workspace}/baseline-entities`, 'get', null, envelope(ref('BaselineEntities')));
paths[`${workspace}/baseline-entities`].get.description += ' Immutable editor projection from the hash-verified pinned workspace snapshot, never current head. No query parameters. Array order preserves source order; the complete pinned target set is returned. snapshot_hash identifies the full source, not this projection. No feasibility verdict or hypothetical transform.';
operation(`${workspace}/scenarios`, 'post', 'CreateDraft', envelope(ref('Draft')), 201);
operation(`${workspace}/scenarios`, 'get', null, page('Draft'), 200, pagination);
operation(`${workspace}/scenarios/{scenario_id}`, 'get', null, envelope(ref('Draft')));
operation(`${workspace}/scenarios/{scenario_id}`, 'patch', 'UpdateDraft', envelope(ref('Draft')));
operation(`${workspace}/runs`, 'post', 'EnqueueRun', envelope(ref('Job')), 202);
operation(`${workspace}/runs`, 'get', null, page('Job'), 200, pagination);
paths[`${workspace}/runs`].get.description += ' List is a summary projection: result is null and points is empty; fetch run detail for persisted results and point progress.';
operation(`${workspace}/runs/{run_id}`, 'get', null, envelope(ref('Job')));
operation(`${workspace}/compare`, 'get', null, envelope(ref('Comparison')), 200,
  [query('run_ids', { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: uuid }, true)]);
paths[`${workspace}/compare`].get.parameters.at(-1).style = 'form';
paths[`${workspace}/compare`].get.parameters.at(-1).explode = false;
operation(`${workspace}/sensitivity-jobs`, 'post', 'EnqueueSensitivity', envelope(ref('Job')), 202);
operation(`${workspace}/sensitivity-jobs`, 'get', null, page('Job'), 200, pagination);
operation(`${workspace}/sensitivity-jobs/{job_id}`, 'get', null, envelope(ref('Job')));
operation(`${workspace}/live-evaluations`, 'post', 'LiveEvaluation', envelope(ref('LiveCreated')), 201);
const document = { openapi: '3.1.0', info: { title: 'Scenario Planning API', version: '1.0.0',
  description: 'Integrated contract using scenario-engine:1.0, scenario-evaluator:1.0.0 and scenario-crn:1. Reject unknown/repeated query fields and unknown body fields. List ordering created_at DESC,id DESC; opaque cursor binds actor/factory/workspace/filter. Draft PATCH replaces all editable fields and checks expected_revision. Canonical override order is type then target; hash independent of override ordering. Weights finite 0..1e6 with sum >1e-12. Duration is integer 1..43200 minutes. Sweep values explicit, unique, 1..7; Frontend default 5. A SUCCEEDED job has accepted output; inspect aggregate and per-point outcomes for partial failure, timeout or no-feasible results. LIVE handoff supports objective weights and typed defer bounds, creates a fresh case and requires new planning/review; physical assumptions require authorized ingestion of actual facts.' },
  servers: [{ url: '/api/v1' }], security: [{ cookieAuth: [] }, { bearerAuth: [] }], paths,
  components: { schemas, securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'pdm_token' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } } };
const target = path.resolve(__dirname, '../docs/scenario-planning.openapi.json');
const output = JSON.stringify(document, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) throw new Error('Scenario proposal drift: run export-scenario-contract.js');
} else fs.writeFileSync(target, output);
module.exports = { document };
