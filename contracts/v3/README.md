# Multi-Agent PdM Operations Contract v3

`v3` là contract chuẩn cho sản phẩm hỗ trợ quyết định production–maintenance–technician.
Contract này không thay thế `v2`: `v2` tiếp tục mô tả research environment cho quyết
định nhị phân `CONTINUE/REPLACE`, còn `v3` mô tả Operations Context và multi-agent
workflow.

## Nguồn chuẩn

- Canonical models: `ai_services/domain/operations/contracts.py`
- Schema builder: `ai_services/domain/operations/schema.py`
- Generated artifact: `contracts/v3/operations-domain.schema.json`
- Contract tests: `ai_services/tests/test_operations_contracts.py`

Không sửa file JSON Schema bằng tay. Mọi thay đổi bắt đầu từ Pydantic models, sau đó
regenerate schema và chạy test.

```bash
cd ai_services
uv run python scripts/export_operations_contracts.py
uv run pytest tests/test_operations_contracts.py -q
```

## Phạm vi đã khóa

Contract v3 bao phủ năm nhóm payload:

1. Factory snapshot và master/operational state.
2. Integrated production–maintenance–technician schedule.
3. Decision Case input, status và event stream.
4. Agent definition, task, message, run và tool-call trace.
5. Candidate plan, validation, recommendation và human decision.

Contract v3 không mô tả:

- Prisma persistence schema;
- internal model tensors;
- prompt template;
- private chain-of-thought;
- solver-internal variables;
- raw sensor files;
- RL replay buffer;
- authentication token;
- transport-specific HTTP headers.

Những thành phần trên là implementation detail và không được đưa vào wire payload.

## Versioning

- Mọi top-level wire payload mang `schema_version: "3.0"`.
- Thêm optional field có backward-compatible default có thể phát hành dưới `3.x`
  sau khi thống nhất consumer.
- Đổi meaning, unit, enum value, required field hoặc invariant phải tạo major version mới.
- Không tái sử dụng một field với meaning khác.
- Không xóa enum value khi consumer cũ có thể còn lưu dữ liệu đó.
- Model/tool/agent version độc lập với contract schema version.

## Quy ước chung

- JSON fields dùng `snake_case`.
- Identifier dài tối đa 128 ký tự và chỉ gồm chữ, số, `.`, `_`, `:`, `-`.
- Timestamp phải có timezone; naive datetime bị từ chối.
- Duration dùng phút với hậu tố `_minutes`.
- Latency dùng millisecond với hậu tố `_ms`.
- Xác suất nằm trong `[0, 1]`.
- `health_index = 1` nghĩa là khỏe nhất; `0` nghĩa là suy giảm nghiêm trọng nhất.
- Cost là số không âm trong currency unit do deployment/scenario cấu hình.
- Số thực không chấp nhận `NaN` hoặc infinity.
- Unknown fields bị từ chối.
- Danh sách entity/reference yêu cầu uniqueness tại nơi invariant có ý nghĩa.
- Mọi schedule revision là immutable; sửa lịch tạo revision mới.

## Catalog payload

| Contract | Producer | Consumer | Mục đích |
|---|---|---|---|
| `FactorySnapshot` | Backend | AI service | Snapshot bất biến cho một Decision Case |
| `RunDecisionCaseRequest` | Backend | AI service | Bắt đầu planning workflow |
| `MachineRiskReport` | PdM Agent | Các planning agent | Rủi ro, RUL, confidence và evidence |
| `ProductionOptionSet` | Scheduling Agent | Integrated Planner | Routing option cho job/operation bị ảnh hưởng |
| `MaintenanceOptionSet` | Maintenance Agent | Technician/Integrated Planner | Maintain-now/window/monitor option |
| `TechnicianOptionSet` | Technician Agent | Integrated Planner | Technician candidate và option chưa có người |
| `DecisionCaseStatusResponse` | Backend | Frontend | Trạng thái authoritative của case |
| `AgentDefinition` | AI service/config | Backend, frontend | Mô tả agent và tool allowance |
| `ToolDefinition` | Tool registry | AI service, frontend | Mô tả tool, side effect và permission |
| `AgentTask` | Supervisor | Specialist agent, trace store | Nhiệm vụ có dependency rõ ràng |
| `AgentRunTrace` | AI service | Backend, frontend | Trạng thái một lần chạy agent |
| `AgentMessage` | Agent | Agent/backend/frontend | Giao tiếp có cấu trúc và evidence |
| `ToolCallTrace` | AI service | Backend, frontend | Quan sát tool call đã sanitize |
| `CandidatePlan` | Planning engine | Validator/backend | Phương án chưa hoặc đã validate |
| `PlanValidation` | Validator | Planner/backend/frontend | Verdict deterministic/simulation |
| `RecommendationPackage` | Supervisor | Backend/frontend | Chỉ chứa candidate đã validate |
| `HumanDecisionRequest` | Frontend | Backend | Approve, modify hoặc reject |
| `DecisionEvent` | Backend | Frontend | SSE/WebSocket envelope |
| `ErrorResponse` | Mọi API service | API consumer | Lỗi có correlation và retryability |

