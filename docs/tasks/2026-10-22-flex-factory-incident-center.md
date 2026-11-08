# Flex — Factory Incident Center, quản lý cảnh báo và xử lý sự cố

> Đọc cùng [task hoàn tất Flex ngày23/10](2026-10-23-flex-incident-center-completion.md). Contract/policy/evidence đã merge; task tiếp theo phải hoàn tất persistence/API/UI và nghiệm thu thật.

Ngày giao 22/10/2026. Owner Flex; nhánh đề xuất codex/factory-incident-center.
Đọc [contract phối hợp](2026-10-22-maintenance-incidents-coordination.md). Flex nhận trọn module: database/API incident, UI desktop và kiểm thử tích hợp; không chỉ làm QA. Không tự merge.

## 1. Kết quả nghiệp vụ

Người quản lý thấy vấn đề nào đang mở, mức độ, người phụ trách, bằng chứng, diễn biến và việc cần làm tiếp. Có thể ghi nhận/tiếp nhận/điều tra, liên kết case DSS và work order, xác minh giải quyết rồi đóng hoặc mở lại.

Không tái tạo case lifecycle hay work order của Backend. Không gọi mọi health measurement là alert, không đặt risk threshold mới trong frontend và không giới thiệu phát hiện AI tự động chưa có nguồn.

## 2. Phạm vi dữ liệu và nguồn tạo

- Model tối thiểu: FactoryIncident, IncidentOccurrence, IncidentEvent, IncidentCommandReceipt, IncidentCaseLink, IncidentWorkOrderLink. FK Factory/User; immutable machine/evidence reference gắn factory và basis snapshot; incident là product model, không đổi Python enums v3 chỉ để thêm UI.
- Incident có UUID, title, description, factory, máy nếu có nguồn xác định, severity, status, owner, revision, first/last occurrence, occurrence_count, acknowledgment/resolution/closure metadata. Server sở hữu actor/time.
- Severity INFO/WARNING/CRITICAL cần mô tả định nghĩa nghiệp vụ và nhãn rõ. Manual severity do ENGINEER/ADMIN xác nhận; OPERATOR có thể gửi mức đề xuất khi report nhưng chưa được tự nâng severity chính thức. Auto source chỉ dùng severity do upstream đã được xác thực cung cấp.
- V1 có hai đường tạo tường minh: người dùng báo thủ công; người có quyền tạo incident từ case LIVE có trigger HEALTH_ALERT hợp lệ/evidence server đọc từ immutable basis/request đã authorize. Nhãn nguồn là manual hoặc case_health_alert, không gọi là autonomous detection.
- Chỉ có HealthSnapshot chưa có alert/policy thì không tự tạo incident. Chưa thêm background scanner/event bus hoặc engine cảnh báo trong đợt này.
- Khi từ case: server xác minh case/factory/mode và machine/evidence refs từ request/basis; không nhận client declaration rằng đó là case live/health alert. SIMULATION_ONLY không thành sự cố vận hành.
- Evidence giữ ID/time/model version/horizon/value được trả từ nguồn thật; nếu chỉ có reference thì đọc/projection qua service có quyền. Không expose raw case request, planner artifact hoặc fabricate health history.
- Worker/telemetry không bị side effect bởi GET. Poll/refresh không tạo incident.

## 3. Chống trùng và recurrence

- Create/commands dùng Idempotency-Key và expected revision theo contract. Unique source occurrence scope (factory, source_type, source_event_or_case_id) bảo đảm cùng nguồn không tạo nhiều occurrence/incident khi retry.
- Reporting lại cùng nguồn trả liên kết đã có, không tăng occurrence_count. Chỉ nguồn mới được xác nhận là occurrence mới.
- Gộp nhiều nguồn vào một incident đang mở phải qua command tường minh của ADMIN/ENGINEER, kiểm factory/machine/category và expected_revision. Không gộp bằng title hoặc machine display_name, không mở thuật toán heuristic chưa có contract.
- Nếu nguồn đã gắn incident CLOSED, retry vẫn trả incident cũ; không tự mở lại. Nguồn mới trên cùng máy hiển thị các incident liên quan để người quản lý chọn append/reopen/create mới có reason.
- Occurrence/event/source identity bất biến. source linking/dedup được xử lý transaction/unique constraints, không find-then-insert ngoài lock.

