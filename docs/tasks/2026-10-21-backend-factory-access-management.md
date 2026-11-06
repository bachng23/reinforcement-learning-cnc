# Backend P1 — Factory registry và quản lý quyền truy cập nhà máy

Ngày giao: 21/10/2026. Owner: Backend. Nhánh đề xuất: codex/factory-access-management.
Đây là brief để người dùng chuyển cho Backend; chưa gửi tin nhắn hoặc tạo GitHub issue.

## 1. Mục tiêu và đầu ra

Xây dựng hoàn chỉnh chức năng quản lý factory và quyền truy cập qua database/API. Admin có thể tạo factory, xem/cấp/thu hồi membership; người dùng lấy danh sách factory được phép truy cập. Tất cả Operations reads/writes dùng cùng một authorization service.

Người dùng đồng ý tạo bảng Factory riêng và yêu cầu thiết kế database hợp lý. Không giới hạn membership vào OperationsHead: factory phải tồn tại độc lập trước khi ingest snapshot đầu tiên.

Đầu ra: draft PR contract-first, ERD, migration/backfill, API, import tool, PostgreSQL integration tests và runbook triển khai/rollback. Không tự merge.

Baseline tham chiếu: main 64dc391 và Overview API PR #45 tại head đã review 9404ecb. Khi bắt đầu, fetch main mới nhất và ghi base SHA thực tế. Nếu #45 chưa merge, khai báo dependency hoặc nhánh stacked rõ, không tự merge #45. Giữ nguyên các thay đổi local AI/frontend ngoài scope.

## 2. Quyết định phân quyền

Giữ User.role toàn hệ thống hiện tại. Membership chỉ biểu thị quyền vào factory, không thêm role theo factory, role tùy chỉnh hoặc permissions JSON.

| Chủ thể | Danh sách/detail factory | Operations reads | Create/APPROVE/REJECT/COMMIT | Quản trị factory/membership |
| --- | --- | --- | --- | --- |
| Active ADMIN | Mọi factory | Có | Theo các guard nghiệp vụ hiện có | Có |
| Active VIEWER + membership active | Factory được cấp | Có | Không | Không |
| Active OPERATOR/ENGINEER + membership active | Factory được cấp | Có | Theo các guard nghiệp vụ hiện có | Không |
| Non-admin chưa được cấp/đã thu hồi | Không thấy factory đó | Không | Không | Không |
| User inactive/token không hợp lệ | Không | Không | Không | Không |

- ADMIN không cần một membership giả cho từng factory. Membership của ADMIN nếu tồn tại không thu hẹp quyền global; có hiệu lực nếu user sau này đổi sang role non-admin.
- Không tin role, actor, timestamps hoặc grants từ JWT payload/body; kiểm user đang active và role từ DB theo cơ chế auth hiện tại.
- Thu hồi membership không sửa role User, không xóa case, không thay actor/history/publication. Role global không bị nâng cấp bởi API membership.
- Không cấp quyền bằng việc biết factory ID hoặc tạo ra ID tương tự. Snapshot/case/schedule của factory khác không được lộ qua endpoint detail.

## 3. BE-01 — thiết kế dữ liệu và migration

Đề xuất mô hình tối thiểu dưới đây; Backend được điều chỉnh physical naming/indexes nếu có lý do, nhưng phải giữ semantics và công khai ERD trước implementation:

| Bảng | Dữ liệu và ràng buộc |
| --- | --- |
| Factory | factory_id là khóa chính string/opaque, giữ nguyên ID hiện có; name để hiển thị; created_at/updated_at do server tạo |
| FactoryMembership | ID ổn định; factory_id FK Factory; user_id FK User; unique(factory_id,user_id); active; granted_by/granted_at; revoked_by/revoked_at; created_at/updated_at |
| Audit | Sự kiện FACTORY_CREATED, FACTORY_UPDATED, FACTORY_ACCESS_GRANTED/REVOKED; actor, target user, factory, trước/sau và thời điểm; lưu bền vững |

