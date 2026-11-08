/* Generated from contracts/jcst/v1/jcst.schema.json. Do not edit. */

export type WireSchemaVersion = "jcst-research/1.0";
export type CampaignKey = string;
export type Title = string;
export type Objective = string;
export type StudyKey = string;
export type RunKey = string;
export type Origin = "engineering" | "research";
export type Repository = "https://github.com/AIVIETNAM-AIO-BachNguyen/maintenance-capacity-coordination";
export type Commit = string;
export type SourceHash = string;
export type ProtocolId = string;
export type ProtocolHash = string;
export type SimulatorVersion = "JCST/1.1";
/**
 * @maxItems 20
 */
export type Claims = string[];
/**
 * @maxItems 20
 */
export type Limitations = string[];
/**
 * @minItems 1
 * @maxItems 20
 */
export type Artifacts = [Artifact, ...Artifact[]];
export type ArtifactId = string;
export type MediaType = "application/json" | "text/csv" | "text/markdown";
export type Sha256 = string;
export type Content = string;
export type AnalysisArtifactId = string | null;
export type CaseId = string;
export type Arm = string;
export type TrainingRoot = string;
export type Samples = number;
export type Mode = "greedy" | "stochastic";
export type MeanTotalCost = number;
export type MeanHCost = number | null;
export type MeanTailCost = number | null;
export type TrainingSeconds = number | null;
/**
 * @maxItems 2000
 */
export type Curves = CurvePoint[];
export type CaseId1 = string;
export type Contrast1 = string;
export type Estimand = string;
export type Difference = number;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Interval = [number, number];
export type IntervalMethod = string;
export type Gate = "PASS" | "FAIL" | "NOT_ASSESSED";
/**
 * @maxItems 50
 */
export type Contrasts = Contrast[];
export type Kind = "physical" | "statistical";
export type Status = "PASS" | "FAIL" | "NOT_AVAILABLE";
export type ArtifactId1 = string;
export type Scope = string;
/**
 * @maxItems 10
 */
export type SourceAudits = SourceAudit[];
export type EpisodeId = string;
export type CaseId2 = string;
export type Controller = string;
export type PhysicalSeed = string;
export type SeedRole = "engineering" | "evaluation" | "confirmation";
export type Mode1 = "greedy" | "stochastic";
export type TrainingRoot1 = string | null;
export type CheckpointSamples = number | null;
export type ActionRepetition = number;
export type Horizon = number;
export type Tail = number;
export type Version = "JCST/1.1";
/**
 * @minItems 1
 * @maxItems 4
 */
export type Components = [ComponentConfig[], ...ComponentConfig[][]];
export type Scale = number;
export type Shape = number;
export type Duration = number[][][];
export type PreventiveCost = number;
export type CorrectiveCost = number;
export type UnavailableCost = number;
export type FailureCost = number;
/**
 * @minItems 1
 * @maxItems 128
 */
export type Records = [Record, ...Record[]];
export type Phase = "H" | "tail";
export type Tick = number;
export type Tick1 = number;
export type Age = number;
export type Failed = boolean;
export type Components1 = ComponentState[][];
export type Machine = number;
export type Component = number;
export type Technician = number;
export type Kind1 = "PM" | "CM";
export type Remaining = number;
export type Jobs = (ServiceJob | null)[];
export type Action = [number, number, number][];
export type Catalogue = [number, number, number][][];
export type Cost = number;
export type Preventive = number;
export type Corrective = number;
export type Unavailable = number;
export type Failure = number;
export type Type = "start" | "failure" | "occupancy" | "completion";
export type Tick2 = number;
export type Machine1 = number;
export type Component1 = number;
export type Technician1 = number | null;
export type Kind2 = ("PM" | "CM") | null;
export type Duration1 = number | null;
export type Remaining1 = number | null;
export type Uniform = number | null;
export type Events = Event[];
export type ControlledCost = number;
export type TailCost = number;
export type TotalCost = number;
/**
 * @maxItems 12
 */
export type Episodes = Episode[];
export type EpisodeId1 = string;
export type Tick3 = number;
export type Action1 = [number, number, number][];
export type Reason = string;
export type ExpectedEpisodeHash = string;
export type Controller1 = "threshold5" | "risk" | "corrective" | "wait";