## 4. State machine

| Từ | Command → đích | Người và điều kiện |
| --- | --- | --- |
| Create | OPEN | OPERATOR/ENGINEER/ADMIN có factory scope; source hợp lệ |
| OPEN | ASSIGN | ADMIN/ENGINEER chọn owner active có scope; không tự ACK thay owner |
| OPEN | ACKNOWLEDGE → ACKNOWLEDGED | Owner hiện tại; ghi thời điểm tiếp nhận |
| ACKNOWLEDGED | START_INVESTIGATION → INVESTIGATING | Owner hiện tại |
| INVESTIGATING | MARK_RESOLVED → RESOLVED | Owner; resolution code + summary/evidence bắt buộc |
| RESOLVED | CLOSE → CLOSED | ADMIN/ENGINEER khác người mark resolved; verification bắt buộc |
| RESOLVED | REOPEN → INVESTIGATING | ADMIN/ENGINEER; reason, giữ lần giải quyết trước |
| CLOSED | REOPEN → OPEN | ADMIN/ENGINEER; reason, owner phải ACK lại |

- ASSIGN/REASSIGN không xóa diễn biến; reassign trong ACKNOWLEDGED/INVESTIGATING đưa về OPEN để owner mới ACK. Không đổi owner của RESOLVED/CLOSED nếu chưa reopen.
- Owner có thể là OPERATOR/ENGINEER, active và được cấp factory; không dùng canonical technician_id làm account.
- CHANGE_SEVERITY chỉ ADMIN/ENGINEER, reason và audit; không thay severity cũ trong lịch sử.
- Resolution codes tối thiểu: FIXED, FALSE_POSITIVE, NO_ACTION_REQUIRED. FALSE_POSITIVE/NO_ACTION_REQUIRED cần lý do và validation của quản lý lúc đóng; không ép phải tạo case/work order chỉ để đóng.
- Incident có work order chưa terminal thì chặn MARK_RESOLVED/CLOSE theo mặc định; manager có thể override với reason riêng đã chốt và audit. Không tự hủy work order. Không cho target unavailable bị coi là terminal.
- Work order CLOSED không tự resolve/close incident. Incident RESOLVED không sửa trạng thái máy, health index, case hoặc lịch.
- VIEWER đọc; OPERATOR chỉ thao tác incident mình phụ trách ngoài quyền report. ADMIN/ENGINEER vẫn phải tuân state guard và kiểm chứng độc lập khi đóng.

## 5. API/server implementation

Draft OpenAPI + DTO/examples trước; đề xuất:

- GET /api/v1/incidents?factory_id=…&status=…&severity=…&owner_user_id=…&machine_id=…&q=…&limit=…&cursor=…
- POST /api/v1/incidents — manual hoặc from_case discriminated input, Idempotency-Key.
- GET /api/v1/incidents/{id}; POST /api/v1/incidents/{id}/commands.
- GET /api/v1/incidents/{id}/events; GET /api/v1/incidents/{id}/occurrences.
- POST /api/v1/incidents/{id}/links và DELETE /api/v1/incidents/{id}/links/{link_id}; case/work-order target discriminated union, revision/receipt rules chốt rõ.
- GET /api/v1/incidents/summary?factory_id=… — counts toàn factory theo trạng thái/severity, unassigned/awaiting verification và overdue nếu SLA đã chốt; route summary đặt trước /:id.

Server search q chỉ title/description đã cho phép, bounded length, parameterized; filters AND, stable sort/cursors, reset khi scope/filter đổi. Không search tại trang hiện tại rồi gọi là toàn factory. Summary không cộng từ một trang list.

P1 này chưa có SLA policy: không thêm overdue countdown/escalation tự đặt. Có thể hiển thị thời gian chưa tiếp nhận và tuổi incident tính từ timestamps, ghi nhãn chính xác; mở SLA task sau.

Auth reuse #46, transactions/lock order factory → ordered users → incident; fresh roles/membership trước mutation/receipt replay. Links validate quyền cả target/source và same factory trong write boundary; không gọi target qua URL tùy ý client cung cấp.

