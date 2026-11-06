# Production DSS desktop screenshots

`contract-harness/` contains browser captures at 1280×1000, 1440×1000,
1920×1000 and 2560×1440. These exercise the **real HTTP adapter against an
intercepted canonical contract harness**, not a production database or worker.
The UI does not fall back to that harness in real deployments.

Each width includes Overview (empty review and committed head), open machine
picker, selected measurements/provenance, case list, candidate comparison,
COMMIT confirmation, exact published Gantt, and service error with retry.

Examples:

- [Overview](contract-harness/overview-empty-review-desktop-1440.png)
- [Picker](contract-harness/picker-open-desktop-1440.png)
- [Inspector](contract-harness/machine-detail-desktop-1440.png)
- [Cases](contract-harness/case-list-desktop-1440.png)
- [Candidate comparison](contract-harness/candidate-comparison-desktop-1440.png)
- [Confirmation](contract-harness/commit-confirmation-desktop-1440.png)
- [Publication](contract-harness/published-plan-desktop-1440.png)
- [Machine and technician lanes](contract-harness/published-lanes-desktop-1440.png)
- [Error](contract-harness/overview-error-desktop-1440.png)

Reproduce from `frontend` with `DSS_CAPTURE_SCREENSHOTS=1`:

```sh
npx playwright test --config playwright.dss.config.ts
```

Real-service acceptance is separate: the existing Operations integration CI
runs PostgreSQL + Backend + worker + FastAPI on **three isolated reset schemas**.
The enhanced `frontend/e2e/operations-decision-flow.spec.ts` enters from the new
Overview, checks summary against PostgreSQL, uses the original journal recovery,
confirms APPROVE/COMMIT separately, checks roles, audit, stale/race boundaries,
and verifies observation S2 preserves the published immutable S1 basis and that
an earlier case publication is not replaced with the latest head.

Real screenshots, evidence JSON, deterministic replay summary, trace/failure
diagnostics and logs are attached to the CI run artifact, pinned by Git SHA.
The draft PR records the exact head, CI merge SHA and artifact/run URL after
completion. Do not describe the contract captures above as real-service evidence.
