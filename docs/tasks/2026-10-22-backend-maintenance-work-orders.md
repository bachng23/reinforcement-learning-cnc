# Backend — Maintenance Work Orders, quản lý thực hiện bảo trì

> Đọc cùng [task hoàn tất Backend ngày23/10](2026-10-23-backend-work-orders-completion.md). Recovery contract mới có MANAGER_HOLD và REASSIGN_FOR_REWORK thay cho giới hạn phục hồi ban đầu bên dưới.

Ngày giao 22/10/2026. Owner Backend; nhánh đề xuất codex/maintenance-work-orders.
Đọc [contract phối hợp](2026-10-22-maintenance-incidents-coordination.md). Đây là một module hoàn chỉnh, không phải bổ sung vài endpoint vào Overview. Không tự merge.

## 1. Kết quả nghiệp vụ

Sau khi người quản lý COMMIT một kế hoạch v3, có thể tạo lệnh từ assignment bảo trì, phân công người thực hiện, xác nhận nhận việc, theo dõi tiến độ, báo kết quả và quản lý xác nhận đóng lệnh. Lịch công bố là kế hoạch bất biến; work order ghi nhận thực hiện riêng.

Phạm vi Backend: database, migrations, API, authorization, audit, tests, runbook và contract handoff cho Flex/Frontend. UI work order đầy đủ do Frontend nhận đợt riêng; curl/HTTP integration phải thực hiện được toàn bộ workflow.

## 2. Kiểm kê và thiết kế dữ liệu

- Fetch main mới nhất; ghi base/dependency SHA, đặc biệt #46. Không sửa local AI/frontend hoặc làm lại registry/access.
- Rà maintenance v2 hiện có; tái dùng kỹ thuật phù hợp nhưng không dùng research step như thời gian thực hoặc gộp identity research với Operations.
- ERD tối thiểu: WorkOrder, WorkOrderEvent/audit, WorkOrderCommandReceipt. Dùng bảng mới có owner rõ; không đổi canonical domain schema chỉ để thêm product workflow.
- WorkOrder có UUID, factory FK, source DecisionCommit identity, schedule composite identity/revision/hash, source assignment_id, basis_snapshot_id, machine_id và maintenance_request_id từ basis. Khóa ngoại bảo đảm scope, không chỉ kiểm ở client.
- Giữ planned start/end, nguồn technician IDs và yêu cầu/priority từ lịch/basis bất biến. Execution assignee_user_id tách riêng; đổi user phụ trách không sửa ScheduleAssignment. Không suy người dùng từ technician display_name.
- Có status, revision tăng đơn điệu, assignee, blocker, actual timestamps, completion report, verification và cancel reason. Server sở hữu actor/timestamps; ghi thời điểm báo cáo thực tế tại thao tác, chưa hỗ trợ backdate tùy ý trong vòng này.
- Event append-only có sequence, actor, thời điểm, command và public payload đã sanitize; report/note chỉ trả cho người có scope. FK Restrict cho dữ liệu lịch sử; không hard-delete work order.
- Unique origin ít nhất (factory, published schedule identity/revision, assignment_id). Retry/tạo lại cùng nguồn không tạo hai work orders; lịch mới cùng công việc phải có chính sách đối chiếu bên dưới.

## 3. Nguồn tạo lệnh và version kế hoạch

