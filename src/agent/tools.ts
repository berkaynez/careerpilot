import { z } from 'zod';
import type { AgentDecision, DecisionContext } from '../contracts.js';
import type { ToolCall, ToolDefinition } from '../llm.js';

const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/);
const nullableId = id.nullable();
export const schemas = {
  read_candidate_facts: z.strictObject({ factIds: z.array(id).min(1).max(8) }),
  fill_fields: z.strictObject({ actions: z.array(z.strictObject({ kind: z.enum(['fill', 'select']), elementId: id,
    factId: nullableId, personalReferenceId: nullableId, optionId: nullableId })).min(1).max(4) }),
  set_checked: z.strictObject({ elementId: id, checked: z.boolean(), factId: nullableId, consentId: nullableId }),
  click_control: z.strictObject({ elementId: id }),
  wait_for_change: z.strictObject({}),
  submit_application: z.strictObject({ elementId: id, consentId: id }),
  stop_application: z.strictObject({ outcome: z.enum(['needs_information', 'blocked']) }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  read_candidate_facts: 'Read only the candidate facts needed to interpret a question or choose an option. Personal values cannot be read.',
  fill_fields: 'Fill/select up to four independent visible fields using fact IDs or personal references. Select requires a fact and an observed option ID. Fill requires optionId null.',
  set_checked: 'Set a checkbox/radio using one verified boolean fact or explicitly granted consent ID; the other source must be null.',
  click_control: 'Click a visible navigation control. Cannot submit.',
  wait_for_change: 'Wait briefly for delayed controls before inspecting again.',
  submit_application: 'Submit only after all required information is supported and entered and explicit submission consent is granted.',
  stop_application: 'Stop safely when required information or consent is missing, or the task is blocked.',
};
export const browserTools: readonly ToolDefinition[] = Object.entries(schemas).map(([name, schema]) => {
  const { $schema, ...inputSchema } = z.toJSONSchema(schema);
  return { name, description: descriptions[name as keyof typeof schemas], inputSchema: { ...inputSchema, required: inputSchema.required ?? [] } };
});

export function parseCall(call: ToolCall): ToolCall {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(call.id) || !Object.hasOwn(schemas, call.name)) throw new Error('INVALID_TOOL_CALL');
  const schema = schemas[call.name as keyof typeof schemas];
  const parsed = schema.safeParse(call.arguments);
  if (!parsed.success) throw new Error('INVALID_TOOL_ARGUMENTS');
  return { ...call, arguments: parsed.data };
}

export function toDecision(call: ToolCall, context: DecisionContext): AgentDecision {
  const claim = (factId: string) => {
    const facts = context.candidate.facts.filter(fact => fact.id === factId);
    if (facts.length !== 1) throw new Error('UNSUPPORTED_FACT');
    return { factId, value: facts[0]!.value };
  };
  const observationId = context.observation.id;
  switch (call.name) {
    case 'fill_fields': {
      const { actions } = schemas.fill_fields.parse(call.arguments);
      return { kind: 'batch', observationId, actions: actions.map(action => {
        if ((action.factId === null) === (action.personalReferenceId === null)) throw new Error('ONE_ANSWER_SOURCE_REQUIRED');
        if (action.kind === 'select') {
          if (!action.factId || !action.optionId || action.personalReferenceId) throw new Error('INVALID_SELECT');
          return { kind: 'select', elementId: action.elementId, optionId: action.optionId, claim: claim(action.factId) };
        }
        if (action.optionId !== null) throw new Error('INVALID_FILL');
        if (action.personalReferenceId && !context.personalReferenceIds.includes(action.personalReferenceId)) throw new Error('UNKNOWN_PERSONAL_REFERENCE');
        return { kind: 'fill', elementId: action.elementId, answer: action.factId
          ? { kind: 'fact', claim: claim(action.factId) } : { kind: 'personal-reference', referenceId: action.personalReferenceId! } };
      }) };
    }
    case 'set_checked': {
      const args = schemas.set_checked.parse(call.arguments);
      if ((args.factId === null) === (args.consentId === null)) throw new Error('ONE_ANSWER_SOURCE_REQUIRED');
      return { kind: 'action', observationId, action: { kind: 'check', elementId: args.elementId, checked: args.checked,
        evidence: args.factId ? { kind: 'fact', claim: claim(args.factId) } : { kind: 'consent', consentId: args.consentId! } } };
    }
    case 'click_control': return { kind: 'action', observationId, action: { kind: 'click', ...schemas.click_control.parse(call.arguments) } };
    case 'wait_for_change': return { kind: 'action', observationId, action: { kind: 'wait' } };
    case 'submit_application': return { kind: 'action', observationId, action: { kind: 'submit', ...schemas.submit_application.parse(call.arguments) } };
    case 'stop_application': return { kind: 'stop', ...schemas.stop_application.parse(call.arguments), reason: 'MODEL_REQUESTED_SAFE_STOP' };
    default: throw new Error('INVALID_TOOL_CALL');
  }
}