- Revoke giữ row membership để còn trace; regrant cập nhật row hiện có, không tạo trùng. Audit giữ các lần cấp/thu hồi trước đó; fields granted/revoked trên membership mô tả trạng thái/lần chuyển gần nhất.
- granted_by/revoked_by tham chiếu user quản trị khi thao tác HTTP; import có actor/source hệ thống rõ, không giả danh một admin. Check constraints bảo đảm trạng thái và các timestamp hợp lệ.
- Tái sử dụng AuditLog nếu phù hợp; có thể thêm EntityType bằng migration mới. Nếu tách access event table phải giải thích lý do, tránh hai nhật ký cạnh tranh. Không cho sửa/xóa audit qua API này.
- Xem toàn bộ bảng đang mang factory_id: FactorySnapshot, OperationsHead, OperationSchedule, DecisionCase, receipt/publication và các bảng liên quan. Lập bảng mapping khóa ngoại trực tiếp hoặc đường bảo đảm integrity; không thêm FK kép thừa nếu quan hệ cha đã bảo đảm.
- Backfill registry từ hợp đầy đủ factory_id ở dữ liệu Operations hiện hữu, không chỉ head. Không bỏ factory lịch sử không còn head. name ban đầu có thể bằng factory_id, không bịa địa điểm/tên nhà máy.
- Giữ nguyên composite keys, hashes, opaque snapshot/candidate IDs, schedule basis và published plan versions. Không rewrite JSON canonical để thêm tên factory.
- Thứ tự migration: tạo registry → backfill/kiểm tra dữ liệu → tạo membership/indexes → thêm/validate FKs theo quan hệ đã thiết kế. Phát hiện orphan/inconsistent scope thì fail với chẩn đoán phù hợp, không xóa dữ liệu để migration pass.
- Dùng Restrict/NoAction phù hợp cho dữ liệu lịch sử, không cascade xóa snapshots/cases/audit khi xóa factory/user. Không cung cấp hard-delete factory trong task này.
- Index tối thiểu cho lookup user + active factories, factory + members, unique membership và pagination. Có giải thích query plan, tránh N+1.
- Chỉ thêm migration mới. Phải pass fresh DB, populated upgrade và migration-history checks. Schema domain Python 3.0 không đổi chỉ vì thêm registry/membership trong product database.

## 4. BE-02 — contract API

Commit đầu tiên công khai OpenAPI, DTO/examples, pagination, error codes và ERD để Frontend/Flex đọc. Các đường dẫn dưới đây là contract đề xuất cần freeze trong draft PR trước consumer integration:

| API dưới /api/v1 | Quyền và hành vi |
| --- | --- |
| GET /factories | Active user; ADMIN thấy tất cả, non-admin chỉ membership active; trả factory_id, name, has_snapshot và metadata cần thiết đã chốt |
| GET /factories/{factory_id} | Detail tối thiểu theo scope; có thể đọc factory được cấp dù chưa có snapshot |
| POST /factories | ADMIN; body strict factory_id + name; 201; factory ID trùng trả 409 |
| PATCH /factories/{factory_id} | ADMIN; chỉ đổi name; ID bất biến, không PATCH role/status/owner tùy ý |
| GET /factories/{factory_id}/members | ADMIN; danh sách phân trang, trạng thái active/revoked, user summary tối thiểu và provenance cấp/thu hồi |
| PUT /factories/{factory_id}/members/{user_id} | ADMIN; cấp/regrant membership, body không nhận actor/role/time; trả trạng thái cuối và changed |
| DELETE /factories/{factory_id}/members/{user_id} | ADMIN; revoke logic, giữ row/audit; trả trạng thái cuối và changed |

- Quy định rõ query/filter, stable sort, limit và cursor. Gợi ý GET /factories theo factory_id ASC; members theo user_id ASC; cursor opaque gắn đúng scope/filter/actor, bounded page limit. Không cần server-side search trong vòng này.
- Factory đã tạo nhưng chưa ingest vẫn hiện với has_snapshot=false. Các API snapshot/overview hiện hữu giữ hành vi thiếu head, không trả snapshot giả. Factory registry tồn tại không có nghĩa dữ liệu telemetry đã sẵn sàng.
- factory_id dùng identifier rule Operations hiện có; user_id là UUID. name trim, nonblank, giới hạn độ dài trong OpenAPI. Reject fields/query thừa, repeated query và body sai kiểu.
- PUT đang active và DELETE membership đã revoked/chưa từng cấp là no-op thành công với changed=false; không tạo thêm grant/revoke audit hoặc đổi timestamp. Target factory/user không tồn tại vẫn 404.
- Regrant user inactive bị từ chối bằng lỗi 409 được định nghĩa; revoke user inactive vẫn được. Membership có thể tồn tại sau khi user bị deactivate, nhưng không cho phép truy cập.
- Membership endpoints chỉ ADMIN; kiểm role trước khi lookup đối tượng để non-admin không dùng chúng dò user/factory. User summaries không chứa password hash, token, email không cần thiết hoặc full user record.
- Missing/inaccessible factory trả cùng public 404 cho scoped reads; case IDs ngoài quyền vẫn giữ DECISION_CASE_NOT_FOUND như hiện tại. Không có quyền action do role trả 403 theo contract hiện hữu.
- API mới dùng product success/error envelope hiện có; định nghĩa request correlation ID, Cache-Control: no-store cho success/error và 400/401/403/404/409/503. Không đổi đồng loạt hai error formats Operations đang triển khai.
- Audit và trạng thái thay đổi phải atomic. HTTP response bị mất: lặp PUT/DELETE đạt cùng trạng thái, không duplicate side effects. Nếu có concurrent grant/revoke, serialization quyết định thứ tự; báo changed theo trạng thái thực trong transaction.

