import type { ApplicationPolicy, FactualClaim } from './policy.js';
import type { CandidateProfile } from './profile.js';
import type { TokenUsage } from './budget.js';

export interface FormControl {
  id: string;
  kind: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'button';
  label: string;
  help: string;
  required: boolean;
  /** Native HTML input type, without the current field value. */
  inputType?: string;
  /** Trusted mock markup binds consent controls to an explicit policy grant. */
  consentId?: string;
  /** Executor must establish button effect; unknown effects are blocked. */
  buttonEffect?: 'navigation' | 'submission' | 'unknown';
  options: readonly { id: string; label: string }[];
}

/** Current values are intentionally excluded from model observations. */
export interface BrowserObservation {
  id: string;
  origin: string;
  title: string;
  text: string;
  controls: readonly FormControl[];
  errors: readonly string[];
}

export type AnswerSource =
  | { kind: 'fact'; claim: FactualClaim }
  | { kind: 'personal-reference'; referenceId: string };

export type LowRiskAction =
  | { kind: 'fill'; elementId: string; answer: AnswerSource }
  | { kind: 'select'; elementId: string; optionId: string; claim: FactualClaim };

export type BrowserAction = LowRiskAction
  | { kind: 'check'; elementId: string; checked: boolean; evidence: { kind: 'fact'; claim: FactualClaim } | { kind: 'consent'; consentId: string } }
  | { kind: 'click'; elementId: string }
  | { kind: 'wait' }
  | { kind: 'submit'; elementId: string; consentId: string };

/** Clicks, checks, waits, and submission cannot be hidden inside a low-risk batch. */
export type AgentDecision =
  | { kind: 'action'; observationId: string; action: BrowserAction }
  | { kind: 'batch'; observationId: string; actions: readonly LowRiskAction[] }
  | { kind: 'stop'; outcome: 'needs_information' | 'blocked'; reason: string };

export interface DecisionContext {
  observation: BrowserObservation;
  candidate: CandidateProfile;
  personalReferenceIds: readonly string[];
  policy: ApplicationPolicy;
  previousResults: readonly ActionResult[];
}

export interface DecisionPolicy {
  decide(context: DecisionContext, signal: AbortSignal): Promise<AgentDecision>;
}

export interface ActionResult {
  observationId: string;
  status: 'executed' | 'rejected' | 'failed';
  code: string;
}

export interface BrowserExecutor {
  observe(signal: AbortSignal): Promise<BrowserObservation>;
  canSubmit?(signal: AbortSignal): Promise<boolean>;
  execute(decision: Exclude<AgentDecision, { kind: 'stop' }>, signal: AbortSignal): Promise<readonly ActionResult[]>;
}

export interface SubmissionReceipt { runId: string; receiptId: string; origin: string }
export interface SubmissionVerifier {
  verify(runId: string, signal: AbortSignal): Promise<SubmissionReceipt | null>;
}

export type ApplicationOutcome =
  | { status: 'submitted'; receipt: SubmissionReceipt }
  | { status: 'needs_information' | 'blocked' | 'failed'; reason: string };

export interface AgentRunRequest {
  runId: string;
  applicationUrl: string;
  candidate: CandidateProfile;
  policy: ApplicationPolicy;
}
export interface AgentRunResult {
  runId: string;
  outcome: ApplicationOutcome;
  usage: TokenUsage;
  costMicroUsd: number;
}
export interface Agent {
  run(request: AgentRunRequest, signal: AbortSignal): Promise<AgentRunResult>;
}

/** Metadata only: no raw model messages, personal values, or answer text. */
export interface AgentEvent {
  runId: string;
  at: string;
  type: 'decision' | 'action' | 'budget' | 'outcome';
  code: string;
  factIds: readonly string[];
  usage: TokenUsage | null;
  costMicroUsd: number | null;
}
export interface EventSink { write(event: AgentEvent): Promise<void> }