export interface JCSTResearchContractCatalogV1 {
  bundle: Bundle;
  branch_request: BranchRequest;
  state: State;
  config: Config;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Bundle".
 */
export interface Bundle {
  wire_schema_version?: WireSchemaVersion;
  campaign_key: CampaignKey;
  title: Title;
  objective: Objective;
  study_key: StudyKey;
  run_key: RunKey;
  origin: Origin;
  provenance: Provenance;
  claims?: Claims;
  limitations?: Limitations;
  artifacts: Artifacts;
  analysis_artifact_id?: AnalysisArtifactId;
  curves?: Curves;
  contrasts?: Contrasts;
  source_audits?: SourceAudits;
  episodes?: Episodes;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Provenance".
 */
export interface Provenance {
  repository: Repository;
  commit: Commit;
  source_hash: SourceHash;
  protocol_id: ProtocolId;
  protocol_hash: ProtocolHash;
  simulator_version?: SimulatorVersion;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Artifact".
 */
export interface Artifact {
  artifact_id: ArtifactId;
  media_type: MediaType;
  sha256: Sha256;
  content: Content;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "CurvePoint".
 */
export interface CurvePoint {
  case_id: CaseId;
  arm: Arm;
  training_root: TrainingRoot;
  samples: Samples;
  mode?: Mode;
  mean_total_cost: MeanTotalCost;
  mean_h_cost?: MeanHCost;
  mean_tail_cost?: MeanTailCost;
  training_seconds?: TrainingSeconds;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Contrast".
 */
export interface Contrast {
  case_id: CaseId1;
  contrast: Contrast1;
  estimand: Estimand;
  difference: Difference;
  interval: Interval;
  interval_method: IntervalMethod;
  gate: Gate;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "SourceAudit".
 */
export interface SourceAudit {
  kind: Kind;
  status: Status;
  artifact_id: ArtifactId1;
  scope: Scope;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Episode".
 */
export interface Episode {
  episode_id: EpisodeId;
  case_id: CaseId2;
  controller: Controller;
  physical_seed: PhysicalSeed;
  seed_role: SeedRole;
  mode?: Mode1;
  training_root?: TrainingRoot1;
  checkpoint_samples?: CheckpointSamples;
  action_repetition?: ActionRepetition;
  horizon: Horizon;
  tail: Tail;
  config: Config;
  records: Records;
  controlled_cost: ControlledCost;
  tail_cost: TailCost;
  total_cost: TotalCost;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Config".
 */
export interface Config {
  version?: Version;
  components: Components;
  duration: Duration;
  preventive_cost: PreventiveCost;
  corrective_cost: CorrectiveCost;
  unavailable_cost: UnavailableCost;
  failure_cost: FailureCost;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "ComponentConfig".
 */
export interface ComponentConfig {
  scale: Scale;
  shape: Shape;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Record".
 */
export interface Record {
  phase: Phase;
  tick: Tick;
  before: State;
  action: Action;
  catalogue: Catalogue;
  after: State;
  cost: Cost;
  breakdown: Breakdown;
  events: Events;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "State".
 */
export interface State {
  tick: Tick1;
  components: Components1;
  jobs: Jobs;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "ComponentState".
 */
export interface ComponentState {
  age: Age;
  failed: Failed;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "ServiceJob".
 */
export interface ServiceJob {
  machine: Machine;
  component: Component;
  technician: Technician;
  kind: Kind1;
  remaining: Remaining;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Breakdown".
 */
export interface Breakdown {
  preventive: Preventive;
  corrective: Corrective;
  unavailable: Unavailable;
  failure: Failure;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "Event".
 */
export interface Event {
  type: Type;
  tick: Tick2;
  machine: Machine1;
  component: Component1;
  technician?: Technician1;
  kind?: Kind2;
  duration?: Duration1;
  remaining?: Remaining1;
  uniform?: Uniform;
}
/**
 * This interface was referenced by `JCSTResearchContractCatalogV1`'s JSON-Schema
 * via the `definition` "BranchRequest".
 */
export interface BranchRequest {
  episode_id: EpisodeId1;
  tick: Tick3;
  action: Action1;
  reason: Reason;
  expected_episode_hash: ExpectedEpisodeHash;
  controller?: Controller1;
}
