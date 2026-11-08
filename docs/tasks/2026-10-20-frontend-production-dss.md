# Frontend — P0: hoàn thiện DSS desktop trên dữ liệu production

Bản giao việc ngày 20/10/2026. Đọc cùng [kế hoạch chung](../progress-and-team-assignments-2026-10-20.md). Tiếp tục nhánh frontend-redesign hiện tại d5458c3; tích hợp main có 64dc391 trước khi sửa tiếp. Giữ nguyên thay đổi local ngoài scope. Không tự merge PR.

## Kết quả cần bàn giao

Một nơi quan sát cả nhà máy, một nơi xử lý quyết định; người dùng biết tình hình, việc cần làm, lý do và tác động của hành động. Giao diện desktop sạch, có màu có mục đích; không thêm chart, KPI hoặc trang chỉ để trông nhiều tính năng.

Frontend sở hữu DashboardPage, AppShell/navigation, components trình bày, case/recommendation/schedule UI và UI tests. Flex sở hữu HTTP DTO/client/hook; Backend sở hữu API. Không gọi fetch riêng trong page hoặc tự tạo summary contract thứ hai.

## FE-01 — baseline và route map production

- Tích hợp main vào redesign, giữ fix #44 về URL/filter/reload. Không reset/clean/stash toàn bộ checkout có thay đổi chưa commit; không đưa file AI/backend ngoài scope vào PR.
- Sidebar: một Overview /overview; Decision Center /operations/cases. Case detail giữ /operations/recommendations?caseId=<UUID>.
- Factory resources /operations là chi tiết drill-down; Integrated schedule /operations/schedule có lối vào rõ từ Overview và Decision Center. Không tạo lại mục “Factory operations” ngang hàng với Overview.
- /decisions là research v2: giữ route hoạt động, ghi nhãn research và bỏ khỏi primary production CTA/navigation. Không xoá chức năng v2 hoặc redirect làm mất workflow mà chưa có route thay thế.
- Factory scope là state rõ trên URL ở các trang hỗ trợ factory_id, được giữ qua links/refresh/Back. Detail lấy factory authoritative từ case API; factory hint khác thì báo mismatch, không dùng hint để đổi case.
- Active nav đúng cả case list và detail. Công khai route map trong PR cho Flex trước khi viết E2E.

## FE-02 — Overview nhà máy dùng dữ liệu thật

Thay import operationsOverviewFixture trong frontend/components/pages/dashboard-page.tsx bằng hook do Flex bàn giao sau khi BE-01 freeze.

| Tầng | Nội dung | Tương tác |
| --- | --- | --- |
| Context | Factory, captured_at, read_at, trạng thái nguồn và refresh | Đổi factory rõ ràng, refresh có loading, giữ scope |
| Tổng quan | Tổng máy/status, LIVE awaiting approval, approved chưa công bố, processing cases theo contract | KPI case mở list đúng status/mode; không mở máy ngẫu nhiên |
| Việc cần quyết định | Preview chờ phê duyệt từ Backend, status/stale/context/timestamp thật | Mở đúng UUID; “Xem tất cả” tới list LIVE/AWAITING_APPROVAL cùng factory |
| Điều tra | Machine picker và inspector phía dưới | Chọn máy rồi xem thông số/provenance và liên kết có cơ sở |
| Lịch công bố | Head plan version và đường vào schedule | Schedule dùng basis_snapshot, không ghép snapshot hiện tại |

- Overview là thông tin toàn nhà máy, không lặp các mini chart từng máy ở tầng tổng quan.
- Thiếu history API: thay khu trend replay bằng distribution/status hoặc phần dữ liệu hiện có có ý nghĩa; không vẽ đường thời gian từ một snapshot. Không giữ chỗ chart rỗng lớn chỉ để cân bố cục.
- Tên KPI bám đúng định nghĩa: “Cases đang xử lý”, không “AI agents active”. Counts phải từ summary API, không từ preview/list trang đầu.
- Không tạo severity/priority hoặc risk bằng ngưỡng frontend. Nếu API chỉ có thời gian/status thì sort đúng trường đó và ghi đúng nhãn.
- Các card cùng scope mode/coverage rõ. Factory dữ liệu rỗng khác missing measurement, missing snapshot và service unavailable.
- Real mode không có fixture fallback. Demo nếu giữ phải được chọn rõ, nhãn demo xuyên suốt và tách hẳn context/counts/IDs.

## FE-03 — machine picker và inspector

Hiện FactoryLiveView vẫn import replay/attention fixture nội bộ và có logic riêng M03; không thể coi việc truyền machines thật vào là đã live. Refactor thành presentation thuần có adapter thật, hoặc tách demo replay khỏi inspector production.

