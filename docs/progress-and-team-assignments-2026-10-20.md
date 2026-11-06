# Giao việc P0 cho Backend, Flex và Frontend — 20/10/2026

Đây là bản handoff để người dùng chuyển cho từng nhóm, thay bản phân việc ngày 18/10. Chưa gửi tin nhắn, tạo issue hay giao quyền cho tài khoản GitHub nào.

## Kết quả phải đạt

1. **Overview sử dụng dữ liệu nhà máy thật**, có nguồn, phạm vi và thời điểm rõ; không còn KPI hoặc danh sách cảnh báo giả trong real mode.
2. **Một luồng ra quyết định production thống nhất:** Overview → danh sách case v3 → recommendation và bằng chứng → APPROVE/REJECT → COMMIT có chủ đích → lịch đã công bố → lịch sử và Overview cập nhật.

Đây là hoàn tất hai P0 dữ liệu và human decision trên giao diện redesign. Không giao xây lại worker, planner, case lifecycle hoặc cơ chế publication đã có.

## Baseline đã kiểm tra

- Repository: https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc .
- PR #44 đã MERGED; origin/main tại 64dc391. Head PR được kiểm tra là 780f7c4; Contracts và Operations integration đều SUCCESS.
- Contract tham chiếu trên main: contracts/v3/p0-contract.md, backend/openapi.yaml và contracts/v3/operations-http.openapi.json. Domain schema vẫn là 3.0.
- Redesign local: frontend-redesign tại d5458c3. Nhánh này chưa tích hợp main 64dc391; DashboardPage còn dùng operationsOverviewFixture, CTA /decisions còn là research v2.
- Có thay đổi local ngoài scope tại ai_services và backend/package-lock.json. Không reset, clean, stash toàn bộ hoặc đưa những thay đổi đó vào PR giao diện/task.
- Chưa có endpoint Overview tổng hợp hoặc hợp đồng sensor history. Không được coi các chart replay hiện tại là dữ liệu live.

## Phân công và ranh giới

| Owner | Nhánh/đầu ra | Sở hữu | Không sửa chồng |
| --- | --- | --- | --- |
| Backend | codex/operations-overview-api; [brief Backend](tasks/2026-10-20-backend-overview-api.md) | Route/service Overview, aggregate nhất quán, auth, OpenAPI/exporter/example, PostgreSQL tests | Page/layout, frontend hook, browser harness |
| Flex | codex/overview-client-e2e; [brief Flex](tasks/2026-10-20-flex-overview-integration.md) | HTTP DTO phía client, client/mock/hook, kiểm thử contract và E2E/CI | Backend nghiệp vụ, UI page/layout/style |
| Frontend | Tiếp tục frontend-redesign; [brief Frontend](tasks/2026-10-20-frontend-production-dss.md) | Dashboard, navigation, machine inspector, case/detail/schedule presentation, interaction và UI tests | HTTP DTO/hook của Flex, route/migration Backend |

Flex là nhóm integration/QA/client trong đợt này. Thay đổi file thuộc nhóm khác phải ghi rõ trong handoff và được phối hợp trước; không âm thầm viết lại cùng một adapter hoặc component.

## Những quyết định sản phẩm chốt cho cả ba bên

- Chỉ một Overview ở sidebar. /operations là Factory resources chi tiết, không tạo Overview thứ hai.
- Decision Center chính trỏ /operations/cases. Chi tiết dùng /operations/recommendations?caseId=<UUID>. /operations/schedule là lịch công bố, có lối vào rõ từ Overview và Decision Center.
- /decisions hiện là research v2: giữ đường dẫn cũ hoạt động, ghi nhãn research và bỏ khỏi luồng production chính; không xóa workflow nghiên cứu trong P0.
- Factory là scope xuyên suốt; dùng factory_id trên các trang hỗ trợ scope. Giữ caseId hiện có cho detail, resolve factory từ case được authorize; nếu thêm factory_id vào detail thì chỉ là hint và phải đối chiếu case. Không giả định máy đang chọn là case đang chọn.
- KPI liên quan case mặc định LIVE, ghi rõ phạm vi. SIMULATION_ONLY có breakdown/nhãn riêng; không gộp vào “Cần phê duyệt để vận hành”.
- Máy dùng status canonical IDLE/RUNNING/WARNING/MAINTENANCE/FAILED/UNAVAILABLE. Thiếu health/risk là unknown; không tự suy ra risk, utilization, OEE hoặc số agent đang chạy.
- Overview tổng quan cả nhà máy; machine picker và thông tin từng máy nằm ở phần điều tra phía dưới. Không lặp ba chart máy ở phần tổng quan nhà máy.
- Desktop là môi trường nghiệm thu mới: 1280, 1440 và 1920 px; kiểm nhanh 2560 px để tránh khoảng trống hoặc chart bị kéo méo. Không mở thêm dự án mobile redesign.