1. Tạo từ một assignment_type=MAINTENANCE thuộc publication do COMMIT thực hiện, có DecisionCommit provenance; không tạo từ candidate APPROVED chưa COMMIT, SIMULATION_ONLY, production assignment hoặc demo seed không có commit.
2. Request gửi source identity và expected published head; server đọc/validate đúng schedule và basis. Chỉ tạo mới từ current publication; head đổi khi chờ lock trả 409 để người dùng xem lại.
3. Lệnh đã tạo vẫn tồn tại khi P2 thay P1. Trả source plan/basis và source_is_current tính lúc đọc; không tự hủy, đổi máy, đổi giờ hoặc rebase lệnh cũ.
4. Một publication không tự spawn work orders. ADMIN/ENGINEER gọi create tường minh; có thể gọi nhiều lần theo từng assignment, không cần batch/automatic dispatcher trong đợt này.
5. Lịch mới có thể lặp maintenance request đã có lệnh: chống tạo lệnh active trùng cùng factory+basis+maintenance_request bằng constraint/transaction. Khác basis hoặc request identity không đủ để suy cùng công việc: phát hiện overlap theo máy/thời gian như conflict cần review, không tự merge.
6. Chốt chính sách overlap: mặc định từ chối lệnh active có planned window chồng nhau trên cùng máy bằng 409 WORK_ORDER_OVERLAP; ADMIN/ENGINEER chỉ override qua field/command riêng có reason và audit, không bỏ kiểm tra âm thầm. Thực thi đơn tuyến/cancel lệnh cũ là lựa chọn tường minh.
7. Source metadata/hashes giữ nguyên sau tạo. Completion không sửa snapshot health/status hoặc lịch công bố, không ghi physical execution acknowledgement giả vào COMMIT.

## 4. State machine bắt buộc

| State hiện tại | Command và state đích | Guard |
| --- | --- | --- |
| Create | UNASSIGNED | ADMIN/ENGINEER, publication/basis hợp lệ |
| UNASSIGNED | ASSIGN → ASSIGNED | Assignee active, OPERATOR/ENGINEER, có membership factory |
| ASSIGNED | ACCEPT → ACCEPTED | Đúng assignee, quyền còn hiệu lực |
| ACCEPTED | START → IN_PROGRESS | Đúng assignee; ghi actual_started_at |
| IN_PROGRESS | BLOCK → BLOCKED | Đúng assignee; reason không trống |
| BLOCKED | RESUME → IN_PROGRESS | Đúng assignee; ghi diễn biến, không reset actual_started_at |
| IN_PROGRESS | COMPLETE → COMPLETED | Đúng assignee; report công việc/kết quả bắt buộc, actual_completed_at |
| COMPLETED | CLOSE → CLOSED | ADMIN/ENGINEER khác người báo hoàn thành; verification/result bắt buộc |
| COMPLETED | REQUEST_REWORK → IN_PROGRESS | ADMIN/ENGINEER khác người báo hoàn thành; reason, giữ báo cáo/vòng thực hiện cũ |
| UNASSIGNED/ASSIGNED/ACCEPTED | CANCEL → CANCELLED | ADMIN/ENGINEER; reason bắt buộc |

- CLOSED/CANCELLED terminal. Hỏng lại tạo incident/work order mới; không xóa completion cũ hoặc reset terminal.
- REASSIGN chỉ ADMIN/ENGINEER, ở ASSIGNED/ACCEPTED/BLOCKED; quay về ASSIGNED, người mới phải ACCEPT. Từ IN_PROGRESS phải BLOCK trước; lưu toàn bộ lịch sử và actual start, không coi lệnh chưa từng chạy.
- Không cho cancel lệnh đã bắt đầu, kể cả BLOCKED sau START. Muốn kết thúc sớm: người phụ trách COMPLETE với outcome STOPPED và lý do; quản lý xác minh rồi CLOSE hoặc yêu cầu rework.
- Rework lưu execution attempt/history; latest completion fields không được làm mất kết quả cũ. Assignee bị revoke/inactive không thao tác; quản lý có thể điều chuyển theo state guard sau khi kiểm tra tình trạng công việc.
- ADMIN không được bỏ qua state guard. Khẩn cấp chưa có command trong contract phải báo unsupported, không thêm status PATCH tự do.
- VIEWER read-only. Mọi command fresh DB user/membership, expected_revision và Idempotency-Key; available_commands chỉ advisory.

## 5. API và HTTP contract

Draft OpenAPI trước implementation, đề xuất:

