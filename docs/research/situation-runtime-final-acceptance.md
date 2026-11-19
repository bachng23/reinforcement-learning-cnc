# Final acceptance — 2026-11-19

Supersedes the two evidence gaps in the initial acceptance report.
Merged main baseline: `72af5ecda40833e3c9aaa68f6977f08937fa5814`.
Tested baseline plus assertion-only commit: `485641b43d7f6423f4a973843f15abac54fdf2e7`.
No application or runtime business behavior was changed for this follow-up.

All seven real-service assertion groups passed. PostgreSQL, the real Python
bridge, Express, Next and Chromium ran without API interception or fixture fallback.
The original healthy/immediate/scheduled/repair/review/retry/reload cases passed.
Additional assertions read the persisted PostgreSQL runtime and consume real bridge
responses to check independent audit, the injected UUID/source and physics/injected/
total counters. Chromium verifies the APPLIED incident in Activity with its exact
workflow UUID and in the Incident notifications region with M3/C2 identity.

Focused runtime regression: **19 passed in 10.63 seconds**.
The first exploratory harness run failed because the test replayed an APPLIED DTO;
the corrected test sends the original SCHEDULED request and checks receipt output.
Only the completed run below is recorded as PASS.

[Machine-readable evidence](situation-runtime-final-evidence.json).
Full logs, screenshots and browser trace remain at:
`artifacts/situations-real/485641b43d7f6423f4a973843f15abac54fdf2e7/product_api_it_situations_089168f41b943b36/`.
Cleanup verified schema deletion and ports 62846/51271 closed; a separate SQL query
returned zero remaining acceptance schemas. The task-owned container was removed.

Original implementation PR #69 is merged. At its final head `6bdcdd6`, Contracts,
Operations integration and JCST research all succeeded. This report does not claim
CI results for the follow-up commit before its own checks complete.

Use the existing [runbook](situation-runtime-runbook.md) to reproduce. Registered
learned-policy tests still need real checkpoint releases; the brief's acceptance
uses built-in heuristic policies. Intervention Compare/scientific replay remains
explicitly unsupported as agreed in M0. Forced-kill cleanup was not an acceptance
requirement of this brief and is not asserted by this run.
