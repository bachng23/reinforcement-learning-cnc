# Live create / approval / commit screenshots

Captured at desktop 1440 × 1000 and mobile 390 × 844 using the Playwright browser
tests. The app runs in real mode through `OperationsApiClient`; the test runner
intercepts backend HTTP/auth responses with the canonical contract harness.
These captures do not claim a running PostgreSQL/worker deployment.

## Success: committed publication and refreshed schedule

<img src="./success-desktop.png" alt="Published version, commit actor/time and refreshed current Gantt on desktop" width="720" />
<img src="./success-mobile.png" alt="Published version and commit provenance with current schedule context on mobile" width="250" />

<img src="./published-gantt-desktop.png" alt="Refreshed published machine and technician Gantt on desktop" width="720" />
<img src="./published-gantt-mobile.png" alt="Refreshed published Gantt with contained horizontal scroll on mobile" width="250" />

## Pending: confirmation blocks double submission

<img src="./pending-desktop.png" alt="Approval pending with disabled confirmation controls on desktop" width="720" />
<img src="./pending-mobile.png" alt="Approval pending on mobile" width="250" />

## Stale: create a new case from current context

<img src="./stale-desktop.png" alt="Stale immutable basis disables decision writes on desktop" width="720" />
<img src="./stale-mobile.png" alt="Stale case and new-case entrypoint on mobile" width="250" />

## Error: unknown outcome preserves the recovery request

<img src="./error-desktop.png" alt="Decision service error and manual recovery on desktop" width="720" />
<img src="./error-mobile.png" alt="Manual decision outcome recovery on mobile" width="250" />
