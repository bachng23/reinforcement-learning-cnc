# MCC workspace visual system

Reference: [Attio on Refero Styles](https://styles.refero.design/style/08c8700c-f278-42bc-812e-f60dc6ce996e), downloaded 30 October 2026 through the site's Download DESIGN.md control. Original export: [attio-refero.DESIGN.md](references/attio-refero.DESIGN.md). Refero normalizes measurements and interprets roles; this is a style reference, not official Attio source components.

## Application adaptation

- Application appears before Research. `/` redirects to `/overview`; successful sign-in and the workspace logo lead there too. Research remains available at `/research`.
- Shared shell: light sidebar, near-white canvas, near-black text, subtle neutral dividers. One cobalt accent for navigation, links and focus. Primary actions use graphite. Semantic statuses retain readable labels and their own colors.
- Locally bundled Inter 400/500/600, under the included OFL license. No runtime request to a font service. UI headings use compact sizing rather than the reference's marketing scale.
- Research register puts campaigns before explanatory material. Campaign results group filters, foreground curves and contrasts, and keep hash/replay/statistical scope visible. Longer provenance stays in a disclosure; claims and limitations remain in the document.
- S/A/F curves use blue/teal/purple consistently. Solid/dashed/dotted lines supplement color; the legend lists only displayed arms. Individual roots remain individual curves; no new aggregate statistic is introduced.
- Import, replay and job controls use the same neutral surfaces, forms, table spacing and type. Compact density and narrow-screen rules cover research screens. Application pages inherit the shared palette/type and action treatments.
- No research artifacts, API contracts, controller behavior, reported statistics or approval semantics were changed.

## Validation

- Frontend unit suite: **203 tests passed in 31 files**, after the final changes.
- Next.js production build: **passed**, including type validation and generation of 22 pages.
- `git diff --check`: passed.
- Direct Computer Use checks on the running authenticated preview: root URL resolves to Overview; Application is first; Overview, campaign SE1 and Import render with the new design. Rapid case/arm/root/budget selections produced the expected 4 rows and retained all selections in the URL.
- Screenshots: [Overview](screenshots/attio-overview.png), [campaign](screenshots/attio-campaign.png).
- Browser console hydration warnings show extension-injected `bis_skin_checked` and body attributes. These were observed in the user's Brave profile; they were not hidden by changing React hydration handling.
- Computer Use was disabled again in Work settings during final inspection. Replay/Jobs were updated in code and covered by the existing frontend suite/build, but final direct visual checks there were not completed. The full research database E2E suite was not rerun for this visual change.

Preview: http://127.0.0.1:3001/overview (existing local API and worker remain running).
