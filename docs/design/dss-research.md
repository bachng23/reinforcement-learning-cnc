# Desktop industrial decision support: redesign research brief

Date: 14 October 2026. Prepared by Codex with the ARS quick research workflow. This is a bounded design brief for the CNC application, not a systematic review, standards audit, or proof of industrial deployment readiness.

## Executive summary

The redesign should organize the application around a maintenance decision: identify what needs attention, inspect the evidence, compare available options, record a human review, and revisit the result. The strongest common direction across industrial HMI guidance, explainable-AI principles, human–AI interaction research, and Apple design guidance is purposeful hierarchy with consistent behavior. An impressive interface should make the right next step obvious, make evidence legible, and communicate uncertainty honestly. It should not imply live telemetry, reliable confidence, or operational execution where the application only has sample data or research outputs. A quiet desktop workspace, precise typography, restrained semantic color, and deliberate information density fit this purpose. The proposals below are design interpretations to validate with intended industrial users; they are not requirements copied from a single standard.

## Research question and method

Which interface principles and existing industrial product patterns best support a clear, usable, credible desktop CNC maintenance DSS?

The search used official ISA, ISO, NIST, Microsoft Research, Apple Developer, W3C, IEEE, and Siemens sites. Queries combined industrial HMI hierarchy, human-centred design, explainable AI, human–AI interaction, desktop design, accessibility, and predictive-maintenance cases. Sources were included for direct relevance and identifiable primary provenance; generic design blogs, unsourced aesthetic claims, and medical effectiveness studies were excluded. The source set is deliberately normative and product oriented. It does not estimate the redesign's effect on decision accuracy or productivity. Publication metadata and claim-bearing sections were checked through the official web/PDF representations; full paid ISO and ISA standards were not inspected.

## Verified findings and design implications

### 1. A DSS supports judgment through data and alternatives

**Evidence.** IEEE's topic explanation describes decision support as combining data analysis, models, and alternative evaluation with human judgment. Its definition treats the human as the final decision maker. [IEEE, *Decision Support System*](https://technav.ieee.org/topic/decision-support-system/). <!--ref:ieee-dss--><!--anchor:section:What%20Is%20a%20Decision%20Support%20System%3F-->

**Design interpretation.** The product should answer five questions: What needs my attention? Why? What can I do? What changes if I choose another option? What did we decide? Fleet metrics alone cannot answer these questions. The interface needs an explicit path from a queue entry to recommendation evidence and review. Simulation and experiment screens remain valuable, but their outputs must remain distinct from operational decisions.

### 2. Industrial HMI design starts with operator tasks and consistent structure

**Evidence.** ISA's public ISA-101 series summary emphasizes human-centred design, effective display structures, intuitive interaction, and lifecycle improvement for continuous, batch, and discrete industries. Its supporting usability report addresses design, auditing, validation, and change management. [ISA, *ISA-101 Series of Standards*](https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards). <!--ref:isa101--><!--anchor:section:Key%20Components%20of%20ISA-101-->

**Design interpretation.** Use a stable navigation spine and progressively deeper workspaces: overview, case evidence, analytical detail, and administration. Put urgent review work above expansive factory illustrations. Use the same names, status meanings, action placement, and table conventions across screens. Reserve alert colors for meaningful status differences rather than coloring every metric. These are our design choices informed by HMI goals, not a claim that ISA prescribes this exact web layout.

### 3. Human-centred design is a lifecycle practice

**Evidence.** ISO 9241-210:2019 provides requirements and recommendations for human-centred design principles and activities across interactive-system lifecycles. ISO's public abstract explicitly says the document does not cover detailed techniques or health and safety in detail. [ISO, *ISO 9241-210:2019*](https://www.iso.org/standard/77520.html). <!--ref:iso9241--><!--anchor:section:Abstract-->

**Design interpretation.** Screenshot review and regression tests are useful first checks. They should be followed by task walkthroughs with maintenance planners, engineers, and reviewers. Evaluate whether people can identify the next case, interpret the recommendation's scope, find missing evidence, compare a scenario, and recover from an error. No compliance statement follows from this brief.

### 4. Explanations must be both understandable and faithful

