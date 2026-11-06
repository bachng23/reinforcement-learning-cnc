# Backend — P0: Overview có dữ liệu authoritative

Bản giao việc ngày 20/10/2026. Đọc cùng [kế hoạch chung](../progress-and-team-assignments-2026-10-20.md). Baseline: main 64dc391, PR #44 đã merge và CI xanh. Nhánh đề xuất: codex/operations-overview-api, checkout riêng. Không tự merge.

## Kết quả cần bàn giao

Một GET /api/v1/operations/overview?factory_id=… đủ để Overview hiển thị tổng trạng thái nhà máy, số case cần xử lý và preview case chờ phê duyệt. Mỗi số liệu có định nghĩa kiểm chứng được; mỗi item mở đúng case v3.

Backend sở hữu routes/services, auth, OpenAPI, HTTP exporter, examples, migrations cần thiết và backend tests. Flex sở hữu frontend transport DTO/client/hook; Frontend sở hữu màn hình. Không tạo bản enum/schema domain cạnh tranh.

## BE-01 — công khai và chốt contract trước

Mở draft PR ngay ở commit contract đầu tiên; chưa cần đợi API hoàn thành. Bàn giao OpenAPI diff, response example và SHA cho hai nhóm còn lại.

Contract mới là HTTP extension additive của v3, không đổi ý nghĩa fields cũ. Những nhóm thông tin dưới đây là yêu cầu sản phẩm; tên field/nesting cuối phải được chốt trong OpenAPI và examples trước khi consumer triển khai:

| Nhóm | Bắt buộc định nghĩa |
| --- | --- |
| Context | factory_id, snapshot_id hiện tại, published plan_version, head revision, captured_at, read_at |
| Machines | Tổng máy và counts đủ sáu canonical statuses; nguồn là snapshot hiện tại đã validate |
| Cases | Counts theo lifecycle và processing, tách LIVE/SIMULATION_ONLY; phạm vi stale và terminal ghi rõ |
| Review preview | Case AWAITING_APPROVAL ở LIVE, giới hạn mặc định 6, thứ tự created_at DESC rồi UUID DESC, has_more và filter để mở danh sách đầy đủ |
| Provenance/coverage | Nguồn/thời điểm/coverage của phép đo được trả; null và unavailable được mô tả rõ |
| Errors | Canonical read Operations error cho route mới; auth, strict query validation, no-store và HTTP codes có example |

- Giữ query endpoint này đơn giản: chỉ factory_id theo contract; query thừa/lặp/sai kiểu bị từ chối. Không thêm pagination hoặc bộ lọc tuỳ tiện vào endpoint tổng quan.
- Preview phải có case UUID, factory, mode/status, timestamps, case_revision, basis snapshot/base plan, current context, stale và recommendation identity nếu có; tái dùng projection đã sanitize của list.
- Cases count phải bao phủ đầy đủ dữ liệu trong factory, không phụ thuộc preview hay limit của GET /decision-cases.
- “Cần phê duyệt” là AWAITING_APPROVAL/LIVE, bao gồm stale nếu được liệt kê nhưng stale phải được đánh dấu, không được hiểu là có thể APPROVE ngay. “Đã duyệt, chưa công bố” là APPROVED/LIVE. “Lỗi xử lý” dựa trên processing FAILED, không đánh đồng mọi lỗi HTTP với lifecycle FAILED.
- “Đang xử lý” dựa processing PENDING/RUNNING, có scope mode rõ; đây là số case, không phải số agent. Không cộng lifecycle và processing counts thành tổng vì hai chiều có thể chồng lấn.
- Định nghĩa stale_active_count nếu cần: stale trong tập trạng thái chưa kết thúc được liệt kê chính xác trong contract; các case terminal vẫn giữ stale trên item nhưng không thành “việc đang chờ”. Không tự thêm trạng thái ngoài schema.
- read_at là thời điểm đọc, không phải telemetry freshness hoặc concurrency token. head revision cũng không chứng minh case counts chưa đổi: worker/case lifecycle có thể thay đổi khi factory head không đổi.

## BE-02 — read model nhất quán và có kiểm soát

