import type { BrowserObservation } from './contracts.js';
import type { PersonalData, CandidateProfile } from './profile.js';

export interface CloudContext {
  observation: BrowserObservation;
  candidate: CandidateProfile;
  personalReferenceIds: readonly string[];
}
export interface PrivacyFilter {
  forCloud(observation: BrowserObservation, profile: CandidateProfile, personal: PersonalData): CloudContext;
}

/** Baseline redaction, not a guarantee of arbitrary PII detection. No raw HTML or field values. */
export class BasicPrivacyFilter implements PrivacyFilter {
  forCloud(observation: BrowserObservation, profile: CandidateProfile, personal: PersonalData): CloudContext {
    const secrets = Object.values(personal.references).filter(Boolean).sort((a, b) => b.length - a.length);
    const clean = (text: string): string => {
      let result = text;
      for (const secret of secrets) {
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'gi'), '[PRIVATE]');
      }
      return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
        .replace(/\+?\d[\d ().-]{7,}\d/g, '[NUMBER]');
    };
    const safeId = (id: string): string => {
      if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id) || clean(id) !== id) throw new Error('Unsafe reference or observation ID');
      return id;
    };
    const origin = new URL(observation.origin);
    if (origin.username || origin.password || origin.origin !== observation.origin
      || origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname)) {
      throw new Error('Observation must have a literal loopback HTTP origin');
    }
    return {
      observation: {
        id: safeId(observation.id), origin: origin.origin, title: clean(observation.title), text: clean(observation.text),
        controls: observation.controls.map(control => ({
          id: safeId(control.id), kind: control.kind, label: clean(control.label), help: clean(control.help), required: control.required,
          ...(control.inputType === undefined ? {} : { inputType: clean(control.inputType) }),
          ...(control.consentId === undefined ? {} : { consentId: safeId(control.consentId) }),
          ...(control.buttonEffect === undefined ? {} : { buttonEffect: control.buttonEffect }),
          options: control.options.map(option => ({ id: safeId(option.id), label: clean(option.label) })),
        })),
        errors: observation.errors.map(clean),
      },
      candidate: {
        id: safeId(profile.id), fictional: true,
        facts: profile.facts.map(fact => ({
          id: safeId(fact.id),
          value: typeof fact.value === 'string' ? clean(fact.value) : Array.isArray(fact.value) ? fact.value.map(clean) : fact.value,
          provenance: { kind: 'fictional-fixture', source: clean(fact.provenance.source), verifiedOn: fact.provenance.verifiedOn },
        })),
      },
      personalReferenceIds: Object.keys(personal.references).map(safeId),
    };
  }
}
