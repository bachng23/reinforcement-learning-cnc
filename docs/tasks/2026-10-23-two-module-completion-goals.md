# Goal hoàn tất Backend Work Orders và Flex Incident Center — 23/10/2026

Đây là hai bản giao việc để người dùng chuyển cho người phụ trách; chưa gửi tin nhắn ngoài chat hoặc tạo task/issue cho tài khoản nào.

## Hai goal phải hoàn tất

| Owner | Goal | Brief |
| --- | --- | --- |
| Backend | Work Orders backend chạy trọn vòng đời, lưu bền vững, đúng quyền/concurrency/recovery và cung cấp API/lookup thật cho Flex | [Task Backend](2026-10-23-backend-work-orders-completion.md) |
| Flex | Incident Center có database/API/UI desktop hoàn chỉnh, liên kết thật với case và Work Orders, nghiệm thu xuyên hai module | [Task Flex](2026-10-23-flex-incident-center-completion.md) |

PR #48 và #49 đã merge; heads 43f125b và 4469b78, CI Contracts/Operations integration đều SUCCESS. Main kiểm tra f8d94837159ca5fdc1a0f159fc8c28f75e394f7f. Đây là baseline contract/policy, không phải hai feature hoàn tất.

## Chỉ dẫn thực thi

- Bắt đầu nhánh implementation/PR mới từ main đã có hai baseline; fetch và ghi base SHA thực tế. Không push tiếp vào PR đã merge.
- Tái dùng contract/state machines/evidence/recovery guards trên main. Guard thuần phải được wire vào transaction/HTTP thật; không tạo policy khác để né tests.
- Backend ưu tiên WorkOrderSummary/lookup callable và read APIs cho Flex; song song Flex làm incident persistence/API/UI độc lập. Backend tiếp tục full lifecycle trong khi Flex nối UI.
- Shared Prisma schema, router/OpenAPI/exporter/nav thay đổi tuần tự, mỗi bên giữ namespace và owner module. Hai migrations reserved không trùng; integration upgrade phải chứa cả hai.
- WorkOrderSummary không bắt buộc frontend href; UI sở hữu route map. Tên schema generic của draft incident phải namespace khi đưa vào OpenAPI chung.
- Original briefs ngày22 là nền nghiệp vụ. Hai completion briefs ngày23 và contract đã review trên main quyết định cách triển khai/đánh giá hiện tại, đặc biệt recovery và evidence.

## Các mốc và đầu ra

1. **M0 — baseline:** hai PR implementation Draft, owner/base SHA/migration names/contract dependencies rõ. Không dừng ở plan; tiếp tục implement trong cùng nhiệm vụ.
2. **M1 — API độc lập:** Backend Work Order read+lookup thật và incident API core của Flex hoạt động qua authenticated HTTP/PostgreSQL. Handoff real seed IDs/curl và SHA; tiếp tục các phần chưa xong.
3. **M2 — feature complete:** Backend toàn lifecycle/recovery/race; Flex UI mọi action incident + real links. Các tests riêng pass; không còn stub critical path.
4. **M3 — tích hợp:** checkout riêng chứa hai implementation heads; record exact SHA và toàn bộ dependencies. Kiểm cả fresh/populated upgrade; không để hai module chỉ chạy được ở hai DB khác nhau.
5. **M4 — nghiệm thu cuối:** ba clean-schema E2E liên tiếp cùng SHA, screenshots desktop, CI head cuối xanh và report không còn scenario critical pending. Sau review mới đề nghị merge; không tự merge hoặc deploy.

Không ấn định deadline giả khi chưa biết thời gian của người phụ trách. Dependency chưa sẵn thì tiếp tục phần độc lập, báo blocker cụ thể và giữ acceptance pending; không kết thúc task chỉ bằng việc viết “chờ bên kia”.

## Bài nghiệm thu chung bắt buộc

1. Tạo incident trên UI thật, assign/severity/ACK/investigate bằng users đúng role.
2. Tạo case LIVE hợp lệ, worker/planner sinh recommendation, người có quyền APPROVE rồi COMMIT riêng. Tạo Work Order từ đúng assignment bảo trì của publication đó.
3. Link incident với case/order, kiểm same-factory/machine evidence. Order đang làm không bị coi đã hoàn tất.
4. Thực hiện order qua API thật: assign/accept/start/block/resume/complete; khác người verify/close. Kiểm recovery khi assignee mất quyền.
5. Incident không tự close theo order; owner resolve và manager khác verify/close từ UI. Reload/restart đọc được full history/provenance, reopen không mất báo cáo cũ.
6. Negative paths: cross-factory, VIEWER, self-verifier, revoked/inactive actor, stale revision, duplicate retry, SIMULATION_ONLY, target unavailable, source plan đổi và rollback.
7. S2/P2 không sửa basis/source lịch sử. Cả hai module không sửa telemetry hoặc tuyên bố physical recovery từ trạng thái workflow.

Mỗi scenario phải có assertion thực và kết quả đúng; test mock riêng không thay thế M4. Full Work Order UI ngoài phạm vi Backend/Flex ở đợt này; đó là task Frontend riêng, không được gọi là đã có. UI Incident thuộc Flex phải hoàn tất.

## Điều kiện đóng việc và mẫu báo cáo

Chỉ đánh dấu VERIFIED_DONE khi người review có thể checkout đúng SHA, chạy runbook/seed và tái hiện workflow cùng các assertions; không còn lỗi critical path hoặc acceptance pending. Contract merged, unit pass hoặc screenshot đẹp đều chỉ là tiến độ.

Mỗi lần handoff ghi:

Owner; milestone; PR URL/head SHA; dependency/integration SHA; endpoint/UI đã chạy thật; command/test results; evidence/log/screenshot links; phần pending/blocker có cách tái hiện; bước tiếp theo. Không dùng “xong” cho phần mới có schema/mock.

Thay đổi scope hoặc breaking contract phải nêu rõ lý do và cập nhật producer/consumer/tests/docs cùng đợt. Không tự thêm chức năng ngoài goal để trì hoãn hoàn tất hai module này.
