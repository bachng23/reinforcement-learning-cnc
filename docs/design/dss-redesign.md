# Industrial DSS desktop redesign

> Initial overhaul record. The latest visual direction is the user-selected Dub reference, documented in [dub-design-selection.md](dub-design-selection.md). Current previews and desktop verification describe that revision.

14 October 2026. Branch: `frontend-redesign`.

## Design intent

The application supports maintenance decisions: notice a case, inspect source evidence, compare available options, record a human review and verify the result. Every surface follows that path. The research brief in [dss-research.md](dss-research.md) documents eight primary sources, their limits and the design interpretations drawn from them.

The previous interface foregrounded an expansive factory map with small labels and weak text contrast. Important review work appeared below it. The sidebar changed width on hover, the decision-case button did nothing, and fixture-backed operational data was labelled live. The overhaul addresses those problems across the application rather than changing only the dashboard colors.

## Visual direction and scope

Taste Skill direction: **The product performs**, seed **223641025**. No slots were redrawn. The retained blue/neutral brand was refined for text contrast and industrial status semantics. The idea: **M03's risk-to-technician transition becomes an inspectable factory workspace with evidence and the next action beside it.** The live interaction is machine selection and explicit pause/step/reset of a labelled demo replay.

This is an authenticated desktop DSS, outside the skill's default landing-page scope. The user's explicit direction takes priority. The design retains functional form/table borders, compact metadata, readable status labels and product controls. It omits ornamental photographs, video, huge marketing display type and entrance choreography. These exceptions are recorded in the desktop verification output, rather than disguised as standard marketing-page conformance. Desktop widths are 1280, 1440 and 1920 pixels; no phone-specific redesign was added.

The design system uses a navy navigation spine, cool neutral canvas, white workspaces, one blue action accent, semantic warning/success colors, native system typography and consistent controls. Reading copy is 16px; supporting metadata is 13–14px. Keyboard focus stays visible, controls give hover/press feedback and reduced-motion preferences remain supported.

## Screen responsibilities

| Screen | Redesign and purpose |
| --- | --- |
| Operations overview | Put source mode, snapshot metrics and the priority case above the factory; show a clearly labelled three-cell demo subset, selected machine evidence and replay controls. |
| Decision Center | Persistent filters and side-by-side queue/evidence workspace. Unreviewed rows precede completed reviews, retaining adapter priority within each group. Recommendation scope and joint cost estimate lead the evidence view. |
| Human-review dialogs | Display the complete joint action before confirmation. Approve/reject/override stay explicit; override needs a changed action and reason. Trap focus, support Escape when idle and restore the opener. |
| Agent Control Room | Evidence-gathering and downstream components beside an inspector of tools, authority and outputs. Recorded events expose structured evidence without pretending to show live or private reasoning. |
| What-if Workspace | Scenario assumptions beside exact baseline/result values, contextual tradeoffs, warnings and a recorded trace. Changing a preset clears the prior result. |
| Experiment register | Scan experiment identity, policy, lifecycle, episode counts and owner in aligned rows; keep API pagination and refresh. |
| Create experiment | Group policy, CNC environment and cost/risk configuration beside a sticky section outline and current configuration summary. Preserve all contract fields and validation. |
| Experiment detail | Foreground counts and full-width episode rows; keep lifecycle timestamps and run configuration in disclosures. Preserve idempotent execution and polling. |
| Episode detail | Readable result labels with original identifiers in tooltips, exact returned values, current/historical attempt context and expandable chronological evidence. Preserve retry/cancel/partial states. |
| Administration | Searchable role-filtered directory, inline edit forms, accessible active switch, and an explicit deactivation dialog. Retain backend persistence and administrator verification. |
| Sign-in and system states | Focused sign-in form, honest product explanation, useful error/loading/not-found states and recovery actions using the same design system. |

## Data and behavior boundaries

Operations, agent activity and what-if ports remain labelled demo/recorded data until their live services are connected. UI-only machine drawings, sample health/load history and replay stage copy live in `frontend/lib/operations-ui/factory-replay.ts`. Sample history precedes the replay clock. The replay starts paused, stops at the final stage, resets deterministically and leaves health unchanged when service starts. It does not claim maintenance completion or execute a real assignment.

Research and decision screens retain their existing typed API adapters. No risk, RUL estimate, CVaR, per-machine cost or confidence was synthesized. Missing values remain unavailable. Selection and navigation do not open a review. A real recommendation with an unlinked review can now reach explicit confirmation; opening/submission remains idempotent and backend conflicts remain visible. History copy acknowledges that an unlinked browser-session record does not prove no review exists elsewhere.

No external photography, generated raster assets, footage, stock imagery or invented testimonials were used. CNC drawings are interface illustrations, not product photographs. All sample operational claims remain fixture-derived or explicitly labelled UI samples. Production authentication still ignores the existing development bypass flag.

## Verification

- Production build passed with an isolated `.next-dss-review` output directory and mock Product API for screenshot review.
- TypeScript validation passed as part of the production build and through `npm run typecheck`.
- `npm run lint`: no ESLint warnings or errors.
- `npm test`: **51 tests passed across 12 files**. Coverage includes API/normalization contracts, experiment creation and idempotent execution, episode retry/cancel/attempts, decision filtering/review/conflicts, read-only inspection, evidence retry, focus trap/Escape/focus restoration, sign-in and administrator access/deactivation.
- Taste source lint: **0 FAIL**, 2 intentional warnings for actual form/secondary-control outlines.
- Chrome production-preview review: **42 screen/state × viewport captures**, covering 14 screens/states at **1280, 1440 and 1920px**. Final application-adapted probe: no remaining findings, no horizontal page overflow and no captured runtime exceptions. See [desktop-verification.json](desktop-verification.json).
- Screenshot QA used the in-memory Product API and intercepted GET auth/users responses. It sent no production review, account mutation or machine action. This is not an end-to-end test of the connected live backend, operator usability study, or ISA/ISO/WCAG certification.

Three review rounds improved hierarchy, removed cramped episode metadata, promoted the review path, strengthened reading copy and bounded long text measures. The final self-critique is a design judgment, not a user-study result:

```text
ROUND 3
Seen in one second: the priority maintenance case and the next review action.
Idea: source evidence and a joint recommendation form an inspectable maintenance workspace.
Live thing: machine selection/replay, queue inspection, scenario comparison and explicit review.
Layout words: overview=summary/stage; decisions=master/detail; agents=component/inspector;
scenarios=assumptions/comparison; experiments=register; create=outline/form;
episode=summary/disclosure; access=directory; sign-in=split.
Scores: design 8 · usability 8 · creativity 7 · content 8 → overall 7.8.
Caps applied: marketing-only photo/motion rules excluded under the desktop DSS brief.
Remaining limits: demo operations/services, browser-session decision-history recovery,
and no task evaluation with intended industrial users yet.
```

## Review images

[Overview](previews/overview.jpg) · [Decision Center](previews/decisions.jpg) · [Review dialog](previews/decision-dialog.jpg) · [Agents](previews/agents.jpg) · [Scenarios](previews/scenarios.jpg) · [Experiments](previews/experiments.jpg) · [Create](previews/new-experiment.jpg) · [Experiment detail](previews/experiment-detail.jpg) · [Episode results](previews/episode-detail.jpg) · [Administration](previews/admin.jpg) · [Sign-in](previews/login.jpg).
