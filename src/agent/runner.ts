import type { Agent, AgentRunRequest, AgentRunResult, ApplicationOutcome, BrowserExecutor, DecisionPolicy, EventSink, SubmissionVerifier, ActionResult } from '../contracts.js';
import type { BudgetManager } from '../budget.js';
import type { PersonalData } from '../profile.js';
import { validateDecision, validateLocalOrigin } from '../validation.js';

export class BrowserAgentRunner implements Agent {
  constructor(private readonly dependencies: { browser: BrowserExecutor; policy: DecisionPolicy; verifier: SubmissionVerifier;
    budget: BudgetManager; personal: PersonalData; events?: EventSink }) {}

  async run(request: AgentRunRequest, parentSignal: AbortSignal): Promise<AgentRunResult> {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(request.policy.maxRunMs)]);
    let outcome: ApplicationOutcome = { status: 'blocked', reason: 'TURN_LIMIT' };
    let previousResults: readonly ActionResult[] = [];
    let count = 0, failures = 0;
    try {
      const target = new URL(request.applicationUrl);
      if (!request.candidate.fictional || !validateLocalOrigin(target.origin, request.policy.allowedOrigin).ok
        || target.username || target.password || !/^\/applications\/(single|multi|dynamic)$/.test(target.pathname)) throw new Error('RUN_SCOPE_INVALID');
      if (await this.dependencies.verifier.verify(request.runId, signal)) throw new Error('RUN_ALREADY_SUBMITTED');
      for (let turn = 0; turn < 20; turn++) {
        signal.throwIfAborted();
        const observation = await this.dependencies.browser.observe(signal);
        const decision = await this.dependencies.policy.decide({ observation, candidate: request.candidate,
          personalReferenceIds: Object.keys(this.dependencies.personal.references), policy: request.policy, previousResults }, signal);
        await this.dependencies.events?.write({ runId: request.runId, at: new Date().toISOString(), type: 'decision',
          code: decision.kind === 'stop' ? 'SAFE_STOP_REQUESTED' : 'DECISION_RECEIVED', factIds: [], usage: null, costMicroUsd: null });
        if (decision.kind === 'stop') { outcome = { status: decision.outcome, reason: 'REQUIRED_INFORMATION_OR_SAFE_ACTION_UNAVAILABLE' }; break; }
        if (!validateDecision(decision, observation, request.candidate, this.dependencies.personal, request.policy, count).ok) throw new Error('RUN_ACTION_REJECTED');
        if (decision.kind === 'action' && decision.action.kind === 'submit'
          && (decision.action.consentId !== 'application.submit' || request.policy.consent['application.submit'] !== true)) throw new Error('RUN_SUBMISSION_CONSENT_REQUIRED');
        if (decision.kind === 'action' && decision.action.kind === 'submit'
          && (!this.dependencies.browser.canSubmit || !await this.dependencies.browser.canSubmit(signal))) {
          outcome = { status: 'needs_information', reason: 'REQUIRED_FIELDS_MISSING_INVALID_OR_UNSUPPORTED' }; break;
        }
        previousResults = await this.dependencies.browser.execute(decision, signal);
        count += previousResults.length;
        const receipt = await this.dependencies.verifier.verify(request.runId, signal);
        if (receipt) {
          const confirmation = await this.dependencies.browser.observe(signal);
          if (receipt.runId !== request.runId || receipt.origin !== request.policy.allowedOrigin
            || !receipt.receiptId || confirmation.origin !== receipt.origin || !confirmation.text.includes(receipt.receiptId)) throw new Error('RUN_RECEIPT_MISMATCH');
          outcome = { status: 'submitted', receipt }; break;
        }
        if (previousResults.some(result => result.code === 'TRAFFIC_BLOCKED')) throw new Error('RUN_TRAFFIC_BLOCKED');
        failures = previousResults.some(result => result.status !== 'executed') ? failures + 1 : 0;
        if (failures >= 3) throw new Error('RUN_RECOVERY_LIMIT');
        if (count >= request.policy.maxActions) throw new Error('RUN_ACTION_LIMIT');
      }
    } catch (error) {
      const known = error instanceof Error && /^(BUDGET|PROVIDER|POLICY|MODEL|RUN)_[A-Z_]+$/.test(error.message);
      outcome = { status: 'blocked', reason: signal.aborted ? 'RUN_ABORTED_OR_TIMED_OUT' : known ? error.message : 'RUN_FAILED' };
    }
    const accounting = this.dependencies.budget.runAccounting(request.runId);
    await this.dependencies.events?.write({ runId: request.runId, at: new Date().toISOString(), type: 'outcome',
      code: outcome.status.toUpperCase(), factIds: [], usage: accounting.usage, costMicroUsd: accounting.costMicroUsd });
    return { runId: request.runId, outcome, ...accounting };
  }
}
