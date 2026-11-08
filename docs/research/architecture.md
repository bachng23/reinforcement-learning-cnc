# Research architecture and capability inventory

Snapshot: 30/10/2026, Asia/Taipei.

The research repository owns scientific semantics and evidence. This application
owns immutable artifact indexing, authenticated access, bounded job execution and
presentation. No training or TEST-opening endpoint is exposed.

## Implemented boundaries

| Capability | Implementation and scope |
| --- | --- |
| JCST wire contracts | `ai_services/domain/jcst/contracts.py`; schema in `contracts/jcst/v1`, generated TypeScript, independent of CNC v2/Operations v3 |
| Physics and controls | Five unchanged upstream files in `ai_services/vendor/jcst`, verified against `manifest.json` at runtime; source commit `c577b6be26f40de5f539cee0bc1b99a3405e0f7e` |
| Data persistence | ResearchCampaign/Run/Artifact/Episode/Job/Review tables; training-root/checkpoint/panel identities retained in typed immutable result metadata |
| Import | Queued, bounded bundle import; original UTF-8 artifacts retained by hash, included physical traces independently replayed before publication |
| Scientific findings | SE1 exporter retains original manifest/report/root table/audits and projects 480 points and six contrasts; no statistics rerun or pooling with other studies |
| Replay | Before/after component state, machine mode, technician remaining time, actions, costs, H/tail and physical events; complete traces served in bounded pages |
| Learned inference | Server-registered S/A/F checkpoints, strict source/config/catalogue/Torch/hash checks, explicit CPU greedy mode, no fallback or training |
| What-if | Legal action override and matched baseline at an H boundary; identical copied state, continuation control and physical noise; source trace immutable |
| Management | Immutable ACCEPT/REJECT simulation reviews with reasons and output-basis hash, audit log; no operational publication or assertion that real maintenance occurred |
| Packaging | Local independent runtime lock; controls-only Compose research profile and optional inference override; runtime build requires explicit dependency installation |

Controls are threshold5/risk/corrective/WAIT. The regular API can read all research
data without importing Torch. The isolated inference environment has its own
Python/dependency lock. Long work runs in a child process owned by a fenced worker.

ResearchRun metadata retains campaign/study/run, arm, root, checkpoint, case,
evaluation mode and cost projections. Dedicated normalized tables for every
training root/checkpoint/evaluation row are not required for the bounded evidence
browser; they can be added if measured query load requires them. The original
analysis is always reachable. No raw evaluation row or root is silently replaced.

## Live Application demo

Application routes now use owner-scoped `DemoSession` state, separate from immutable
campaign evidence. `demo_init`, `demo_prepare` and `demo_commit` call the pinned
physics and registered policies. Both lanes advance one interval per accepted
command, with optimistic revision checks and an audit record in the same database
transaction. Human decisions freeze the boundary; no-alternative WAIT intervals
continue automatically. Complete sessions independently replay both full traces.

Incident mode has an explicit shared WAIT prelude until the first failure. Policy
mode evaluates both checkpoints from tick 0. Both use an engineering-only seed,
fixed root-0/96k releases, H=48 and tail=16. Human overrides are labelled separately;
raw single-episode differences do not create a scientific superiority gate.

## Evidence vocabulary

`SUCCEEDED` means the application job completed. Artifact hash verification,
local physical replay of included traces, source-reported statistical audit and
the source protocol's scientific gate are separate values. Import never grants
local statistical PASS. Missing raw data, trace or checkpoint does not trigger
regeneration. Public findings can be represented with a retained source artifact;
replay is available only when the bundle actually contains a complete trace.

SE1 supports S/A sample-efficiency area advantages against F in the locked cases
and window. S−A remains inconclusive. The app does not turn that into a new RL
algorithm, a two-actor framework, equivalent architectures, matched-wall-time
superiority, calibrated real money savings or industrial deployment evidence.

## Compatibility and application scope

User/authentication, existing audit and operations persistence stay in place.
Legacy tool replacement remains under CNC v2; the simplified scheduling planner
remains under Operations v3. Neither is a second JCST simulator. Legacy write
endpoints can be disabled independently while old deep links remain readable.

The source checkout inspected for this migration contains decision cases,
recommendations and publication infrastructure. Complete Work Order, Incident
Center and Maintenance Analytics modules were described in task documents but
are not present as corresponding complete models/routes here. This release
provides the simulation-review projection rather than claiming those modules
were completed. ERP/MES integration, production optimization, sensor ingestion,
LLM explanation and full scientific campaign scheduling remain optional work.

The older RA-QMIX/FIFO and PdM–FJSP product plans are historical direction. Their
future implementation priorities are superseded by the research migration plan;
their review evidence and contracts retain their original meaning.

## Source pin correction

Git tree inspection during implementation showed that the earlier planning
snapshot's `ff3bd63...` commit did not contain the JCST source files. The verified
source publication `c577b6be...` does. The immutable source bundle uses that commit
and per-file hashes. Neither upstream scientific source nor original lab data
was modified to establish this adapter.
