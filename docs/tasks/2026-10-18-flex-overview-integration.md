# Flex — P0: contract/client và nghiệm thu luồng Overview → quyết định

> Bản lịch sử. Dùng [brief Flex ngày 20/10/2026](2026-10-20-flex-overview-integration.md) thay cho bản này. F0 sửa PR #44 bên dưới đã hoàn tất; không giao lại.

Ngày giao: 18/10/2026. Bản giao việc để người dùng chuyển cho nhóm Flex/integration.

## Baseline và ownership

Main đã kiểm tra: 07033e3. Giữ nguyên chức năng create → worker → recommendation → approve/reject → commit, discovery/audit, lost-response recovery và stale/race đã có. Bắt đầu checkout riêng, không chạm thay đổi local của người khác. Không tự merge.

Flex sở hữu contract transport phía client, mock/hook, harness, E2E và CI. Backend sở hữu routes/services/OpenAPI/migration. Frontend trong chat hiện tại sở hữu dashboard, điều hướng, thiết kế và việc thống nhất Decision Center lên Operations v3. Không sửa chồng các page/layout của Frontend; chốt handoff qua file API/hook và DTO Backend.

## F0 — xử lý CI đang đỏ trước

PR contract #44: https://github.com/bachng23/reinforcement-learning-cnc/pull/44 ; head 5f16f3d. Contracts pass, Operations integration fail. Run lỗi: https://github.com/bachng23/reinforcement-learning-cnc/actions/runs/38704496622 .

Lỗi quan sát được: desktop browser test tại frontend/tests/browser/decision-cases-audit.spec.ts, test discover/filter/paginate/reopen/audit/reload. Sau page.reload(), Status được kỳ vọng COMMITTED nhưng nhận chuỗi rỗng, assertion ở dòng 100 trên head CI. Đây là triệu chứng; chưa kết luận nguyên nhân là test race hay lỗi đồng bộ URL/state.

Tái hiện trên đúng SHA với Node 22.22.2+ thuộc dòng 22 và môi trường test riêng. Phân biệt lỗi sản phẩm với race/harness. Giữ assertion reload và browser Back bảo toàn filter; không bỏ test, nới timeout tùy tiện hoặc chỉ rerun tới khi xanh. Nếu cần sửa feature component, tách đề xuất nguyên nhân và patch tối thiểu cho Frontend/integrator review. Mở một PR fix riêng, có bằng chứng tái hiện và regression; không sửa history migrations hoặc nghiệp vụ để làm test pass. Cần cả Contracts và Operations integration xanh trước khi xác nhận gate đã thông.

## F1 — nối contract Backend với giao diện

Nhánh đề xuất cho phần này: codex/overview-client-e2e. DTO phụ thuộc task Backend operations-overview-api; Backend phải cung cấp URL draft PR và SHA example/OpenAPI trước.

1. Thêm typed method cho GET /api/v1/operations/overview vào OperationsApiClient và mock có cùng shape. Tái dùng generated domain types; không tạo enum/domain contract cạnh tranh. Nếu contract đổi thì cập nhật types/mocks/tests cùng commit.
2. Cung cấp hook/data adapter cho Frontend: tải Overview theo factory, cancel request cũ, loading/empty/auth/unavailable/network/integrity states, explicit refresh, context mismatch và dữ liệu thiếu. Không import operations-ui fixture trong real mode, không tự tính authoritative KPI hoặc lắp tổng case từ một trang list.
3. Xử lý context/version khi join thêm snapshot hoặc current schedule. Nếu các reads khác context thì refetch có giới hạn hoặc báo rõ, không ghép dữ liệu. Giữ nguyên basis_snapshot của lịch đã công bố. Không gọi mutation từ effect, refresh, Back hoặc reload.
4. Frontend sẽ nối UI và CTA tới case/list/recommendation v3. Đường dẫn /decisions hiện là research v2; không dùng nó làm bằng chứng luồng production đã thống nhất. Giữ ID case/máy/factory từ API, không nối bằng demo labels.
5. Mở rộng harness đang có theo đúng entrypoint sau khi PR Frontend sẵn sàng; không viết lại các test stale/race/receipt đã có. Kiểm Overview → case đúng ID → candidate comparison → approve → commit → published schedule → quay lại Overview có số liệu mới → reload/rediscover vẫn đúng history.
6. Thêm kịch bản đổi snapshot S1/P1 → S2, empty/missing health, unauthorized, unavailable và hai factory. Assert dữ liệu thật khớp DB/API, không dùng fixture fallback. Read-only interactions không phát sinh command; actor/event/receipt/publication và bốn loại version giữ đúng meaning.

## Nghiệm thu và bàn giao

- Client/hook/mock tests, generated contracts check, TypeScript và frontend production build pass.
- E2E với PostgreSQL + backend + dedicated decision worker + FastAPI + Chromium thật, 3 lần từ schema sạch; UI assertions phải đi qua Overview mới, không chỉ test trang resource cũ.
- Acceptance mới tập trung desktop 1280/1440/1920; không làm thêm thiết kế mobile. Giữ các regression có sẵn.
- Giữ receipt replay, lost response, stale decision, competing commits, VIEWER/factory isolation và SIMULATION_ONLY cannot commit đã có. Evidence chỉ ghi passed nếu assertion thực sự chạy.
- Schema, process, port và browser cleanup cả thành công/thất bại/ngắt; không dùng DB development hay credential cá nhân. Không dừng dịch vụ local người dùng để chạy test.
- Mỗi PR có head SHA, dependency SHA, command/log/result, evidence JSON và runbook. Chạy CI gate đầy đủ trên head cuối; chưa xanh thì báo pending/failed đúng thực tế.

## Phụ thuộc cần ghi rõ

Frontend redesign hiện ở frontend-redesign@fc43787 trong local, chưa có PR remote cho phần redesign này. Làm F0 và client/hook từ main + DTO Backend trước; E2E của giao diện mới đợi URL PR/SHA Frontend được bàn giao. Không gọi main cũ là nghiệm thu redesign mới. PR #44 vẫn mở; không tự merge hoặc tự coi nó đã tích hợp.

Ngoài scope: UI redesign, backend domain/migrations, agent trace mới, sensor history, MODIFY, What-if, RA-QMIX/provider LLM và tự động điều khiển máy.
