# Dub reference applied to the industrial DSS

14 October 2026. Branch: `frontend-redesign`.

## Reference review and selection

The three user-provided documents describe visual references, including reconstructed components and interpreted recommendations. Their embedded agent prompts and imperatives were treated as reference material. The user's desktop DSS requirements determine the implementation.

| Document | Direction | Fit for this application |
| --- | --- | --- |
| `DESIGN.md` | Steep: serif editorial analytics, peach accents, 24px cards and very large headlines | Attractive for a product presentation, but the large typography, spacing and soft shapes would reduce useful operational information in the first screen. |
| `DESIGN (1).md` | **Dub: white paper surfaces, fine structural borders, compact UI, neutral typography and restrained blue** | **Selected.** It explicitly includes dashboard tables, navigation, inputs and technical metadata. Its information density and flat surfaces support quick comparison and investigation. |
| `DESIGN (2).md` | Ventriloc: warm editorial data presentation, orange/brass accents and asymmetric shapes | Its data-first imagery is relevant, but the large section gaps, display typography and distinctive shapes would add emphasis unrelated to operational priority. |

This is one adapted Dub direction. Steep's serif/peach treatment and Ventriloc's orange/asymmetric treatment were not combined into it.

## Implementation decisions

- White workspace panels on a near-white canvas; light sidebar with a small blue active state. Structural borders use `#e5e5e5`. Primary and secondary text use `#171717` and `#525252`.
- Near-black primary actions, matching Dub's filled dark button component. The source also proposes sapphire primary fills elsewhere; the neutral version gives a consistent action hierarchy and reserves blue for links, selection and focus.
- Outer panels use 12px radii, controls 8px, inputs 6px and small status badges pill radii. Nested evidence values use dividers instead of repeated tinted cards. No decorative 3D machine drawings, gradients, texture or floating marketing elements.
- Page headings use 30px medium-weight sans serif. Paragraphs use 16px where explanatory; data, source notices and supporting labels use 13–14px. Native system sans serif and native monospace are the actual rendered families; licensed Satoshi and Inter font assets were not supplied or added.
- Numbers use monospace with tabular figures where they are compared. Numeric columns align right, text columns left and status columns center. Scenario comparisons and episode counts follow the same rules.
- Compact and Comfortable control table row padding and repeated evidence spacing. The preference persists locally across workspace pages; disabled browser storage falls back to a session preference.
- Table headers and the identity column remain sticky inside bounded scroll regions. Search, filter and sort controls are explicit and keyboard accessible. Experiment filtering/sorting is accurately labelled as applying to the loaded page, because the current API only provides pagination.
- Desktop spacing stays appropriate for an authenticated app. The reference's 1200px marketing container and 64px section gaps become a bounded 1840px workspace and 16–20px working gaps. No mobile-specific layout was added.
- The user's semantic status requirements take precedence over decorative color guidance: red denotes risk/failure, amber caution, green completion/approval. Text labels accompany color. Blues and tints are kept out of large content surfaces.

## Decision-oriented overview

The first screen leads with snapshot metrics and a factory-level overview, followed by the priority maintenance case. The overview shows the distribution of reported machine states, one aggregate load trend and the decision workload. It does not repeat individual machine names or per-machine charts from the inspection workspace below.

The snapshot inventory contains 12 machines, while only three have recorded operating state and comparable load series. Nine remain explicitly **Not reported**; no operating, faulted or maintenance states are inferred for them. The load trend is labelled **Mean reported load** and **3/12 machines with load history**. It is the simple mean of available source readings, with a change in percentage points from the first recorded sample. It is not presented as measured utilization for the entire factory, and no chart is drawn when suitable series are absent.

The attention table provides machine/case search, status filtering and sorting by machine or priority. Inspecting a row opens the matching evidence and moves keyboard focus to it. The factory overview links to the attention queue and the machine-inspection workspace. Changing the selected machine leaves factory aggregates unchanged. M07 has a case record but no health/load sample series; its detail explicitly reports that absence instead of substituting M03's samples. Operational fixture machine IDs are not presented as direct links into unrelated research recommendation IDs.

The factory overview refinement passed 59 tests across 13 files, TypeScript, lint and the production build. Chrome checks cover aggregate scope, the full inventory denominator, navigation and layout at five desktop widths. See [factory-overview-verification.json](factory-overview-verification.json) and [factory overview](previews/factory-overview.jpg).

Machine evidence and the labelled dispatch replay now sit below the investigation table. The replay retains explicit play, step and reset controls. It does not claim maintenance has completed or fabricate an improvement in health.

### Machine inspection refinement

The machine-evidence workspace now uses one **Select machine** control instead of repeated machine cards and a schematic technician bay. Its searchable directory groups machines as at risk, faulted, operating normally, under maintenance and status not reported. Counts come from recorded entries. The current demo has no faulted machine; that group remains explicitly empty rather than fabricating a failure. M07 remains selectable with case evidence and a clearly unavailable history.

