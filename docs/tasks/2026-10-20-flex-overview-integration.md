# Flex — P0: typed client, data hook và nghiệm thu end-to-end

Bản giao việc ngày 20/10/2026. Đọc cùng [kế hoạch chung](../progress-and-team-assignments-2026-10-20.md). Baseline main 64dc391 đã có PR #44; phần sửa filter/reload và CI đã xong, không giao lại. Nhánh đề xuất: codex/overview-client-e2e. Không tự merge.

## Kết quả cần bàn giao

Frontend nhận một adapter Overview có contract rõ và trạng thái đầy đủ. Luồng mới được kiểm chứng bằng dịch vụ thật, trên SHA tích hợp xác định, không chỉ mock hoặc trang resource cũ.

Flex sở hữu frontend/lib/operations-api, transport DTO mới, mock/hook tests, browser harness và CI liên quan. Backend sở hữu API/OpenAPI/exporter; Frontend sở hữu page/layout/components và UI styles. Thống nhất tên file mới với Frontend trước khi sửa; không tạo adapter thứ hai trong page.

## FL-01 — nối contract Backend

1. Đọc contracts/v3/p0-contract.md trên main và draft OpenAPI/example Backend. Ghi PR URL + SHA contract vào PR Flex. Chưa freeze contract thì có thể dựng tests/harness, chưa coi interface dự đoán là contract đã chốt.
2. Thêm getOperationsOverview(factoryId, { signal }) vào OperationsApiClient, tái dùng authFetch, credentials, no-store và OperationsApiError. Preserve metadata/context cần dùng, không bỏ head revision hoặc coverage khi unwrap.
3. HTTP DTO summary lấy từ OpenAPI đã chốt; tái dùng generated domain types cho enums/payload canonical. Không nhét transport summary vào domain schema Python chỉ để generate type.
4. Mock transport phải trả đúng shape và semantics của API mới. Có fixtures cho ready/empty/missing measurements/stale preview/forbidden/unavailable/integrity errors; chỉ dùng trong test hoặc demo được chọn rõ.
5. Kiểm lỗi canonical route mới và error envelope product hiện có đều được parse đúng. Không ép toàn bộ API sang một error shape.
6. Contract tests phải so response examples thực từ Backend với consumer expectations; không chỉ tạo object giống type rồi assert chính object đó.

## FL-02 — hook/data adapter cho Frontend

Đề xuất frontend/lib/operations-api/use-operations-overview.ts; xuất hook và state type qua index hiện có, phối hợp tên export trước khi Frontend import.

- Input: api ổn định, factoryId; output: state/data, refresh/retry và context/provenance cần hiển thị. Handoff có ví dụ sử dụng ngắn.
- Phân biệt loading, no snapshot/empty theo contract, ready, unauthorized/forbidden, unavailable, network, integrity/error và context mismatch. Không coi lỗi API là thành công với fixture.
- Abort/ignore request cũ khi đổi factory, unmount hoặc refresh; response A đến muộn không được thay dữ liệu B. Không flash dữ liệu factory cũ dưới tiêu đề factory mới.
- Overview là nguồn tổng counts và preview. Không tính tổng bằng GET /decision-cases trang đầu; không suy KPI từ demo labels.
- Nếu inspector cần GET snapshot bổ sung, đối chiếu snapshot_id, plan_version và head revision khi API có cung cấp. Context lệch thì bounded retry hoặc explicit refresh/mismatch; không ghép tùy ý.
- Matching head không chứng minh case aggregate còn mới: counts chỉ đúng tại read_at. Giữ counts/preview từ cùng Overview response; không overlay case metadata cũ từ cache thành aggregate “đồng thời”.
- Dùng basis_snapshot của current schedule để dựng lịch P1; current S2 dùng cho Overview. Không thay entity lịch sử bằng tên/thông số hiện tại.
- Read effects, refresh, polling, browser Back và reload chỉ GET. Sau mutation đã xác nhận, invalidate/refetch Overview + case + current schedule liên quan; hook không tự tạo hoặc retry command.
- Dùng lại use-operations-action và receipt journal cho mutation. Lost response dùng cùng body/key; 409 refresh context và để người dùng quyết định. Không đổi key rồi tự publish lại.
- Commit response lịch sử replay phải được refetch trước command mới. COMMITTED có stale=true sau publication vẫn là committed, không render như commit thất bại.