**Evidence.** The final September 2021 NISTIR 8312 identifies explanation, meaningfulness, explanation accuracy, and knowledge limits. It distinguishes explanation accuracy from decision accuracy and notes that different audiences need different explanation detail. [Phillips et al., *Four Principles of Explainable Artificial Intelligence*](https://nvlpubs.nist.gov/nistpubs/ir/2021/nist.ir.8312.pdf). <!--ref:nist8312--><!--anchor:section:2.%20Four%20Principles%20of%20Explainable%20AI-->

**Design interpretation.** Start with a plain-language recommendation summary, then expose source observation, policy, attempt, event chronology, and backend-provided estimates. Use “Not provided” and incomplete-result states honestly. A frontend must not synthesize missing failure probability, confidence, per-machine cost, or rationale to fill an attractive card. An explanation panel describes returned evidence; it cannot guarantee that a model's internal reasoning is faithful.

### 5. Human–AI interaction must support correction and clear boundaries

**Evidence.** Amershi and colleagues propose 18 guidelines, including understandable capability/quality boundaries, relevant context, dismissal, correction, uncertainty scoping, explanation, and consequences. Their CHI 2019 evaluation included design practitioners applying the guidelines to AI products, rather than a CNC-operator effectiveness trial. [Amershi et al., *Guidelines for Human-AI Interaction*](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf). <!--ref:amershi2019--><!--anchor:section:Table%201-->

**Design interpretation.** Distinguish recommendation from approval. Explain the machine/action affected before confirmation. Keep reject and override paths discoverable; communicate required rationale and submission state. Surface pending, running, failed, canceled, and partial outputs differently. Selection, navigation, and refresh must remain read-only; review mutations occur after an explicit reviewer action.

### 6. Simplicity means reducing friction while retaining useful context

**Evidence.** Apple's WWDC26 design session describes simplicity through concise language, clear hierarchy, and useful context, warning that hiding functionality can create visual minimalism without simplicity. It also describes desktop workflows as deep and pointer precise. [Apple, *Principles of great design*](https://developer.apple.com/videos/play/wwdc2026/250/). <!--ref:apple-design--><!--anchor:section:Simplicity-->

**Design interpretation.** Prefer a restrained desktop workspace with readable tables, visible filters, clear section headings, consistent spacing, and deliberate active states. Critical context should not require hovering. Avoid decorative counters, repetitive cards, giant marketing headings, elaborate animated machinery, and translucent layers when they do not help a maintenance task. Support laptop and larger desktop widths; no phone-specific redesign is required.

### 7. Accessibility remains relevant on desktop

**Evidence.** WCAG 2.2 specifies text contrast thresholds, color-independent meaning, visible keyboard focus, focus not entirely obscured, consistent navigation, and programmatically determinable status messages. [W3C, *WCAG 2.2*](https://www.w3.org/TR/WCAG22/). <!--ref:wcag22--><!--anchor:section:1.4.3%20Contrast%20%28Minimum%29-->

**Design interpretation.** Target at least 4.5:1 normal-text contrast and 3:1 large-text contrast; label statuses in text. Provide focus rings, semantic table headers, keyboard-usable dialogs, inline errors, and status announcements. Desktop-only scope does not justify tiny text or mouse-only actions. These are implementation targets, not a completed WCAG conformance audit.

### 8. Industrial products tie priorities to evidence and case handling

**Evidence.** Siemens Senseye's developer terminology describes an asset attention index, a case with associated evidence, acknowledgement, and feedback when closing a case. [Siemens, *Senseye terminology*](https://developer.siemens.com/senseye/introduction/terminology.html). <!--ref:senseye--><!--anchor:section:Case-->

**Design interpretation.** Borrow the relationship between attention, evidence, and accountable case handling. Do not copy Senseye's scoring model, thresholds, feature claims, or branding. Our backend's explicit contracts determine which of these concepts can actually be shown.

## Proposed CNC decision flow

| Stage | User question | Workspace responsibility |
| --- | --- | --- |
| Overview | What requires attention now? | Review queue first; concise fleet/run context; source mode and snapshot time |
| Evidence | Why is this recommended? | Machine and episode identity; observations, policy context, estimates, attempt provenance, gaps |
| Options | What alternatives can I examine? | Isolated what-if assumptions and returned simulation results; comparison scope and limitations |
| Human review | What exactly am I approving? | Action summary; approve/reject/override; rationale; explicit submission feedback |
| Audit | What happened and who decided? | Available history with timestamps and reviewer identity; honest history-availability boundaries |

Research screens should provide an organized experiment register, grouped configuration form, run/episode lifecycle, and a clear result/evidence view. Agent activity should foreground work requiring inspection, then reveal tool and validation events. Administration and login should use the same typography and interaction system while preserving their own tasks.

## Application boundaries and limitations

Repository review of `frontend/README.md` shows that operations overview currently uses fixtures, while real recommendations come from persisted Product API events. Severity, failure risk, and defer consequences are not supplied by the real CNC v2 payload. Expected cost is a joint fleet estimate. Decision history recovery is limited by the lack of a read-only lookup/list endpoint and browser-session knowledge of decision IDs. The redesign must retain these distinctions visibly.

The research supports principles and analogies, not measured outcomes for this product. ISA/ISO public summaries cannot substitute for their full standards. IEEE provides a conceptual explanation rather than a standard. Apple guidance originates in platform design, Microsoft research spans general AI products, and Siemens documents describe its own product. No medical DSS study is generalized to industrial users. A later operator evaluation should test time to locate a case, correct interpretation of missing data and estimate scope, successful review completion, and error recovery before making performance claims.