## 5. BE-03 — authorization service và concurrency

- Tách factory-access service dùng chung; không để route tự parse grants hoặc truy vấn membership theo cách riêng.
- Thay hàm authorizeFactory hiện đồng bộ bằng async DB lookup. Cập nhật và await đầy đủ mọi call site, đặc biệt accessible() đang catch 404, case create, command transaction, list/events/recommendation và Overview mới.
- Service hỗ trợ Prisma transaction client. Đưa kiểm scope vào read transaction khi endpoint cần consistency; không mở query qua global Prisma ngoài transaction rồi coi là cùng read snapshot.
- Mỗi request mới sau khi revoke đã commit phải thấy mất quyền. Không cache grants theo session/token hoặc trong process. DB lỗi phải fail closed bằng unavailable, không dùng env fallback.
- Với writes: reuse cùng factory advisory-lock protocol đang dùng cho ingest/create/decision. Grant/revoke và case create/decision kiểm membership sau khi lấy lock trong cùng transaction; authorization chạy trước cả idempotency receipt replay.
- Nêu lock order thống nhất, xử lý trường hợp membership chưa có row và tránh deadlock. Chỉ check trước transaction là chưa đủ: request có thể chờ lock trong lúc admin đã revoke.
- Semantics concurrency: nếu revoke thắng serialization, write/receipt replay phía sau bị từ chối và không có side effect; nếu write thắng trước, write hoàn tất hợp lệ rồi revoke có hiệu lực cho lần sau. Read đã bắt đầu trên snapshot trước revoke có thể hoàn tất; không hứa hủy dữ liệu đã gửi.
- Giữ requireAuth cho user active/global role. Role bị hạ/user inactive phải được kiểm lại theo consistency/locking phù hợp ở write boundary; ghi rõ thứ tự với user administration và test hành vi, không tin req.user cũ để vượt quyền.
- Worker là tiến trình hệ thống: thu hồi quyền người tạo không tự cancel/rewrite case đã được nhận. Worker có thể hoàn tất recommendation, nhưng người mất quyền không được đọc/approve/commit. Không thay worker lifecycle hoặc impersonate actor.
- Rà cả snapshot, overview, current schedule, create/list/detail/events/recommendation/commands và từng polling request. Research endpoints không có factory scope không tự đưa vào mô hình này.

## 6. BE-04 — registry và ingest/seed

- API quản trị tạo registry độc lập, không tạo snapshot/head giả.
- Chốt hành vi ingest khi factory chưa đăng ký: đường ingest thông thường phải yêu cầu registry tồn tại và trả lỗi rõ; seed/bootstrap CLI tin cậy có thể ensure registry tường minh, có audit/source và transaction phù hợp.
- Cập nhật seed/reset/demo/integration harness hiện có để tạo factory registry trước dữ liệu con; không làm gãy canonical demo hoặc dev startup.
- Snapshot mới không ghi đè Factory.name do admin quản lý. Không thêm route ingest public hoặc auto-create factory khi user GET/cấp membership.
- Reset công cụ test phải xử lý FK đúng thứ tự, chỉ tác động factory/schema test được chỉ định; không cascade hoặc sweep DB dev để chạy test.

## 7. BE-05 — chuyển grants hiện tại sang database

Không yêu cầu vận hành chuyển mọi instance đồng thời. Thiết kế rollout hai chế độ tường minh, ví dụ FACTORY_ACCESS_SOURCE=environment|database; không union/intersect hai nguồn trong một quyết định authorization.

