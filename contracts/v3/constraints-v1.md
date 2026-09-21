# Hard constraints v1

Tài liệu này là policy cho validator của Operations Contract v3. Pydantic contract
chỉ kiểm tra shape, local invariant và reference integrity; validator phải kiểm tra
các constraint dưới đây với toàn bộ `FactorySnapshot` và `CandidatePlan`.

## Quy ước đánh giá

- Tất cả timestamp là instant có timezone. Artifact demo serialize bằng UTC (`Z`).
- Duration được đo bằng phút. Khoảng thời gian dùng semantics nửa mở
  `[start_at, end_at)`, vì vậy một assignment kết thúc đúng lúc assignment khác bắt
  đầu không overlap.
- Bỏ qua assignment có status `CANCELLED`. Các status còn lại đều chiếm resource.
- Mỗi hard-constraint failure tạo ít nhất một `ConstraintViolation` severity
  `ERROR`, với `constraint_code` ổn định như bên dưới.
- Warning không thay đổi tính khả thi.

## HC-01 — Precedence (`PRECEDENCE`)

Với mỗi production assignment của operation `successor`, mọi predecessor chưa có
status `COMPLETED` phải có production assignment trong cùng candidate và:

```text
predecessor.end_at <= successor.start_at
```

Operation đã `COMPLETED` được xem là thỏa precedence mà không cần xuất hiện lại
trong candidate. Thiếu predecessor chưa hoàn tất hoặc successor bắt đầu sớm đều là
`ERROR`.

## HC-02 — Machine eligibility (`MACHINE_ELIGIBILITY`)

Một production assignment hợp lệ khi:

1. `(job_id, operation_id)` tồn tại và thuộc đúng job;
2. `machine_id` có trong `operation.machine_options`;
3. machine có capability cho `operation.operation_type`;
4. machine không ở status `FAILED` hoặc `UNAVAILABLE`.

`WARNING` vẫn eligible; risk của nó được phản ánh trong KPI/objective. Eligibility
không được suy ra chỉ từ `machine_family`.

## HC-03 — Machine capacity overlap (`MACHINE_CAPACITY_OVERLAP`)

Hai active assignments trên cùng machine không được giao nhau. Với hai interval A
và B, overlap tồn tại khi:

```text
A.start_at < B.end_at and B.start_at < A.end_at
```

Constraint áp dụng chéo cả `PRODUCTION`, `MAINTENANCE` và `BLOCKED_TIME`.

## HC-04 — Technician availability (`TECHNICIAN_AVAILABILITY`)

Mỗi technician của một active maintenance assignment phải:

1. tồn tại trong snapshot;
2. không có status `OFF_SHIFT` hoặc `UNAVAILABLE`;
3. có toàn bộ assignment interval nằm trong ít nhất một availability window;
4. không được gán vào hai maintenance assignment overlap nhau.

Availability không được ghép từ hai window liền kề trừ khi upstream đã chuẩn hóa
chúng thành một window.

## HC-05 — Technician skill adequacy (`TECHNICIAN_SKILL_ADEQUACY`)

Với mỗi `required_skill_id` của maintenance request, phải có ít nhất một technician
được gán có skill cùng ID và `level >= minimum_skill_level`. Skill record đó đồng
thời phải chứng nhận đúng `machine.machine_family` và
`maintenance_request.action_type`.

Team có thể phủ các required skill bằng nhiều technician. Danh sách certification
rỗng nghĩa là không có certification, không phải wildcard.

## HC-06 — Intervention staffing (`MAINTENANCE_TECHNICIAN_REQUIRED`)

Mọi active `MAINTENANCE` assignment đại diện một intervention và phải có ít nhất
một `technician_id`. `CONTINUE_AND_MONITOR` không tạo maintenance assignment; nếu
không có intervention thì constraint này không áp dụng.

## Mapping verdict

- `VALID`: validator hoàn tất và không có violation severity `ERROR`.
- `INVALID`: validator hoàn tất, chứng minh plan không khả thi và có ít nhất một
  violation severity `ERROR`.
- `ERROR`: validator không thể đưa ra kết luận (timeout, dependency lỗi, policy
  version không hỗ trợ). Đây không phải synonym của `INVALID`.

Chỉ candidate có verdict `VALID` mới được đưa vào `RecommendationPackage`.
