# Backend — P0: nguồn dữ liệu thống nhất cho Overview

> Bản lịch sử. Dùng [brief Backend ngày 20/10/2026](2026-10-20-backend-overview-api.md) thay cho bản này; PR #44 đã merge vào main.

Ngày giao: 18/10/2026. Bản giao việc để người dùng chuyển cho nhóm Backend.

## Baseline và phạm vi

Main đã kiểm tra: 07033e3, có case discovery, audit, worker, APPROVE/REJECT/COMMIT và publication. Bắt đầu từ main mới nhất trong checkout riêng; giữ nguyên mọi thay đổi local của người khác. Nhánh đề xuất: codex/operations-overview-api. Không làm lại các chức năng đã có. Không sửa frontend hoặc browser harness. Không tự merge PR.

Frontend hiện nằm ở frontend-redesign@fc43787: đã redesign, chỉ còn một Overview trong sidebar, Factory resources là trang chi tiết tại /operations. Overview vẫn dùng fixture; lần này cần dữ liệu authoritative để nối vào giao diện đó.

Contract tham chiếu: [PR #44](https://github.com/bachng23/reinforcement-learning-cnc/pull/44), head 5f16f3d. PR đang OPEN, Contracts pass, Operations integration fail; chưa được coi là baseline đã merge. Dùng OpenAPI và các service đang có trên main làm nguồn triển khai, đối chiếu tài liệu P0 trong PR. Không tạo dependency âm thầm vào code chưa merge.

## Mục tiêu

Cung cấp dữ liệu Overview theo một factory, đủ cho số liệu tổng quan và danh sách case cần chú ý, có context/version/provenance rõ. Người dùng click đúng case và đi tiếp vào luồng Operations v3 hiện có.

## Công việc

1. Chốt additive HTTP endpoint GET /api/v1/operations/overview?factory_id=… . Commit đầu tiên phải có OpenAPI, DTO/example response và định nghĩa từng số đếm để Frontend/Flex làm song song. Thống nhất error envelope canonical như nhóm read Operations; kiểm cả authentication, no-store và strict query validation.
2. Trả factory_id, current snapshot_id, published plan_version, head revision, captured_at và read_at. Các số liệu/head/case preview phải được đọc nhất quán trong cùng read transaction. Công khai các token cần đối chiếu khi frontend đọc thêm snapshot/schedule; không hứa case_revision thay cho factory head revision.
3. Có machine counts theo canonical status; số case theo lifecycle; số case đang được xử lý dựa trên processing state. Định nghĩa rõ phạm vi LIVE/SIMULATION_ONLY, case stale, terminal states và dữ liệu thiếu. Không dùng số item trên trang đầu làm tổng số case. Không gọi processing cases là số specialist-agent runs.
4. Có preview case giới hạn, sort xác định, case UUID, mode/status, revision, basis/current context, stale và recommendation identity nếu có. Tái dùng projection/authorization của case list; ghi rõ giới hạn và còn dữ liệu để mở danh sách đầy đủ. Không expose raw request/artifact, notes hoặc lease. Không đổi API phân trang hiện có.
5. Health/risk chỉ lấy từ dữ liệu authoritative có provenance. Thiếu thì null/unknown kèm coverage; không suy risk từ health bằng ngưỡng tự đặt, không coi load_factor là utilization. Những chỉ số chưa có nguồn như agent-run count, utilization, OEE, sensor-history hoặc maintenance-window count chưa có định nghĩa phải nêu unavailable hoặc bỏ khỏi DTO sau khi thống nhất, không bịa giá trị.
6. Snapshot hiện tại và published schedule có thể khác basis. Giữ nguyên basis_snapshot của schedule; không join tên máy/technician của S2 vào lịch P1 dựa trên S1. Không thêm timeseries, auto-trigger case, MODIFY, What-if hoặc model mới trong P0 này.
7. Kiểm tra số liệu sau create, processing, approval, reject, commit và ingest. Reads không có side effect, không tạo case hoặc receipt. Snapshot/head thay đổi phải được phản ánh bằng context mới, không tự sửa case cũ.

## Nghiệm thu

- Authenticated HTTP + PostgreSQL thật: đúng factory scope, VIEWER đọc được nhưng không có mutation, unauthorized/inaccessible không lộ dữ liệu; query thiếu/thừa/lặp bị từ chối.
- Một factory có nhiều case hơn page limit vẫn có tổng số đúng; có LIVE/SIMULATION_ONLY, stale và terminal cases để chứng minh từng định nghĩa đếm.
- Empty factory/schedule, missing health, corrupt schema/hash và validator/database unavailable có trạng thái rõ, không fallback seed fixture.
- Concurrent ingest/commit/read không trả tổ hợp head, counts và preview không nhất quán. S1/P1 → ingest S2 vẫn giữ P1 và basis S1.
- Existing worker/decision/idempotency/race tests tiếp tục pass. Nếu cần index: chỉ thêm migration mới; không sửa migration lịch sử.

## Bàn giao

Một draft PR, commit đầu tiên chốt DTO/OpenAPI/example, runbook curl và test evidence theo SHA. Ghi URL PR + SHA DTO cho Frontend và Flex. Khi PR #44 được tích hợp, cập nhật HTTP baseline/exporter theo endpoint additive đã review; không sửa tay artifact sinh tự động. Không chờ frontend xong mới công khai DTO.
