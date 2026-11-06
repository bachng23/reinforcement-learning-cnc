# Production DSS desktop — route and authority handoff

## Baseline / coordination

The requested local `frontend-redesign` / `d5458c3` is unavailable. The owner
authorized implementation from current main on 2026-10-23. New branch:
`frontend/production-dss-desktop`, based on `f8d9483` (includes `64dc391` and #44).
No unrelated local checkout, backend/AI source, generated DTO or Flex read hook
is replaced. Do not merge automatically.

Dependencies: frozen P0 HTTP contract (`contracts/v3/p0-contract.md` and exported
Operations OpenAPI); Overview Backend #45 `9404ecb35810501d82f1428e9ccadcc77275bf35`;
Flex #47 `86ed39fdd30713af8d49d798d1e0fe7e3ddefac0` (merged in main).

## Route map (published before new browser E2E)

| Route | Purpose / navigation |
| --- | --- |
| `/overview?factory_id=F` | The single production factory Overview |
| `/operations/cases?factory_id=F&status=…&mode=…` | Production Decision Center; preserve #44 committed URL/Back/reload |
| `/operations/recommendations?caseId=UUID&factory_id=F` | Existing case workflow; case API owns factory; a conflicting hint fails closed |
| `/operations?factory_id=F` | Factory resources drill-down and existing create-case entry |
| `/operations/schedule?factory_id=F` | Current publication using its immutable `basis_snapshot` |
| `/operations/schedule?factory_id=F&caseId=UUID` | Exact case publication, read through existing case/artifact APIs, not a fabricated historical endpoint |
| `/decisions` | Retained research v2 workflow; secondary research navigation only |
| `/experiments`, `/operations/agents`, `/operations/what-if` | Retained research/demo; not claimed production-live |

Production routes default to real mode regardless of an old local mock default.
Explicit `demo=1` selects the preview adapter; links preserve that flag, visibly
label demo and never merge its cases/counts with real state. Factory parameters
persist through links, refresh and router navigation. No read/navigation sends POST.

## Lightweight desktop wireframe

```text
navy sidebar        Factory / snapshot captured / summary read / Refresh
Overview            Total machines | LIVE review | LIVE approved | LIVE processing
Decision Center     Backend review preview (newest)      Machine status distribution
                    Published head / basis / schedule / resources links
Research (secondary)Choose machine [search + six status groups]
                    Selected machine measurements + provenance, not demo replay
                    Existing create-case form (authorized roles, exact context)
```

Summary counts/coverage/preview come only from `useOperationsOverview`. Inspector
uses the existing synchronized context hook; factory/snapshot/plan and an optional
head revision must agree before entities or create controls render. A mismatch is
not empty and requires review/refetch. No health/risk/utilization KPI is derived.
Machine groups count returned entities only, explicitly scoped to that snapshot.
No history API exists: show current measurements/units/source/time and unknowns.
The UI observes the same summary-client error only to display a supplied
correlation/request reference. It does not issue another fetch, replace the Flex
hook state, expose raw diagnostics, or introduce another summary DTO.

The existing journal, selected-candidate identity, confirmation, command gating,
lost-response recovery, conflict review, APPROVE versus COMMIT and audit reads
remain the lifecycle. VIEWER has no write CTA. COMMITTED publication takes display
precedence over its subsequently stale original basis. Published schedules use
their immutable package/basis, never current machine/job/technician observations.

## Verification / handoff checklist

- Component tests: scoped links/KPI drill-down, all six statuses, picker keyboard,
  selection reset/focus, unknown measurement, mismatch/empty/auth/error, action UI.
- Preserve existing #44 filter URL/Back/reload and #37 journal/decision regressions.
- Desktop 1280/1440/1920, smoke 2560; no page overflow/cut controls, readable tables.
- Screenshots: Overview, open picker, detail, cases, candidate/confirmation,
  publication and error/empty. Label contract-harness versus real-service evidence.
- contracts:check, typecheck, lint, unit tests, browser regressions, production build.
- Draft PR includes route map, exact source/dependency SHAs, real/demo inventory.
- Real Overview → create → worker → approve → commit → schedule/history through the
  existing dedicated-schema CI harness. Verify S1/P1 → S2 keeps P1 based on S1.
  Do not substitute passing mock tests for real acceptance; no automatic merge.

## Implemented real/demo inventory

| Surface | Data and authority |
| --- | --- |
| Production Overview | Flex `useOperationsOverview`; server counts, preview and coverage |
| Machine inspector / create | Existing synchronized snapshot/schedule hook; context must match Overview |
| Decision Cases | Existing list hook and backend cursor chain; #44 URL commitment retained |
| Recommendation / actions / audit | Existing case/artifact/event reads and #37 action journal; backend gating |
| Current schedule | Current-schedule API's immutable `basis_snapshot`, not observation snapshot |
| Case publication | Existing case/artifact APIs plus commit identity; never substitute a later head |
| Explicit `demo=1` | Canonical mock adapter only, visibly labelled, isolated session cases/IDs, no backend writes |
| Agents / What-if | Retained research/fixture UI, secondary navigation; not claimed live |
| `/decisions` / experiments | Retained v2 experiment/research workflows; no lifecycle redesign |

[Screenshot inventory and reproduction](screenshots/production-dss/README.md).
Draft PR #50 was opened at route-map commit `36a20fb` **before** adding new E2E.
Tests include totals versus a bounded preview, six statuses/search/keyboard/focus,
missing measurements, context mismatches, correlation clearing, scoped navigation,
VIEWER CTAs, immutable case publication and existing filter/journal regressions.
CI supplies the final SHA-specific real-service acceptance evidence in the PR.