## Thứ tự làm và điểm bàn giao

1. **G0 — chuẩn bị baseline:** Backend/Flex tạo nhánh từ main có 64dc391. Frontend tích hợp main vào nhánh redesign, giữ thay đổi local. Không giao lại fix #44.
2. **G1 — Backend công khai contract:** draft PR có DTO/OpenAPI, ví dụ response và định nghĩa counts/preview/context/errors. Frontend và Flex đọc, phản hồi trường cần dùng; chốt SHA contract trước khi nối consumer. Đổi shape sau đó phải cập nhật producer/consumer trong cùng đợt.
3. **G2 — làm song song:** Backend viết API/tests; Flex cung cấp typed client/hook/mock từ contract đã chốt; Frontend làm layout/navigation với adapter đó. Mock chỉ qua transport test/demo, không import fixture vào đường real.
4. **G3 — bàn giao chạy thật:** Backend cung cấp API PR/SHA + runbook; Frontend cung cấp redesign draft PR/SHA và route map; Flex tích hợp đúng ba SHA trong checkout riêng. Nếu chưa có frontend PR thì chưa thể nghiệm thu UI mới chỉ bằng main.
5. **G4 — nghiệm thu:** ba lần E2E liên tiếp từ schema sạch trên cùng bộ SHA, CI contract + integration xanh ở head cuối. Nếu phải sửa code giữa các lần, chạy lại chuỗi ba lần. Mỗi nhóm cập nhật bằng chứng; review rồi mới đề nghị merge, không tự merge.

Không ấn định ngày hoàn tất khi chưa biết năng lực và thời gian của từng nhóm. G1 là dependency bắt buộc; phần còn lại có thể chạy song song sau đó.

## Definition of Done chung

- Số liệu Overview khớp API/DB cho đúng factory và scope; tổng case không lấy từ một trang phân trang.
- Giao diện production không dùng demo fallback, badge “AI analyzing” giả hoặc chart lịch sử tự tạo.
- Create → worker → recommendation → approve → commit chạy được từ UI mới. REJECT cũng được kiểm tra; APPROVE/REJECT không công bố lịch.
- COMMIT thành công đúng một lần; reload/Back giữ filter và factory; case còn tìm lại được, audit còn đúng sau reload.
- S1/P1 → ingest S2: Overview thấy S2, lịch P1 vẫn trình bày theo basis S1. Case COMMITTED được hiển thị là committed kể cả stale sau publication.
- VIEWER, factory isolation, stale/race, SIMULATION_ONLY, replay/lost response và missing/error states được kiểm tra; thao tác đọc không phát sinh POST.
- Bằng chứng có PR URL, head/dependency SHA, lệnh, kết quả, logs và ảnh desktop. Không gọi toàn bộ hệ thống “live” nếu vẫn còn panel demo.

## Mẫu báo cáo mỗi lần bàn giao

Owner / task ID; PR URL và head SHA; dependency SHA; phần đã chạy thật; kiểm thử đã chạy và kết quả; điểm còn thiếu; file ngoài ownership cần phối hợp; bước tiếp theo. Trạng thái dùng draft/ready/blocked/passed đúng thực tế.

Ngoài scope đợt này: MODIFY/revalidation, tự retry failed case, sensor-history API, agent trace mới, What-if engine, đổi planner/LLM/RL, autoapprove và điều khiển máy vật lý. Các trang research/demo được ghi nhãn rõ, không được tính là P0 production đã tích hợp.