1. Deploy additive schema/backfill và code hỗ trợ mode. Runbook ghi default và giá trị bắt buộc ở mỗi giai đoạn; có validation cấu hình lúc startup. Target cuối là database.
2. Cung cấp import CLI có dry-run mặc định và apply tường minh; đọc legacy OPERATIONS_FACTORY_ACCESS, không in raw environment hoặc secrets.
3. Validate toàn bộ input trước write: shape, factory registry tồn tại, user UUID và user tồn tại. Unknown entry thì báo lỗi và không import một phần. Deactivated users báo rõ, không activate user.
4. Import lặp không tạo membership/audit trùng. Đặc biệt không dùng lại grants cũ để tự regrant membership đã bị thu hồi trong database: mặc định chỉ tạo entry chưa có, giữ trạng thái hiện hữu và báo conflicts.
5. Apply atomic trong phạm vi import đã định nghĩa; nhật ký import có source/run ID, counts và kết quả, không sửa user roles hoặc dữ liệu Operations.
6. Trong environment mode, API quản trị membership phải báo 503/mã lỗi mode rõ thay vì ghi DB rồi giả vờ quyền đã đổi. GET /factories phải phản ánh đúng nguồn authorization đang bật, lọc qua registry.
7. Quiesce grant changes khi đối chiếu/cutover; toàn bộ API instances dùng cùng mode trước khi bật quản trị DB. Chỉ báo cutover xong khi mọi instance đã chuyển. Không dùng malformed env, DB outage hoặc missing membership làm lý do tự fallback.
8. Rollback không đơn giản bật lại env cũ: grants đó có thể khôi phục quyền đã revoke. Runbook phải yêu cầu đối chiếu/export quyền hiện tại và phối hợp chuyển toàn bộ instances. Không drop registry/membership/audit để rollback code.

## 8. BE-06 — kiểm thử bắt buộc

| Nhóm | Assertion |
| --- | --- |
| Registry | Tạo factory chưa có snapshot, rename không đổi ID/basis/hash; unknown/duplicate/invalid input đúng errors |
| Role/scope | Ít nhất 2 factories; ADMIN, VIEWER, OPERATOR, ENGINEER, inactive user; không cross-factory reads/writes hoặc user enumeration |
| Membership | Grant/revoke/regrant, duplicate PUT/DELETE, inactive target, mất response rồi retry; timestamps/changed/audit đúng |
| Async migration | Không call site bỏ await hoặc swallow DB outage; tất cả endpoint/polling dùng source đúng |
| Revocation | Session còn hạn vẫn mất quyền ngay ở request mới; replay receipt cũng bị chặn; user deactivated/role downgraded không được mutate |
| Concurrency | Coordinated revoke vs create/APPROVE/COMMIT/replay trên connections thật; kiểm cả hai thứ tự serialization, không side effect khi revoke thắng |
| Audit atomicity | Ép fail transaction: không membership đổi mà thiếu audit hoặc ngược lại; no-op không tăng audit |
| Historical data | Backfill nhiều factory kể cả chỉ có lịch sử; counts, S2/P1 basis S1, receipts, events, canonical hashes và publication giữ nguyên |
| Import/cutover | Dry-run không ghi; malformed/orphan abort; apply lặp; revoked conflict không bị regrant; mode mismatch không trả success giả; không fallback |
| Regression | Existing stale/race/idempotency/SIMULATION_ONLY/worker/schedule và user administration tests tiếp tục pass |

Tests phải đi qua authenticated HTTP + PostgreSQL thật, không chỉ mock authorizeFactory. Migration có fresh DB + populated upgrade từ exact base SHA và history gate. Dùng DB/schema riêng, cleanup khi pass/fail/interrupt, không dừng services hoặc dùng DB dev của người khác.

## 9. Thứ tự bàn giao và Definition of Done

1. Draft PR đầu: ERD, role matrix, OpenAPI/examples, migration/rollout plan và dependency SHA.
2. Implementation: registry + migrations/backfill + async auth + membership APIs/audit + seed/import.
3. Evidence: unit/HTTP/PostgreSQL/concurrency/migration results; contract/export checks; CI Contracts và Operations integration xanh ở head cuối.
4. Handoff Frontend/Flex: PR/head SHA, curl cho list/create/grant/revoke, 2-factory test setup, error/mode semantics và API pagination. Không sửa frontend trong PR Backend.

Hoàn tất khi Admin quản lý factory/membership qua API được, non-admin chỉ thấy đúng factories được cấp, revoke chặn request/write/replay theo semantics đã chốt, và nâng cấp DB không làm thay đổi dữ liệu quyết định/lịch sử. Kèm runbook cutover/rollback có thể thực thi.

Ngoài scope: UI admin mới, custom roles theo factory, tổ chức nhiều tenant, invitations/email/SSO, đổi token/session system, hard-delete/archive factory, sensor history, What-if, MODIFY, planner/LLM/RL hoặc machine control. Đây là P1 riêng; không làm lại Overview API #45 và không chặn Frontend/Flex dùng contract Overview đã chốt.
