# Technician availability acceptance

M0 was approved by the user on 2026-11-19 (Backend protocol plus action mask).
Main baseline: `72af5ecda40833e3c9aaa68f6977f08937fa5814`.
Runtime branch: `backend/jcst-technician-availability`.
Integrated real-service SHA: `52720b63a38db69740514a16b26b7e24e4905a83`.
Backend partner: `145edb0ce73eddee3bfa881ac26730781c1d5d1f`.
Frontend partner: `42521ad0c923f6b97555f390451bccaef2cbd73b`.

## Executed checks

- Runtime/situations/inference/research regression: **58 passed, 1 skipped**.
- Final focused availability tests, including common-snapshot comparison after
  injected history: **18 passed**. This includes a follow-up Compare-only fix
  after the real-service SHA: fork from frozen state without relabelling prior
  primary records as baseline history. Its new regression passed.
- Backend technician protocol/contract: **9 passed**, two suites.
- Frontend technician client/HTTP/read/write/component: **62 passed**, five files.
- Real PostgreSQL + authenticated Express + real Python JCST + Next + Chromium:
  **all eight assertion groups passed**, no API interception or bridge double.

The integrated journey uses base, seed 990000001, corrective/wait and continuous
mode. T1 absence is [0,3); zero-time write increments revision once. API receipt
replay, read-only GET, saved-calendar reopen, exact expiry and SYSTEM event all
pass. M3/C2 receives a real controlled incident; proposal/catalogue/override exclude
T1. T2's CM dispatch and completion are real simulator transitions. Return at
REVIEW invalidates the old proposal and makes T1 eligible on prepare.

The all-absent case checks WAIT-only catalogues, state-derived ABSENT warnings,
no assignments before returnTick and policy re-evaluation on return. A separate
wait/threshold5 session runs until the baseline policy really starts a repair;
primary remains idle, absence is accepted, baseline completes its existing job
and receives no new absent-worker assignment. No handcrafted baseline job is used
for this API acceptance case.

Chromium creates T1 absence, observes ABSENT, creates M3/C2 incident, reloads,
requests the masked proposal, approves CM, returns T1 early at tick 1, and sees
the repair complete at tick 2. Real screenshots are in
`docs/test-evidence/technician-runtime/`.

[Machine-readable evidence](technician-availability-evidence.json).
Full local logs, screenshots and trace:
`artifacts/situations-real/52720b63a38db69740514a16b26b7e24e4905a83/product_api_it_situations_237a2798ac67660b/`.
Schema dropped, API port 58392 and frontend port 49527 closed. Independent SQL
count was zero remaining acceptance schemas. The task-owned PostgreSQL container
was removed; no development database was used.

## Evidence boundaries

S/A/F tests execute the real Torch models with synthetic compatibility checkpoints
for both configs and compare masked argmax against the upstream implementation.
They do not substitute for historical trained releases. None were configured;
the registered historical checkpoint regression is the single skipped test.
The original encoder/job-idle features, weights, vendor source and training
artifacts are unchanged. Results are engineering-only.

Common-snapshot comparison is provided as a bounded Backend Python callable with
calendar-aware cache identity and independent replay; the existing UI honestly
requires a common snapshot rather than comparing divergent old lanes. This task
does not introduce a public Compare endpoint. Finite scientific replay with
availability fails explicitly as unsupported. GitHub CI and merge status for this
new branch are not claimed by these local checks.

The initial exploratory browser launch failed because npm ci had not finished;
after dependency installation the real-service run succeeded. Only completed
assertion groups in the linked final evidence are marked PASS.

Reproduction and recovery: [runbook](technician-availability-runbook.md).
