# Giao Flex — hoàn tất Factory Incident Center

Ngày: 23/10/2026. Owner: Flex. Nhánh mới đề xuất: codex/incident-center-implementation.
Đọc cùng [goal và nghiệm thu chung](2026-10-23-two-module-completion-goals.md).

## Goal bắt buộc

Hoàn thành một Incident Center sử dụng được trên desktop: report/from-case → phân công → tiếp nhận/điều tra → bằng chứng và liên kết case/work order thật → resolve → independent verify/close → reopen khi cần.

GOAL chỉ đạt khi có database, transactional API, UI thật, phân quyền, audit và real-service integration với Work Orders. Policy/evidence projector, OpenAPI, screenshots mock hoặc CI cũ không đủ để báo DONE.

## Baseline và ownership

- #48/#49 đã MERGED, reviewed heads 43f125b/4469b78; main ngày giao f8d94837159ca5fdc1a0f159fc8c28f75e394f7f. Fetch main, ghi exact base, mở PR implementation mới.
- Tái dùng incident-policy.js và incident-evidence.js, strict DTO/evidence examples đã merge. Không viết một bộ rule cạnh tranh trong React hoặc service.
- Flex sở hữu incident models/migration/services/routes, client/hooks, UI desktop, links và E2E. Backend sở hữu Work Orders và lookup; không tự implement work-order tables/commands để giả lập integration.
- [Brief gốc](2026-10-22-flex-factory-incident-center.md) giữ nguyên phạm vi. Chốt evidence đã sửa: case_created_at không phải sensor event time; không bịa event_id/occurred_at đã bị loại khỏi product request.

## FL-C1 — persistence, source dedup và contract thật

1. Implement FactoryIncident, immutable Occurrence/Event, command receipts, case/work-order links và indexes/FKs theo ERD đã review. Reserved migration 20261022020000_factory_incidents nếu chưa có; giữ history migrations.
2. Incident có scope Factory, current owner/revision, severity nullable/proposal, lifecycle, counters/times và latest resolution/closure; prior attempts vẫn nằm trong history.
3. Unique(factory,source_type,source_id) bao gồm CLOSED. Same request/source không sinh incident/occurrence trùng; changed manual report body conflict. Source mới không tự reopen/gộp incident.
4. APPEND_OCCURRENCE phải validate cùng category/factory/machine theo contract; duplicate là no-op đúng revision/count/event behavior; cross-incident source conflict.
5. Evidence server đọc từ authorized immutable source, gọi projector sau integrity validation. Manual report là lời người dùng; case source phải LIVE/HEALTH_ALERT có machine trong basis; không nhận declaration từ client thay source thực.
6. Health samples thiếu là empty; model/time/horizon giữ đúng nguồn, không suy severity hoặc sensor history. Không leak raw request/artifact/private notes/unrelated machine.
7. Đưa draft incidents.openapi.yaml vào backend/openapi.yaml authority; namespace generic schemas để không đè Status/Source/Command của module khác. Cập nhật exporter và regenerate HTTP artifact, tests. Giữ compatibility với các paths đã có.

## FL-C2 — transactional API và quyền

- Implement incidents list/report/summary/detail/commands/events/occurrences/link/unlink theo contract. summary route trước /:id; strict query/body, cursor và no-store.
- Dùng #46 factory access, active DB user, fresh role/owner/membership; ordered locks cùng Backend. State/occurrence/event/audit/receipt atomic, expected_revision và idempotency bắt buộc.
- Wire incident-policy.transition vào transaction thật. Service phải xử lý no-op dedup trước persistence, không tăng revision/count do pure policy mặc định nếu request là no-op.
- Official severity chỉ ADMIN/ENGINEER xác nhận, OPERATOR chỉ đề xuất; close yêu cầu severity confirmed và independent verifier. Owner bị revoke không thao tác, manager có thể reassign/reopen đúng state.
- AVAILABLE_COMMANDS là hint; server enforce lại toàn bộ. Revoke, lost response, concurrent commands, actor downgrade phải kiểm thật trước receipt replay.
- Summary counts trên full scoped factory, tách unconfirmed severity/unassigned/waiting verification; không tính từ page hiện tại, không tự tạo SLA hoặc overdue policy.

## FL-C3 — links với case/Work Orders thật

1. Tái dùng Operations v3, không đi research /decisions. Link generic case thiếu machine evidence có association_scope=case; không dựng machine relation bằng tên/ID demo.
2. Dùng lookupWorkOrderSummaries(tx,user,{factory_id,ids})/API producer do Backend bàn giao. Validate same factory, machine relationship và quyền cả hai đầu trong cùng write boundary.
3. Work order active/COMPLETED chưa terminal chặn resolve/close theo policy, chỉ manager có override reason. Missing/unavailable target fail closed, không override unavailable.
4. Đọc link summary bounded, không N+1; target unavailable hiển thị rõ. Giữ unlink reason/history, không xóa trace.
5. Work order CLOSED không tự đóng incident; close/reopen incident không mutate order, case, publication hoặc telemetry.
6. Trong lúc Backend API chưa sẵn, tiếp tục incident độc lập. Đánh dấu linked acceptance PENDING và giữ PR Draft; không thay bằng fixture/mock rồi ghi PASSED. Khi API_READY, chủ động tích hợp producer SHA vào checkout test riêng.

