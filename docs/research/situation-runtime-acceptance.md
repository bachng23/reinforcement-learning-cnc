# Runtime acceptance — 2026-11-16

M0 is approved. M1 runtime and M2 real-service scenarios have been exercised.
Base main: `30a27f820e511567f7fad8199f123f75646cd9f3`.
Runtime commits: `0821c4901ec781508cbfcef1ae2d95de6bef478d` and
`b3698e2b518101d4a375c6e83095e8daced2af3d`.
Integrated tested SHA: `4ad2b37570a4e52be2a86f61b1a2c10e13bc2976`.
Partner SHAs and reproduction commands are in [the runbook](situation-runtime-runbook.md).

## Results

- Python runtime/research/inference/demo regression: **40 passed, 12 skipped**
  in 23.21 seconds. Eleven demo tests and one inference test require an explicit
  registered checkpoint registry. This is not learned-policy verification.
- Real PostgreSQL + Express API + Python JCST bridge + Next + Chromium:
  **all five assertion groups passed**, without intercepted APIs or bridge doubles.
- Exact healthy snapshot continuation and identical primary/baseline histories.
- Immediate tick-zero injection, health UUID provenance, idempotent receipt,
  REVIEW conflict, saved review approval, remaining-one repair snapshot and
  completed work order linked to the same injected failure UUID.
- Scheduled tick-two event: identical step/autoplay state and persisted APPLIED.
- Saved snapshot unchanged after reads and branch activity.
- Browser authenticated save/open, paused restoration, immediate injection,
  reload showing APPLIED without duplicating the event.
- Cleanup: schema dropped; API port 62935 and frontend port 62927 closed.
  Independent PostgreSQL query found **zero** remaining acceptance schemas.

Machine-readable summary is [situation-runtime-evidence.json](situation-runtime-evidence.json).
Full local logs, screenshots and Playwright trace are in the integration checkout:
`artifacts/situations-real/4ad2b37570a4e52be2a86f61b1a2c10e13bc2976/product_api_it_situations_55ce270a7fe56237/`.

## Scope of this evidence

Runtime unit tests additionally verify natural-failure-before-scheduled-event
skipping, busy-machine precedence, simultaneous targets, invalid inputs/releases,
completion boundary ordering and exact restoration after trace eviction.
These are unit assertions, not additional browser journeys.

Normal successful cleanup was verified. Signal handlers exist, but a forced-kill
acceptance run was not performed. Cross-policy Compare and finite scientific
replay through interventions remain explicitly unsupported under the approved M0.
GitHub CI/PR status is not asserted by this local report.