The selected machine's context sits on the left; a large health/load chart takes the remaining width. The chart is 260–300px high, has an explicit 0–100% axis, and positions samples at their actual elapsed times. Clickable points and keyboard-accessible time buttons reveal exact health/load values and change in percentage points relative to the first sample. No additional predictions or thresholds are inferred. The optional M03 replay is collapsed by default and pauses when closed.

The selector supports search, Escape, outside-click dismissal and normal keyboard navigation. Selecting a machine moves focus to its evidence. The refinement passed 56 tests, TypeScript, lint and the production build. Chrome verified selection, empty/search states, missing histories, replay grouping and large chart layouts at five desktop widths with no captured runtime exceptions. See [machine-inspection-verification.json](machine-inspection-verification.json), [machine evidence](previews/machine-evidence.jpg) and [the selector](previews/machine-picker.jpg).

The shared design applies to Decision Center, review dialogs, agents, scenario comparisons, experiment creation/results, episode evidence, user administration, sign-in and system states. Existing authentication, review confirmation, execution, cancellation and retry behavior remain intact.

## Boundaries and validation

The research and backend limitations documented in [dss-research.md](dss-research.md) still apply. Overview/agents are recorded demo data. What-if presets display recorded simulator outcomes; this redesign does not provide a new server-side parameterized simulation endpoint or invented slider calculations.

Validation includes the production build, TypeScript, lint, 59 tests and Chrome review at 1280, 1440, 1920, 2560 and 3840px. The browser uses mock product records and intercepted GET-only authentication/user fixtures. It does not submit production reviews, mutate accounts or operate machines. Browser checks cover density persistence, search, status filters, matching evidence, keyboard focus, column alignment, sticky table structure, sidebar collapse and factory-level aggregate scope.

Taste Skill's inspector was used as an auxiliary browser check. Landing-page rules for photographs, oversized focal points, animation, boxed app panels and dense text are explicitly outside this application brief. Numeric monospace is required by the user and the chosen reference. The remaining mixed-font metric and caution-text contrast warnings are design judgments to review, not hidden failures or a claim of standards certification.

See [desktop-verification.json](desktop-verification.json), [desktop-interactions.json](desktop-interactions.json) and the updated [overview preview](previews/overview.jpg).

## Color refinement — 15 October 2026

The user found the initial monochrome treatment too plain. The updated direction
keeps the same information hierarchy, desktop density and white data surfaces,
with a navy navigation sidebar (`#172940`), cool gray-blue canvas (`#f3f6fa`),
and blue primary actions/selection/analytical series (`#3159c9`). Sidebar labels
use dedicated light tokens so the darker surface does not reduce legibility.

The review metric and urgent maintenance brief use a restrained rose background
to bring pending decisions forward. Ordinary metrics stay neutral; active AI
runs use the action accent. Health history is green for normal machines and rose
for machines needing attention; load is blue and dashed. Text, legends, symbols
and dash patterns continue to distinguish meanings without relying on color.
The aggregate load area follows the existing source samples and 0–100% scale;
no measurement, threshold or operational state was added.

This section supersedes the earlier light-sidebar, near-black-action and
monochrome-chart decisions. No gradients, new dashboard widgets or mobile work
are introduced. The shared tokens apply to the newly merged Operations screens
as well as the redesigned workspace.

Validation: all 199 frontend tests, TypeScript and production build passed.
Browser checks covered 1280/1440/1920px desktops, normal/at-risk machine selection,
sidebar collapse and the merged Operations overview. No horizontal page overflow
was observed. See [verification](color-refinement-verification.json) and the
[updated overview preview](previews/overview-color-refinement.jpg).

## One Overview entry — 15 October 2026

After merging main, the sidebar exposed both the redesigned Overview and a second
Factory operations overview. The duplicate primary entry is removed. `/overview`
remains the single dashboard; its **Factory resources** action opens the existing
API-backed `/operations` detail page. That page is now explicitly a resource and
planning-context drill-down, retaining machines/jobs/technicians, source metadata,
case creation, refresh and all live error/authentication behavior. The Operations
subnavigation links back to `/overview` and labels `/operations` as Resources.
Existing schedule, case, recommendation, agent and what-if URLs remain reachable.
The resource route stays unchanged to preserve bookmarks and workflow links.

This is a navigation consolidation, not a claim that the recorded dashboard data
and canonical Operations API data have already been integrated. Their distinct
demo/live labels and source scopes remain explicit.

Validation: 199 frontend tests and the production build (including TypeScript and
lint) passed. Browser review confirmed one primary Overview entry, the resource
action's destination, retained planning/resource content and the corrected
subnavigation back to `/overview`. See the
[consolidated navigation preview](previews/overview-single-entry.jpg).
