# Semantics review — Operations Contract v3

## Kết luận

Contract `3.0` đủ biểu diễn demo planning v1 nếu giữ rõ ranh giới giữa structural
validation và feasibility validation. Không cần đổi schema cho deliverable này.

| Chủ đề | Semantics đã khóa |
|---|---|
| Thời gian | Timestamp timezone-aware; duration `_minutes`; latency `_ms`; schedule interval nửa mở `[start_at,end_at)` tại validator |
| Machine eligibility | `Operation.machine_options` là allowlist theo operation; machine còn phải có capability tương ứng và không `FAILED/UNAVAILABLE` |
| Technician skill | Match theo `skill_id`, minimum level, machine-family certification và action-type certification; team có thể phủ nhiều required skill |
| Schedule assignment | Pydantic kiểm tra discriminated shape, reference và planning-window containment; overlap/precedence/availability là hard constraints contextual |
| Validation verdict | `VALID` = kiểm tra hoàn tất, không ERROR; `INVALID` = có ERROR violation; `ERROR` = validator không thể kết luận |

## Điểm cố ý không nhét vào Pydantic model

`Schedule` không tự kiểm tra resource overlap. `FactorySnapshot` không tự kết luận
technician đủ skill cho một candidate. Những kiểm tra này cần snapshot + candidate +
policy version, nên thuộc `PlanValidation` và được định nghĩa trong
`constraints-v1.md`.

## Giới hạn v1 cần nhớ

- Contract chưa có machine calendar riêng; v1 dùng assignment `BLOCKED_TIME` và
  machine status để biểu diễn unavailable time.
- Cost không có currency field; deployment/scenario phải cấu hình cùng currency.
- `processing_minutes` là estimate đầu vào; v1 chưa khóa assignment duration phải
  bằng estimate, nên solver/validator cần ghi policy nếu cho setup/buffer.
- Maintenance assignment hiện luôn là intervention và schema đã bắt buộc technician.
- `FactorySnapshot` chứa current state, không chứa simulator latent state.