Hook tests phải có delayed factory switch, refresh race, abort, mismatch, missing data và error states. Chốt behavior trước khi Frontend tích hợp; không dùng setTimeout dài để che race.

## FL-03 — nghiệm thu luồng giao diện mới

Chỉ bắt đầu acceptance cuối khi có Backend PR/SHA và Frontend redesign PR/SHA. Route map: /overview → /operations/cases → /operations/recommendations?caseId=… → /operations/schedule. Factory scope và filters phải bám URL; detail resolve factory từ case.

| Kịch bản | Assertion bắt buộc |
| --- | --- |
| Overview thật | Counts/preview bằng DB/API cùng scope; không có demo ID hoặc text fallback trong real mode |
| Tạo case | Từ entrypoint production, create đúng factory/basis, worker xử lý, UI đi tới đúng UUID và recommendation |
| Phê duyệt/công bố | So candidate và evidence, APPROVE không đổi published head; COMMIT riêng đổi head đúng một lần và hiện schedule đúng candidate |
| Từ chối | Bắt buộc lý do; REJECT không publication; history có actor và thời điểm đúng |
| Sau quyết định | Overview refetch đúng counters, reload tìm lại case, audit/publication giữ nguyên |
| URL/navigation | Hold navigation response với API nhanh; filter không fetch như đã apply trước khi URL commit; reload và Back giữ factory/status/mode |
| Factory switch | Delayed response A không ghi đè B; không có cross-factory counts, preview hoặc case |
| S1/P1 → S2 | Observation mới trên Overview, P1 vẫn dùng basis S1, stale case còn inspect được nhưng không force publish |
| Quyền và lỗi | VIEWER không có action write; server từ chối mutation trái phép, factory isolation, empty/missing health/unavailable/integrity UI đúng |
| Concurrency/recovery | Giữ stale/race, competing commits, SIMULATION_ONLY cannot commit, lost response và receipt replay regression hiện có |

- Tái dùng suites/harness hiện có; không bỏ assertion đang fail hoặc chỉ rerun tới xanh. Bổ sung đường đi qua Overview redesigned thay vì chỉ mở /operations trực tiếp.
- UI assertions đối chiếu trạng thái server/DB thật; không giả success bằng intercept mutation trong acceptance real-service.
- Acceptance mới chạy desktop 1280/1440/1920. Giữ mobile regression hiện có, không yêu cầu Frontend thiết kế mobile mới.
- Phát hiện lỗi sản phẩm thuộc page/Backend: báo test tái hiện + nguyên nhân + ownership; phối hợp patch tối thiểu, không tự viết lại file của nhóm khác.

## FL-04 — môi trường, CI và bằng chứng

1. Dùng PostgreSQL riêng, backend, dedicated decision worker, FastAPI và Chromium thật. Node thuộc dòng 22, >=22.22.2 theo baseline đã chạy; dùng lockfiles. Không dùng DB development hoặc credentials cá nhân.
2. Chạy 3 lần liên tiếp từ schema sạch trên cùng bộ SHA Backend/Flex/Frontend; thay code thì khởi động lại chuỗi. Ghi fixture/scenario seed và artifact của cả ba.
3. Reuse scripts/check-operations-integration.sh, backend test:operations-browser-e2e và các frontend scripts hiện có theo README/harness. Không chạy hai build/dev server dùng chung .next hoặc port.
4. Cleanup schemas/process/ports/browser cả khi pass/fail/interrupt, chỉ cleanup tài nguyên do test tạo. Không dừng dev services người dùng.
5. Client/hook/mock tests, contracts:check, typecheck, frontend build, HTTP exporter --check và CI Contracts + Operations integration phải xanh ở head cuối. CI đầy đủ gồm migration/history và build gate, không thay bằng browser-only pass.
6. Evidence: integration commit SHA + từng dependency SHA, PR URLs, Node/Python/PostgreSQL versions, lệnh, logs, kết quả từng scenario, 3 runs, screenshots desktop và cleanup result. Không ghi “passed” nếu test bị skip.

## Bàn giao hoàn tất

Một draft PR client/hook; một acceptance report gắn SHA tích hợp (có thể cùng PR). Nêu rõ data contract đã freeze, các UI entrypoint đã kiểm thật, trạng thái CI và những panel còn demo.

Ngoài scope: fix lại #44, dashboard redesign, backend domain/migration, sensor history, agent trace, MODIFY/What-if, thay model hoặc tự động điều khiển máy.