## Ranh giới service

### Backend là system of record

Backend sở hữu:

- user và permission;
- factory master data;
- Decision Case lifecycle;
- persisted agent/tool trace;
- human decision;
- schedule commit và revision;
- audit log;
- SSE sequence.

Backend tạo `FactorySnapshot` bất biến trước khi gọi AI service. Nếu state vận hành
thay đổi trong khi case đang chạy, backend không sửa snapshot cũ; nó tạo case/snapshot
mới hoặc yêu cầu planner xác nhận dữ liệu đã stale.

### AI service sở hữu computation

AI service sở hữu:

- health/RUL adapter;
- agent orchestration;
- scheduling và matching tools;
- simulation;
- constraint validation;
- candidate-plan generation;
- explanation từ structured evidence.

AI service không được commit schedule hoặc tự ghi nhận human approval.

### Frontend là presentation và human-input boundary

Frontend:

- hiển thị API payload;
- giữ presentation-only state;
- gửi `HumanDecisionRequest`;
- không tự tính authoritative KPI;
- không tự kết luận plan khả thi;
- không tự tăng schedule revision.

## Invariant quan trọng

### Factory snapshot

- Machine, technician, job, maintenance request và health snapshot ID phải unique.
- `operation_id` unique trên toàn snapshot, không chỉ trong một job.
- Mọi machine option phải tham chiếu machine tồn tại.
- Health snapshot và maintenance request phải tham chiếu machine tồn tại.
- Current schedule phải tham chiếu đúng factory và entity tồn tại.
- Snapshot không được chứa simulator-private latent state.

### Schedule

- Assignment phải nằm trong planning window.
- Production assignment bắt buộc có `job_id` và `operation_id`.
- Maintenance assignment bắt buộc có `maintenance_request_id` và technician.
- Blocked-time assignment không tham chiếu production/maintenance entity.
- Contract kiểm tra structural validity và reference integrity.
- Resource overlap, precedence feasibility và certification adequacy là trách nhiệm
  của `PlanValidation`, vì cần toàn bộ domain context và policy version.

### Candidate và validation

- Candidate có thể tồn tại trước validation.
- `INVALID` bắt buộc có ít nhất một violation severity `ERROR`.
- `VALID` không được chứa violation severity `ERROR`.
- Warning không làm plan tự động invalid.
- Recommendation chỉ được chứa candidate có verdict `VALID`.

### Specialist-agent handoff

- Mọi handoff mang cùng `decision_case_id` và `snapshot_id` của case.
- Mọi handoff tham chiếu `generated_by_agent_run_id` để trace provenance.
- `MachineRiskReport` bắt buộc có risk driver và evidence.
- `ProductionOptionSet` chỉ chứa routing option thuộc affected job/operation.
- `CONTINUE_AND_MONITOR` không được giả lập intervention window/duration.
- Các maintenance decision khác bắt buộc có intervention window và duration.
- Một maintenance option không thể vừa có technician candidate vừa nằm trong danh
  sách explicitly unstaffed của cùng `TechnicianOptionSet`.
- Integrated Planner chỉ tiêu thụ handoff đã qua schema validation.

### Human decision

- Approve cần `candidate_plan_id`, `expected_plan_version` và `expected_snapshot_id`.
- Modify cần thêm `modified_schedule`; schedule này phải validate lại trước commit.
- Reject không chọn candidate và bắt buộc có note.
- Các trường `expected_*` cung cấp optimistic concurrency control.
- Backend phải từ chối approval nếu snapshot hoặc plan version không còn current.

### Simulation-only

- Trigger `WHAT_IF` bắt buộc dùng `SIMULATION_ONLY`.
- Case `SIMULATION_ONLY` không được chuyển sang `COMMITTED`.
- Tool có side effect operational không được gọi trong simulation-only execution.

### Agent và tool

