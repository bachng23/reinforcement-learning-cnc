# Phân việc P0 — 18/10/2026

> Bản lịch sử, đã được thay bởi [phân việc ngày 20/10/2026](progress-and-team-assignments-2026-10-20.md). PR #44 đã merge; trạng thái PR/CI và task sửa #44 bên dưới không còn là công việc hiện tại.

Trạng thái: nội dung handoff đã chuẩn bị để người dùng chuyển cho Backend và Flex, theo cách phân việc trước đây. Không tạo issue/assign hoặc gửi chat ngoài project.

## Baseline đã kiểm tra

- Main: 07033e3; frontend local: frontend-redesign@fc43787.
- Các luồng Operations v3 create/worker/recommendation/approve/reject/commit/list/audit đã có; không giao xây lại.
- Overview hiện còn fixture và CTA review trỏ vào research v2. Vòng này tập trung dữ liệu Overview và thống nhất luồng production v3.
- Contract PR #44 đang OPEN tại head 5f16f3d: Contracts pass, Operations integration fail. Flex xử lý tái hiện/fix trước; chưa merge.

## Task giao cho từng nhóm

| Owner | Việc | Output |
| --- | --- | --- |
| Backend | [P0 Overview API](tasks/2026-10-18-backend-overview-api.md) | DTO/OpenAPI/example trước; API/read consistency/auth và PostgreSQL tests; một draft PR |
| Flex | [CI + client/hook + E2E](tasks/2026-10-18-flex-overview-integration.md) | Fix gate #44; typed client/mock/hook; 3 real-service runs của luồng mới và evidence theo SHA |
| Frontend tại chat này | Giữ thiết kế desktop, nối Overview với contract đã chốt, đưa review/Decision Center vào luồng v3 | Một luồng Overview → case → recommendation → approve/commit → schedule/history; handoff PR/SHA cho Flex |

## Thứ tự phối hợp

1. Backend công khai draft DTO và example; Flex song song tái hiện lỗi gate #44.
2. DTO được chốt → Flex client/mock/hook; Frontend làm layout với cùng DTO, không import mock trực tiếp vào real mode.
3. Backend API + Frontend PR sẵn sàng → Flex chạy nghiệm thu cross-service trên SHA tích hợp cụ thể.
4. Review PR riêng của từng nhóm; không tự merge. P0 chỉ hoàn tất khi cả hai đầu dữ liệu và luồng human decision hoạt động qua UI mới, reload được và CI xanh.

Không giao P1/P2, sensor history, agent trace, MODIFY hoặc What-if trong vòng này.
