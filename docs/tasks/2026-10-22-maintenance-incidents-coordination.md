# Hai module nghiệp vụ: Work Orders và Incident Center — 22/10/2026

> Bản giao ban đầu. Kế hoạch hoàn tất implementation hiện tại: [Hai goal ngày23/10](2026-10-23-two-module-completion-goals.md). PR #48/#49 đã merge phần contract/policy; tiếp tục bằng PR implementation mới.

Bản giao việc để người dùng chuyển cho Backend và Flex; không phải xác nhận đã gửi task ra ngoài chat.

## Mục tiêu

Hoàn thiện chu trình: phát hiện vấn đề → điều tra/ra quyết định → công bố kế hoạch → thực hiện bảo trì → xác minh kết quả. Hai module độc lập nhưng liên kết được; không xây lại case v3, planner hoặc factory access.

| Owner | Chức năng và brief | Kết quả |
| --- | --- | --- |
| Backend | [Maintenance Work Orders](2026-10-22-backend-maintenance-work-orders.md) | Database, API, audit và quản lý thực hiện bảo trì từ lịch đã COMMIT |
| Flex | [Factory Incident Center](2026-10-22-flex-factory-incident-center.md) | Database/API riêng cho incident, UI desktop, liên kết case/work order và E2E |

Baseline đã review: Overview #45; Factory access #46 tại 20174df; Overview client #47 tại 86ed39f. Khi bắt đầu fetch main, ghi SHA và trạng thái dependency thực tế. Nếu #46 chưa merge, khai báo dependency/stacked branch; không tự merge PR. Không phát triển thêm một cơ chế phân quyền khác.

## Ranh giới không chồng chéo

- Backend sở hữu work order: kế hoạch thực hiện, assignee, tiến độ, báo hoàn thành và duyệt đóng.
- Flex sở hữu incident: ghi nhận vấn đề, nguồn bằng chứng, severity, triage, điều tra, xác minh và đóng/mở lại.
- Case/recommendation/APPROVE/COMMIT thuộc Operations v3 đang có. Hai module gọi/tái dùng API đó; không thêm lifecycle quyết định cạnh tranh.
- Work order CLOSED không tự đóng incident; incident RESOLVED không tự đóng/hủy work order; COMMITTED chỉ là công bố lịch, không chứng minh máy đã được sửa.
- Snapshot Technician là nguồn lực lập lịch, không phải User account. Không gán technician_id vào user_id hoặc tự tạo mapping bằng display_name.
- Identity máy và evidence luôn gắn factory + basis snapshot. Trùng tên/ID ở hai factory không có nghĩa cùng tài sản. Machine ID còn trong snapshot lịch sử nhưng mất khỏi current snapshot vẫn xem được lịch sử có nhãn rõ.
- Global role và membership theo #46; ADMIN/ENGINEER quản lý nghiệp vụ, OPERATOR thao tác công việc/sự cố được giao theo contract, VIEWER chỉ đọc. Không tạo custom factory roles trong vòng này.

## Contract liên kết hai module

Chốt trong draft PR trước khi viết consumer:

1. WorkOrderSummary do Backend cung cấp: UUID, factory_id, machine_id, basis_snapshot_id, source publication identity, source assignment_id, status, revision, assignee summary, planned/actual times, canonical detail href do UI route map quyết định. Không trả raw planner artifact hoặc private notes.
2. IncidentSummary do Flex cung cấp: UUID, factory_id, machine_id/basis nếu có, source, severity, status, revision và timestamps. IDs/fields cụ thể chốt trong OpenAPI, không tự đoán DTO của nhóm kia.
3. Flex sở hữu IncidentCaseLink và IncidentWorkOrderLink. Liên kết do người có quyền yêu cầu; Backend không thêm incident_id bắt buộc vào WorkOrder. Không thêm FK tới bảng nhóm kia trước khi migration/ownership đã thống nhất.
4. Tất cả links phải xác thực server-side: same factory, người dùng có quyền với cả hai đối tượng, target tồn tại. Machine-specific incident chỉ liên kết target đúng máy khi contract target có identity đủ để kiểm chứng; case v3 không có machine identity đáng tin thì link ở cấp case với nhãn rõ, không bịa quan hệ máy.
5. Grant/revoke/role checks và fresh transaction authorization dùng chung service #46. Link/unlink ghi audit; linked detail không bypass quyền bằng ID lưu sẵn.
6. Bulk fetch bounded summaries để render danh sách; không N+1 hoặc đưa notes private vào summary. Khi target API unavailable, hiển thị unavailable, không kết luận target bị xóa hoặc hoàn tất.

## Làm song song và ownership file

1. Cả hai bên mở draft PR có ERD, state machine, OpenAPI/examples và test plan trước implementation; công khai SHA contract.
2. Backend làm Work Orders API; Flex làm incident độc lập và UI với mock transport đúng contract. Chưa có endpoint thật thì không báo link/E2E đã pass.
3. Mỗi nhóm dùng services/routes/migrations/tests riêng. Cùng sửa backend/openapi.yaml, Prisma schema, router index, HTTP exporter hoặc frontend navigation: thông báo file/commit cần đổi, tích hợp tuần tự và regenerate artifacts từ sources.
4. Migrations giữ lịch sử bất biến; chọn tên/timestamp không trùng, kiểm fresh và populated upgrade với cả hai migration trên một integration SHA.
5. Flex nghiệm thu luồng incident → case hiện có → COMMIT → work order → thực hiện/đóng → xác minh incident. Ghi đủ SHA hai module và frontend dependencies, không chỉ test từng mock.
6. Từng PR đủ unit/integration/build/contract CI rồi review; không tự merge hoặc triển khai production. Task Backend không bị gọi là thiếu UI vì giao UI work order đầy đủ ngoài scope; Flex cung cấp UI incident và phần hiển thị/link work order.

## Definition of Done chung

Một incident có thể được điều tra, liên kết quyết định thật, liên kết lệnh bảo trì từ lịch đã COMMIT, theo dõi tiến độ và được xác minh đóng. Có audit sau reload, không cross-factory, không duplicate do retry, không sửa lịch sử kế hoạch/telemetry. Dữ liệu thiếu và thất bại được trình bày đúng, không success giả.

Không ép mọi incident phải có case/work order: đóng false-positive hoặc giải quyết không cần bảo trì phải có reason/evidence phù hợp. Không auto-create/autoapprove/autocommit/autoexecute từ UI hoặc background effects.