1. Tái dùng authorization hiện có: authenticated active user + factory access; VIEWER được đọc; không tin actor/role do client gửi. Scope isolation áp dụng cả aggregates, preview và thông báo lỗi.
2. Đọc head, immutable snapshot reference, counts và preview từ cùng database read snapshot. Dùng transaction/isolation phù hợp, tránh N+1 và không giữ transaction trong lúc gọi validator bên ngoài nếu không cần.
3. Snapshot phải qua schema/hash/integrity checks hiện có. Nếu kiểm tra immutable artifact sau transaction, artifact được chọn bằng immutable identity từ read snapshot; không đọc lại mutable head rồi ghép với counts cũ.
4. Giữ current observation tách khỏi published schedule basis. P1 dựa S1 vẫn giữ S1 sau ingest S2; endpoint Overview không viết lại schedule hoặc rebase case.
5. Không có dữ liệu snapshot phải có HTTP/empty behavior chốt trước và tương thích client. Factory không được truy cập không được lộ qua một response “empty” đặc biệt. Corrupt artifact/validator unavailable/DB unavailable không thành snapshot rỗng thành công.
6. Không trả raw request/artifact, ghi chú riêng, lease token, secret hoặc stacktrace. Không thay đổi projection public của endpoints cũ ngoài scope.
7. Nếu cần health aggregate: định nghĩa population, đơn vị 0..1, missing denominator, observed_at và coverage. Nếu chưa có nhu cầu/nguồn đáng tin thì bỏ metric; không thêm chỉ để đủ card.
8. Không sinh failure risk từ health; không gọi load_factor là utilization. Không tạo history từ một snapshot, không lấy maintenance-window count hoặc agent-run count từ dữ liệu không tương đương.
9. Đảm bảo bounded payload và query plan hợp lý cho aggregate toàn factory; tránh materialize toàn bộ case/artifact vào Node chỉ để đếm. Nếu cần index, thêm migration mới, giữ nguyên history migrations.

## BE-03 — cập nhật tài liệu sinh tự động

- Sửa backend/openapi.yaml làm nguồn HTTP; thêm overview vào PATHS của backend/scripts/export-operations-http-contract.js và cập nhật test exporter nếu có.
- Chạy exporter để sinh contracts/v3/operations-http.openapi.json, cập nhật số endpoint và ngữ nghĩa additive trong contracts/v3/p0-contract.md. Không sửa tay artifact JSON.
- Thêm example/runbook theo cấu trúc hiện có của backend, gồm factory có dữ liệu, không publication, missing health và unavailable.
- Domain schema 3.0 giữ nguyên nếu chỉ thêm HTTP summary. Nếu thực sự phải đổi domain, tách lý do và phối hợp consumer; không regenerate hàng loạt types không liên quan.

## BE-04 — kiểm thử và tiêu chí nghiệm thu

- Authenticated HTTP + PostgreSQL thật: ADMIN, scoped non-admin, VIEWER và inaccessible factory; không lộ counts qua unauthorized path.
- Tập case lớn hơn page limit với đủ mode, lifecycle, processing, stale và terminal; so từng bucket với dữ liệu lưu, preview đúng thứ tự/limit/has_more.
- Machine counts có đủ sáu trạng thái, missing measurements và factory không publication; không coi unknown là healthy hoặc 0.
- Counts đổi sau create, worker success/failure, APPROVE, REJECT và COMMIT. Đặc biệt kiểm worker đổi case trong khi head revision không đổi.
- Concurrent ingest/commit/read: response chỉ là một tổ hợp hợp lệ của một read snapshot. Dùng kiểm thử phối hợp concurrency có assertion, không chỉ gọi vài requests tuần tự.
- S1/P1 → S2 giữ đúng observation/basis; corrupt/hash mismatch/validator hoặc DB unavailable trả đúng nhánh lỗi.
- GET lặp lại không tạo event, receipt, case hay publication. Existing idempotency/race/rollback tests tiếp tục pass.
- Chạy backend unit/HTTP/integration suites liên quan, contract checks và HTTP exporter --check. Có migration thì phải qua fresh/upgrade/history gate hiện có.

## Bàn giao hoàn tất

Draft PR URL + head SHA; contract SHA dùng chung; OpenAPI/examples; bảng định nghĩa từng count; curl đọc thực tế; test commands/logs; thay đổi migration/index nếu có; điểm chưa hỗ trợ. Ghi rõ payload đã thực thi qua API hay chỉ mới là contract draft.

Không sửa frontend page/hook, worker lifecycle, APPROVE/COMMIT semantics, error format toàn hệ thống, planner, history API hoặc auto-trigger case. Không chờ Frontend xong mới bàn giao BE-01.
