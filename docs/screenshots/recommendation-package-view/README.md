# RecommendationPackageView screenshots

These captures render the pure `RecommendationPackageView` through the generated
operations contract path and canonical mock data source. Desktop captures use a
1440 px viewport; mobile captures use a 500 px viewport. Wide candidate and KPI
content remains inside horizontal scroll regions on mobile.

## One candidate

<img src="./one-candidate-desktop.png" alt="One-candidate recommendation package on desktop" width="720" />
<img src="./one-candidate-mobile.png" alt="One-candidate recommendation package on mobile" width="250" />

## Three candidates

<img src="./three-candidate-desktop.png" alt="Three-candidate recommendation package on desktop" width="720" />
<img src="./three-candidate-mobile.png" alt="Three-candidate recommendation package on mobile" width="250" />

## Package and snapshot mismatch

The mismatch captures intentionally change the authoritative snapshot ID. The
component fails closed and hides candidate, KPI, provenance, and schedule data.

<img src="./mismatch-desktop.png" alt="Recommendation package mismatch on desktop" width="720" />
<img src="./mismatch-mobile.png" alt="Recommendation package mismatch on mobile" width="250" />