## FL-C4 — UI desktop đầy đủ

Routes /operations/incidents và /operations/incidents/{id}; thống nhất AppShell/nav với Frontend, giữ một Overview. Phải hoàn thành:

- List với full-factory counts, server search title/description, filters/status/severity/owner/machine, cursor pagination và row navigation. Factory/filter/search bám URL; reload/Back giữ đúng.
- Report manual/from-case, chọn machine/basis đúng scope, severity proposal có nhãn. Không để người dùng gửi actor/time/model tùy ý.
- Detail: state/owner → evidence/provenance → next action → linked case/work orders → history/occurrences.
- Assignment/reassignment, acknowledge, investigate, severity confirmation, append occurrence, resolve, independent close, reopen và link/unlink có forms/reasons/feedback đủ.
- UI command pending/disabled duplicate, conflict và retry/lost-response dùng cùng body/key; không optimistic success hoặc tự đổi key publish/mutate lại.
- Loading/empty/unavailable/permission/integrity/missing evidence riêng, không fixture fallback. Đổi factory abort/ignore request cũ, không scope flash.
- Desktop 1280/1440/1920, keyboard/focus, table alignment/density/sticky header hợp lý, status có text/icon. Có screenshots thật list/form/detail/links/history/error; không mobile redesign.

Incident UI phải hoàn tất trong task này. Full UI thực hiện Work Orders không thuộc Flex; trong linked E2E có thể điều khiển work-order lifecycle qua authenticated Backend API, nhưng report/assign/investigate/link/resolve/verify/reopen incident phải đi qua UI thật.

## FL-C5 — nghiệm thu thực và evidence

| Kịch bản | Cách chứng minh |
| --- | --- |
| Manual end-to-end | UI report → manager assign/severity → owner ACK/investigate → resolve → different manager verify/close → reload/history |
| From-case | LIVE HEALTH_ALERT thật, immutable basis/evidence đúng; SIMULATION_ONLY và spoofed evidence bị chặn |
| Full linked flow | UI incident → case v3/planning/COMMIT thật → Work Order từ publication → link → order thực hiện/close → UI incident resolve/verify/close |
| Incomplete/unavailable order | Active/COMPLETED không bị coi terminal; override reason đúng quyền; unavailable không bypass |
| Recurrence | Duplicate retry không tăng count; source mới append có chủ đích; closed-source không auto-reopen; reopen giữ history |
| Permissions/recovery | Hai factories, all roles, owner/non-owner, revoke/downgrade, user inactive, reassignment; reads/replay không lộ scope |
| Concurrency/integrity | Coordinated duplicate report/append/reopen/links, lost response, stale revision, rollback state/event/receipt, linked check vs order change |
| UI/navigation | Search/filter server thật, counts >page limit, URL commit, Back/reload, delayed factory response, keyboard và errors |

- Backend unit/HTTP/PostgreSQL tests cho incident và client/hook/component tests cho UI phải pass; giữ existing regressions.
- Fresh migration và populated exact-base upgrade có cả hai module; không sửa migration gốc để test pass.
- Real services: PostgreSQL + API + dedicated decision worker + planner FastAPI + Chromium, 3 lần clean-schema liên tiếp trên cùng integrated SHA. Thay code thì bắt đầu lại chuỗi.
- Ghi run result, actual assertions, environment, SHA dependency, logs, screenshots và cleanup. Skip/unavailable không thành passed. Không dùng DB dev hoặc dừng services người khác.
- CI Contracts và Operations integration + frontend build/typecheck xanh ở head cuối. Không chỉ lấy green của PR contract cũ.

## Bàn giao và Definition of Done

PR implementation mới có toàn bộ incident persistence/API/UI/tests; ERD/OpenAPI/example cập nhật; seed/runbook 2 factories và user roles; exact integration SHA gắn Backend Work Orders SHA; evidence 3 runs và ảnh desktop.

Không còn stub/mock ở luồng production critical; UI chạy được report-to-close/reopen và links thật, audit còn sau reload/restart. Các scenario chưa chạy phải ghi PENDING, task chưa DONE. Lỗi incident gây fail linked E2E phải được sửa trước bàn giao cuối.

Trạng thái: IN_PROGRESS → INCIDENT_API_READY → UI_READY → LINKED_INTEGRATION_READY → VERIFIED_DONE. Không báo hoàn thành chỉ vì draft contract đã merge hoặc UI trông hoàn chỉnh.

Không mở thêm threshold scanner, notification/email, attachments, SLA/escalation, custom roles, planner hoặc physical control trước khi goal này đạt.