Idempotency namespace riêng module; state/event/audit/receipt atomic, expected_revision conflicts 409. Events append-only sequence pagination; scoped 404, no-store, correlation và sanitized errors; no raw secrets/evidence notes ngoài scope.

## 6. Desktop UI trọn module

Thống nhất route map với Frontend trước khi sửa AppShell: đề xuất /operations/incidents và /operations/incidents/{id}; giữ một Overview, không thêm overview nhà máy cạnh tranh.

1. List: counts toàn factory, search/filter, sort được hỗ trợ, cursor pagination, status/severity/owner/source/age và row action. Factory/filter bám URL, reload/Back giữ đúng.
2. Report incident: form ngắn, manual/from-case rõ, chọn máy từ snapshot có scope, title/description; severity proposal có nhãn phù hợp. Không cho nhập giả actor/model/evidence.
3. Detail: tình trạng và owner → bằng chứng → next action → linked case/work orders → timeline. Case link dùng đúng UUID/Operations v3; không đưa về research /decisions.
4. Assignment, ACK, investigate, resolve/verify/reopen qua command có pending/error/conflict feedback. Disable duplicate submit, không optimistic success và không blind retry key mới.
5. Link work order từ nguồn tồn tại, hiển thị summary/status thật. Create work order vẫn qua API/guard Backend và current publication; incident không tự tạo lệnh từ candidate chưa commit.
6. Loading/empty/forbidden/unavailable/missing evidence/integrity/stale revision tách rõ. Retry chỉ read. Đổi factory abort/ignore request cũ; không lộ scope cũ.
7. Desktop 1280/1440/1920, keyboard/focus, status không chỉ màu, table numbers phải/text trái, density/sticky header theo UI hiện tại. Không mobile redesign hoặc thêm chart trang trí.
8. Demo được chọn/ghi nhãn rõ, tách transport; API fail không fallback fixture. Không claim live detection hoặc physical recovery.

## 7. Kiểm thử và nghiệm thu

- PostgreSQL authenticated HTTP: hai factories, roles, owner vs non-owner, inactive/revoked user, links ngoài scope và malformed source.
- Dedup cùng key/nguồn, recurrence mới, concurrent create/append/reopen; no-op không tăng occurrence_count; transaction rollback không event/receipt mồ côi.
- State guards, độc lập verification, stale revision, revoke thắng writes/replay, owner mất quyền và reassignment.
- Link case LIVE hợp lệ, từ chối simulation masquerading; case không có machine evidence không bị gán máy giả; không source payload leakage.
- Link work order active/closed/unavailable, override reason, không tự đóng incident khi work order xong hoặc tự hủy work order khi incident đóng.
- Summary vượt page limit, search/filter/cursors; missing evidence và target unavailable; audit tồn tại sau reload.
- Component/client/hook tests có delayed scope switch, refresh race, URL navigation chưa commit. Không bỏ regression #44.
- E2E services thật: manual incident → assign/ACK/investigate → link case v3 và work order từ publication thật → Backend thực hiện work order qua API được authorize → incident resolved/verified/closed → reload. Chạy REOPEN, revoke và false-positive path.
- Ba lần E2E từ schema sạch trên cùng integration SHA hai module; CI/build/contracts + fresh/populated upgrade xanh. Ảnh desktop list/detail/form/error states và SHA evidence.

## 8. Bàn giao

Draft PR gồm ERD/state diagram, OpenAPI/examples, UI route map, links contract và test plan trước implementation. Handoff Frontend về AppShell/global files; Backend về WorkOrderSummary/dependency SHA. Không sửa worker/planner hoặc work-order tables/services.

PR cuối có migration, full implementation/UI, runbook seed 2 factories, test commands/logs/CI và danh sách acceptance thực chạy. Nếu work-order API chưa sẵn thì tiếp tục incident độc lập, báo linked E2E pending, không giả pass bằng mock.

Ngoài scope: auto-monitor/background threshold engine, emails/SMS/push, SLA/escalation policy, attachments/file uploads, custom factory roles, full work-order execution UI, machine control hoặc sửa telemetry.
