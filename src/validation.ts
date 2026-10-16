import type { AgentDecision, BrowserAction, BrowserObservation, LowRiskAction } from './contracts.js';
import type { ApplicationPolicy, Validation } from './policy.js';
import { validateClaim, validateConsent } from './policy.js';
import type { CandidateProfile, PersonalData } from './profile.js';

export function validateLocalOrigin(origin: string, allowedOrigin: string | null): Validation {
  try {
    const url = new URL(origin);
    return origin === allowedOrigin && url.origin === origin && url.protocol === 'http:'
      && !url.username && !url.password && ['127.0.0.1', '[::1]'].includes(url.hostname)
      ? { ok: true } : { ok: false, reason: 'Exact configured loopback HTTP origin required' };
  } catch {
    return { ok: false, reason: 'Invalid origin' };
  }
}

/** Semantic decisions remain with the LLM; this checks permitted references and effects. */
export function validateDecision(
  decision: AgentDecision,
  observation: BrowserObservation,
  profile: CandidateProfile,
  personal: PersonalData,
  policy: ApplicationPolicy,
  actionsAlreadyExecuted: number,
): Validation {
  const fail = (reason: string): Validation => ({ ok: false, reason });
  if (decision.kind === 'stop') return { ok: true };
  if (!validateLocalOrigin(observation.origin, policy.allowedOrigin).ok) return fail('Disallowed origin');
  if (decision.observationId !== observation.id) return fail('Stale observation');
  const actions: readonly BrowserAction[] = decision.kind === 'batch' ? decision.actions : [decision.action];
  if (!Number.isSafeInteger(policy.maxActions) || policy.maxActions <= 0
    || !Number.isSafeInteger(policy.maxBatchSize) || policy.maxBatchSize <= 0
    || !Number.isSafeInteger(actionsAlreadyExecuted) || actionsAlreadyExecuted < 0
    || actions.length === 0 || actionsAlreadyExecuted + actions.length > policy.maxActions) return fail('Action limit exceeded');
  if (decision.kind === 'batch' && (actions.length > policy.maxBatchSize
    || actions.some(action => !['fill', 'select'].includes(action.kind)))) return fail('Invalid low-risk batch');
  const targets = actions.flatMap(action => 'elementId' in action ? [action.elementId] : []);
  if (new Set(targets).size !== targets.length) return fail('Conflicting batch targets');

  const checkLowRisk = (action: LowRiskAction): Validation => {
    if (action.kind === 'select') return validateClaim(profile, action.claim);
    return action.answer.kind === 'fact' ? validateClaim(profile, action.answer.claim)
      : Object.hasOwn(personal.references, action.answer.referenceId)
        ? { ok: true } : fail('Unknown personal reference');
  };
  for (const action of actions) {
    if (action.kind === 'wait') continue;
    const controls = observation.controls.filter(control => control.id === action.elementId);
    const control = controls[0];
    if (controls.length !== 1 || !control) return fail('Unknown or ambiguous element');
    switch (action.kind) {
      case 'fill':
      case 'select': {
        if (action.kind === 'fill' && !['text', 'textarea'].includes(control.kind)) return fail('Not a text control');
        if (action.kind === 'select' && (control.kind !== 'select'
          || control.options.filter(option => option.id === action.optionId).length !== 1)) return fail('Unknown select option');
        const result = checkLowRisk(action);
        if (!result.ok) return result;
        break;
      }
      case 'check': {
        if (!['checkbox', 'radio'].includes(control.kind)) return fail('Not a checkable control');
        const result = action.evidence.kind === 'consent'
          ? validateConsent(policy, action.evidence.consentId) : validateClaim(profile, action.evidence.claim);
        if (!result.ok) return result;
        if (action.evidence.kind === 'fact' && action.evidence.claim.value !== action.checked) return fail('Checkbox contradicts fact');
        break;
      }
      case 'submit': {
        if (control.kind !== 'button' || control.buttonEffect !== 'submission') return fail('Not a verified submission control');
        const result = validateConsent(policy, action.consentId);
        if (!result.ok) return result;
        break;
      }
      case 'click':
        if (control.kind !== 'button' || control.buttonEffect !== 'navigation') return fail('Not a verified navigation control');
        break;
      default:
        return fail('Unsupported browser action');
    }
  }
  return { ok: true };
}