- Agent chỉ được gọi tool trong allowlist của `AgentDefinition`.
- Tool cũng phải allow role đó trong `ToolDefinition.allowed_agent_roles`.
- Cả hai phép kiểm tra đều bắt buộc; không dùng một phía thay phía còn lại.
- Tool `OPERATIONAL_COMMIT` phải route qua supervisor/backend approval boundary.
- Terminal agent/tool run bắt buộc có `completed_at`.
- Successful tool call bắt buộc có output summary.
- Failed/timed-out call bắt buộc có error code.
- Trace chỉ chứa input/output đã sanitize, không chứa secret hay private reasoning.

## Decision Case lifecycle

```text
CREATED
  → ANALYZING
  → GENERATING
  → VALIDATING
  → EXPLAINING
  → AWAITING_APPROVAL
     ├─ APPROVED → COMMITTED
     ├─ MODIFIED → VALIDATING → AWAITING_APPROVAL
     └─ REJECTED
```

`FAILED` và `CANCELLED` có thể là terminal state từ các trạng thái execution. Backend
phải thực thi transition policy; enum contract chỉ định vocabulary, không thay thế
state-machine authorization.

## Agent/tool permission model

Permission hiệu lực là giao của ba điều kiện:

```text
agent.allowed_tool_ids
∩ tool.allowed_agent_roles
∩ execution-mode policy
```

Ví dụ:

| Agent role | Tool được phép |
|---|---|
| `PDM` | đọc health, dự đoán RUL, estimate failure risk |
| `PRODUCTION_SCHEDULING` | đọc job/capability, heuristic/CP-SAT production schedule |
| `MAINTENANCE_PLANNING` | maintenance window, delay risk, restoration estimate |
| `TECHNICIAN_DISPATCH` | skill lookup, availability, matching |
| `INTEGRATED_PLANNING` | integrated solver, plan scoring |
| `VALIDATION` | feasibility checker, simulator, KPI calculator |
| `EXPLANATION` | read-only evidence and plan-diff tools |
| `SUPERVISOR` | orchestration; commit vẫn cần backend-confirmed approval |

## Event streaming

`DecisionEvent` là envelope dùng cho SSE hoặc WebSocket. Backend là nguồn sequence
authoritative.

- `sequence` tăng đơn điệu trong một Decision Case.
- Client reconnect gửi last received sequence/event ID.
- Event có thể được replay từ persistence.
- `payload` phụ thuộc `event_type`, nhưng không thay thế resource GET endpoint.
- Event là notification; client nên fetch authoritative resource khi cần chi tiết.

## Error contract

Mọi service trả `ErrorResponse` cho lỗi domain/application:

- `error_id`: định danh lỗi cho support/audit;
- `code`: mã ổn định cho client;
- `message`: thông báo an toàn cho người dùng;
- `correlation_id`: liên kết log xuyên service;
- `retryable`: client có thể retry hay không;
- `details`: field-level hoặc domain-specific error.

Không trả stack trace, secret, prompt hoặc raw solver dump cho frontend.

## HTTP mapping đề xuất

| Tình huống | HTTP status |
|---|---:|
| Payload/schema không hợp lệ | 400 |
| Chưa đăng nhập | 401 |
| Không có quyền | 403 |
| Resource không tồn tại | 404 |
| Snapshot/plan version stale | 409 |
| Domain state transition không hợp lệ | 409 |
| Solver không tìm thấy plan trong time budget | 422 hoặc completed case với no-solution result |
| Rate limit | 429 |
| Service dependency unavailable | 503 |

## Consumer rules

### Backend

- Validate payload khi nhận từ AI service.
- Không tin KPI hoặc validation payload không đúng schema/version.
- Persist payload cùng hash và producer version.
- Không map unknown enum thành giá trị mặc định im lặng.

### Frontend

- Generate TypeScript types từ JSON Schema hoặc OpenAPI wrapper.
- Không duplicate enum bằng handwritten string nếu có thể generate.
- Unknown future enum phải fail visibly hoặc hiển thị unsupported state.
- Dùng event để cập nhật tiến trình; dùng resource endpoint cho authoritative state.

### AI service

- Validate input trước computation.
- Mọi agent output phải qua Pydantic model trước khi handoff.
- Tool output phải qua schema trước khi ghi trace.
- Không đưa tensor, numpy scalar hoặc non-finite float lên wire.

## Definition of Done cho thay đổi contract

Một thay đổi chỉ được merge khi:

1. Pydantic model đã cập nhật.
2. Invariant có test positive và negative tương ứng.
3. JSON Schema đã regenerate.
4. `git diff` của schema được review.
5. Backend/frontend impact được ghi nhận.
6. README được cập nhật nếu meaning hoặc lifecycle thay đổi.
7. Toàn bộ contract tests v2 và v3 đều pass.
