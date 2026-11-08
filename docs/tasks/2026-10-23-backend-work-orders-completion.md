# Giao Backend — hoàn tất Maintenance Work Orders

Ngày: 23/10/2026. Owner: Backend. Nhánh mới đề xuất: codex/work-orders-implementation.
Đọc cùng [goal và nghiệm thu chung](2026-10-23-two-module-completion-goals.md).

## Goal bắt buộc

Hoàn thành backend Work Orders để người dùng có quyền thực hiện toàn bộ quy trình qua authenticated API thật: lịch đã COMMIT → tạo lệnh → phân công → nhận việc → bắt đầu → block/resume hoặc chuyển giao → báo hoàn thành → quản lý xác minh đóng/rework.

GOAL chỉ đạt khi database lưu bền vững, server enforce đúng nghiệp vụ/quyền/concurrency, API chạy được qua HTTP + PostgreSQL thật và Flex dùng được WorkOrderSummary/lookup thật để tích hợp incident. Contract, pure guards, mock hoặc unit tests riêng không đủ để báo hoàn thành.

## Baseline và phạm vi

- #48 đã MERGED tại head 43f125b; #49 đã MERGED tại head 4469b78. Main kiểm tra ngày giao: f8d94837159ca5fdc1a0f159fc8c28f75e394f7f; cả hai CI gates của hai PR đều xanh.
- Fetch main khi bắt đầu, ghi exact base SHA. Mở PR implementation mới; không tiếp tục push vào PR đã merge.
- Tái dùng backend/openapi.yaml, backend/docs/work-orders.md, examples và work-order-recovery-policy.js trên main. MANAGER_HOLD và REASSIGN_FOR_REWORK đã có contract/guards, nhưng chưa có persistence hoặc command API.
- Backend sở hữu toàn bộ work-order models/services/routes/migration/tests/seed/runbook. Không xây incident lifecycle hoặc sửa code UI/Flex ngoài phần handoff được phối hợp.
- Giữ phạm vi nghiệp vụ chi tiết trong [brief gốc](2026-10-22-backend-maintenance-work-orders.md); contract recovery mới trên main thay quy tắc cũ không cho quản lý phục hồi lệnh đang chạy.

## BE-C1 — persistence thực, migration và integrity

1. Implement Prisma models/migration WorkOrder, immutable events/completions/command receipts và các quan hệ/audit đã chốt. Dùng migration reserved 20261022010000_maintenance_work_orders nếu chưa tồn tại; không sửa migration lịch sử.
2. FK bảo đảm source publication/case/schedule/basis cùng factory; assignment/machine/request phải được đối chiếu canonical immutable payload thật. Không dùng UUID/text bất kỳ rồi coi là source đã COMMIT.
3. Unique origin và active request; kiểm overlap/override reason theo contract trong transaction. Không để retry hoặc hai requests đồng thời sinh hai lệnh cho cùng công việc.
4. Tách source/planned immutable với execution state. P2/S2 không sửa lệnh P1/S1, actual timestamps hoặc completion history. Không hard-delete và không cập nhật telemetry để ghi nhận sửa xong.
5. Revision/state/history/receipt/audit đồng bộ ở DB; bổ sung constraints/guards đủ để không tồn tại source scope sai hoặc mất lịch sử. Có indexes cho list/query, không N+1.
6. Fresh và populated upgrade từ exact base giữ nguyên snapshots/hashes/schedules/cases/receipts/memberships/audit. Chuẩn bị chạy cả migration incident trên integration branch.

## BE-C2 — API đọc và lookup cho Flex

- Implement thật các Work Orders paths đã có trong OpenAPI: create/list/detail/commands/events/summaries. Không dựng một API khác bên cạnh contract đã merge.
- Ưu tiên bàn giao lookupWorkOrderSummaries(tx,user,{factory_id,ids}) và endpoint bulk summaries trước command UI integration. Bounded <=50, input order, scope đúng, all-or-nothing 404 theo contract; không expose reports/private notes.
- Reads require active user + factory access #46, trong consistent read transaction; VIEWER chỉ đọc. GET không sinh order/event/receipt.
- List filters, overdue cutoff, microsecond cursor, events sequence và missing historical machine đúng contract. Không fake totals từ trang đầu hoặc coi elapsed time là downtime.
- Trả lỗi unavailable/integrity/permission đúng envelope; no-store/correlation. Lookup lỗi không được biến thành CLOSED hoặc không tồn tại.
- Cung cấp real two-factory seed và curl sớm cho Flex, kèm PR/head SHA và contract không thay đổi.

## BE-C3 — command service và lifecycle đầy đủ

Implement server-side toàn bộ ASSIGN, ACCEPT, START, BLOCK, RESUME, COMPLETE, CLOSE, REQUEST_REWORK, CANCEL, REASSIGN, MANAGER_HOLD và REASSIGN_FOR_REWORK.