- GET /api/v1/work-orders?factory_id=…&status=…&assignee_user_id=…&machine_id=…&overdue=…&limit=…&cursor=…
- POST /api/v1/work-orders — source publication/assignment, expected context, optional overlap override theo policy.
- GET /api/v1/work-orders/{id} — source/basis, execution, capabilities và revision.
- POST /api/v1/work-orders/{id}/commands — command discriminated union, expected_revision và input theo state.
- GET /api/v1/work-orders/{id}/events — sequence pagination, history public.

Không nhét API mới vào case /decision command hoặc thêm command COMMIT thứ hai. List query strict, filters AND, machine filter scope factory, stable sort/cursor, bounded limits, case count không dùng cho work-order count. Search chưa cần nếu chưa chốt server contract.

Định nghĩa overdue bằng planned_end_at đã qua và work order chưa terminal; COMPLETED chờ verification phải có chỉ số waiting_verification riêng, không đánh đồng đang sửa máy. Ghi read_at và timezone/units. Thời gian actual elapsed không tự coi là downtime máy hoặc giờ công nếu chưa có nguồn.

Error taxonomy: invalid input, unauthorized, inaccessible 404, role forbidden, stale revision, invalid transition, source plan changed, origin duplicate, overlap, assignee unavailable và DB unavailable. No-store/correlation theo product API hiện có. Không trả stacktrace/private raw artifacts.

## 6. Transactions, idempotency và authorization

- Reuse factory lock/user locks và fresh authorization #46. Thứ tự factory → ordered users → work order/source rows; phối hợp user administration và membership revoke, không tạo deadlock.
- Create đọc current publication sau lock; command row lock + expected_revision. Hai lệnh cạnh tranh không cùng chuyển trạng thái thành công.
- State/event/audit/receipt cùng transaction; rollback không để partial assignment/completion. Receipt scope module+factory+actor+key, hash normalized request; scope khác case receipts có namespace riêng đã chốt.
- Authorization hiện tại chạy trước receipt replay. Lost response lặp cùng body/key trả kết quả gốc không tạo event mới; khác body/key reuse trả 409. Retry lịch sử không được dùng revision cũ để ra command tiếp theo.
- Chống trùng origin và active maintenance request ở DB/transaction, không chỉ find-then-create ngoài lock. Giữ đúng four-version semantics Operations; work_order_revision là token riêng.
- Scoped 404 cho inaccessible ID/list/event; assignee chỉ là User có quyền, không tự cấp membership khi assign. Link API của Flex không được bypass work-order access.

## 7. Kiểm thử và bàn giao

Authenticated HTTP + PostgreSQL thật:

- Happy path từ case COMMIT thật → create → assign → accept → start → block/resume → complete → verification close; có request rework và reassignment.
- Tạo từ uncommitted/simulation/wrong assignment/wrong factory bị chặn; retry không tạo trùng; P2 sau P1 không sửa lệnh P1; overlap/override reason đúng.
- Invalid transitions, self-verification, non-assignee, VIEWER, inactive user, revoked scope và stale revision bị chặn. Thu hồi quyền thắng write/replay không tạo side effect.
- Concurrency: duplicate create, hai assignees nhận việc, complete vs block/reassign, close vs rework, head đổi lúc tạo; receipt/audit rollback có coordinated assertions.
- Thời gian/overdue, filters/cursors, historical machine không còn current snapshot, seed lịch không DecisionCommit và dữ liệu thiếu.
- Fresh migration + populated upgrade từ exact base và integration với migration incident của Flex. Existing Operations/planning/membership regressions giữ pass.

Deliverables: draft PR/contract SHA; ERD/state diagram; implementation/tests; curl workflow và seed 2 factories; OpenAPI/examples + generated HTTP export; CI xanh và evidence theo head. Cung cấp WorkOrderSummary/scope lookup contract sớm cho Flex. Không tự merge.

Ngoài scope: UI work-order đầy đủ, attachments/file storage, kho/phụ tùng/chi phí/ERP, timer tính lương, auto-dispatch, skill certification mapping User–Technician, physical machine control hoặc tự sửa telemetry.