1. Giữ trải nghiệm một nút chọn máy; mở danh sách có tìm kiếm, nhóm theo status, số lượng nhóm, tên/ID và badge trạng thái gốc.
2. Canonical statuses đầy đủ: IDLE/RUNNING/WARNING/MAINTENANCE/FAILED/UNAVAILABLE. Có thể nhóm IDLE/RUNNING vào nhóm vận hành nhưng từng máy vẫn phân biệt hai trạng thái; UNAVAILABLE không thành “Ổn”.
3. Keyboard: mở/đóng, di chuyển, chọn, Escape; focus chuyển vào detail hợp lý, trở về trigger khi đóng. Đổi factory thì reset selection nếu máy không tồn tại.
4. Hiển thị measurements hiện có, đơn vị, source/observed_at và unknown. Health/probability 0..1 format thành %, không tự tạo confidence hoặc failure horizon.
5. Chart ở detail phải lớn, rõ trục/đơn vị/legend và thời gian nếu có nguồn thật. Hiện chưa có history API: ghi chưa có lịch sử, trình bày snapshot thay thế; chart demo chỉ xuất hiện trong demo mode rõ ràng.
6. Machine ID không phải case ID. Không nối case vào máy bằng tên, M03 hoặc vị trí array. Nếu API không có relationship được xác nhận, dẫn về case list cùng factory thay vì tự mở “case của máy”.

## FE-04 — Decision Center, recommendation và lịch sử

- Tái dùng DecisionCasesPage, RecommendationCenterPage, audit timeline và use-operations-action đang có, đưa vào cùng shell/thiết kế. Không viết lại command lifecycle.
- List có search/filter theo khả năng API, status/mode rõ, cursor reset khi đổi scope; không giả server search nếu chỉ lọc các hàng của trang hiện tại. Filter chỉ có hiệu lực khi URL commit; reload/Back phải giữ.
- Detail phân cấp: bối cảnh case và stale → recommendation/candidate comparison → bằng chứng/assumptions/warnings → actions → audit. Khi chưa có artifact, hiển thị processing thật và poll read hợp lý.
- Chỉ hiển thị KPI/evidence và feasibility từ recommendation đã validate; không tính lại verdict VALID bằng frontend hoặc tạo lời giải thích “AI” không có nguồn.
- APPROVE và COMMIT là hai hành động riêng, mô tả rõ approval chưa công bố lịch. Trước COMMIT có confirmation review cụ thể của candidate và factory; không gộp autoapprove/autocommit.
- REJECT yêu cầu lý do theo contract. Disable duplicate in-flight actions; không optimistic success. VIEWER không có write CTA, server vẫn là authority.
- Hiển thị conflict/stale với hướng dẫn refresh và tạo case mới khi cần; không force, tự rebase hoặc tự đổi idempotency key để retry command.
- COMMITTED ưu tiên hiển thị publication thành công ngay cả khi stale=true sau commit. Mở lịch đúng published plan; audit hiển thị actor, command, thời điểm và candidate/publication identity thật.
- Sau action đã xác nhận, phối hợp invalidation của Flex để Overview/case/schedule cập nhật. Read/refresh/navigation không được phát sinh POST.
- Tạo case qua CreateDecisionCase hiện có trên context factory/basis hợp lệ; có entrypoint rõ từ production Overview/resources. Không thêm trigger hoặc input không có contract.

## FE-05 — chất lượng desktop và trạng thái

- Giữ nền trung tính, navy navigation, blue cho primary action; xanh/vàng/đỏ dành cho status có ý nghĩa. Trạng thái luôn kèm chữ/icon, không chỉ màu.
- Bảng: text trái, số phải, status giữa, số dùng tabular/mono; sticky header và cột định danh khi cần; sort/filter nhìn ra được. Compact/comfortable chỉ thay spacing, không đổi số liệu.
- Loading giữ layout vừa đủ, empty có hành động phù hợp, missing là “Chưa có dữ liệu”, lỗi có retry/correlation khi API cung cấp. Không đổi thành 0 hoặc màu xanh.
- Viewport 1280/1440/1920 không cắt controls hoặc overflow toàn trang; bảng dài có vùng cuộn rõ. Kiểm nhanh 2560 để giới hạn độ rộng đọc và tỷ lệ chart. Không thêm mobile redesign.
- Chụp ảnh Overview, picker mở, machine detail, list, recommendation/action, published schedule và một error/empty state; sửa các vấn đề nhìn thấy trước khi bàn giao.

## Kiểm thử và bàn giao

- Component tests cho selection/grouping/unknown, KPI drill-down đúng scope, UI states, route links và action feedback; giữ PR #44 filter regression.
- Chạy frontend tests liên quan, typecheck, build. Không viết snapshot tests chỉ khóa class/style; tests phải bắt sai dữ liệu/điều hướng/hành động.
- Mở draft PR redesign trước nghiệm thu Flex; cung cấp URL/head SHA, dependency contract/client SHA, route map, screenshot desktop, danh sách real/demo và test results.
- Phối hợp Flex chạy luồng thật từ Overview mới qua create/worker/approve/commit/schedule/history; mock pass chưa đủ hoàn tất FE.

Ngoài scope: redesign research/experiments/admin toàn bộ trong P0 này, xây agent trace/What-if/history API mới, đổi planner hoặc điều khiển máy. Những phần đó vẫn được giữ hoạt động và ghi nhãn đúng; phạm vi redesign toàn bộ sản phẩm tiếp tục sau khi hai P0 production đã đạt.