- Chạy pure recovery guards hiện có bên trong write transaction sau fresh auth/lock; không chỉ export hàm rồi gọi là đã hỗ trợ recovery.
- MANAGER_HOLD: quản lý hold IN_PROGRESS, ghi actor/reason thật; không mạo danh assignee. Sau đó reassign → người mới ACCEPT → START; giữ actual_started_at/history.
- REASSIGN_FOR_REWORK: independent manager xử lý COMPLETED, giao người mới đủ quyền, tăng attempt và giữ completion cũ; không xác minh giả hoặc regrant assignee cũ.
- Mọi command có expected_revision, strict discriminated body, idempotency receipt và state guards; server sở hữu actor/time. Không có status PATCH tự do.
- Assignee là User active OPERATOR/ENGINEER có factory scope, tách canonical Technician. Quyền manager không bỏ qua independent verification/role/state checks.
- BLOCK/STOPPED/CANCEL/verification/rework/reassignment giữ reason/report bắt buộc và attempt history. Không cancel work đã bắt đầu bằng cách reset start timestamp.

## BE-C4 — concurrency, quyền và retry

- Dùng factory advisory lock và ordered user locks #46. Fresh user/role/membership checks trước receipt replay và sau khi chờ lock; row locks/revision kiểm command.
- Create đọc current head/publication sau lock. Kế hoạch đổi lúc tạo trả conflict; không lặng lẽ tạo trên lịch cũ.
- State/event/completion/audit/receipt cùng transaction. Ép fail ở giữa phải rollback toàn bộ.
- Same actor/factory/key/body trả historical response như contract, không thêm event. Key reuse khác operation/body/target trả 409. Revoke, role downgrade và reassignment vẫn phải được kiểm trước replay.
- Coordinated races bằng PostgreSQL connections thật: duplicate create; commit-head vs create; competing commands; revoke vs recovery/write/replay; close vs rework. Không thay bằng delay ngẫu nhiên hoặc mock lock.

## BE-C5 — kiểm chứng thực tế và bàn giao

Backend phải tự chạy, không đẩy toàn bộ kiểm chứng sang Flex:

| Kịch bản | Kết quả cần chứng minh |
| --- | --- |
| Happy path | Case thật APPROVE/COMMIT → order → assign/accept/start → complete → independent close; reload đọc lại đúng DB |
| Recovery đang làm | Assignee bị revoke/inactive sau START → manager hold → reassign → người mới tiếp tục; không restore quyền cũ |
| Recovery rework | Completion không đạt và assignee cũ không còn quyền → người xác minh khác reassign-for-rework → báo lại → close |
| Source | Uncommitted/simulation/production assignment/wrong factory bị chặn; P2 không rewrite lệnh P1 |
| Permissions | VIEWER, non-assignee, self-verifier, inactive/revoked actor và stale revision bị chặn, không partial side effect |
| Data/navigation | List filters/cursors/events, overdue/waiting verification, machine đã mất khỏi current snapshot, unavailable/integrity |
| Integration | Flex gọi real summary/lookup và link incident đúng factory/machine; migration kết hợp không lỗi |

Deliverables bắt buộc:

- PR implementation mới, exact base/head và dependency SHA.
- Migration + complete API/service implementation; OpenAPI/examples/export cập nhật nếu có additive change được phối hợp.
- Runbook từ database sạch: setup, seed hai factories, users/grants, tạo source publication thật và curl full workflow/recovery; dùng credentials test.
- Test logs cho unit/HTTP/PostgreSQL/concurrency/fresh-upgrade; CI Contracts và Operations integration xanh trên head cuối. Không tính skip thành pass.
- Handoff Flex gồm callable service signature, DTO examples và seed IDs thực trong môi trường test; không chỉ gửi đường dẫn tài liệu.

## Definition of Done và giới hạn

Không còn API stub/not-implemented, mock fallback hay TODO ở critical lifecycle/recovery. Quy trình và hai recovery paths chạy được bằng HTTP thật, survives restart/reload, có audit và đúng quyền. Hai module chạy cùng một schema sau upgrade; lỗi Backend phát hiện trong linked E2E phải được xử lý trước báo DONE.

Backend không phải xây full Work Order UI trong task này. Đó là phạm vi Frontend riêng; không được dùng việc chưa có UI để bỏ kiểm API thật. Không mở thêm ERP, attachments, stock/cost, SLA, auto-dispatch, planner hoặc machine control.

Trạng thái bàn giao: IN_PROGRESS → API_READY → INTEGRATION_READY → VERIFIED_DONE. Chỉ VERIFIED_DONE khi có đủ evidence; merge code hoặc CI unit xanh không tự chuyển sang DONE.
