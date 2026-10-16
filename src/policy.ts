import { isDeepStrictEqual } from 'node:util';
import type { CandidateProfile, FactValue } from './profile.js';

export interface SalaryPolicy {
  country: string; // ISO 3166-1 alpha-2; no inferred country or exchange rate.
  currency: string; // ISO 4217
  period: 'hour' | 'month' | 'year';
  minimum: number | null; // Null explicitly means no user-provided floor.
  basis: 'gross-base';
}

export interface ApplicationPolicy {
  salaryByCountry: Readonly<Record<string, SalaryPolicy>>;
  consent: Readonly<Record<string, boolean>>;
  allowedOrigin: string | null;
  maxActions: number;
  maxBatchSize: number;
  maxRunMs: number;
}

export const defaultApplicationPolicy: ApplicationPolicy = {
  salaryByCountry: {}, // Add a country only with a user-provided floor and currency.
  consent: {}, // Absence is not consent.
  allowedOrigin: null, // Must be set to the exact local mock-server origin later.
  maxActions: 60,
  maxBatchSize: 4,
  maxRunMs: 120_000,
};

export type Validation = { ok: true } | { ok: false; reason: string };
const reject = (reason: string): Validation => ({ ok: false, reason });

export interface FactualClaim { factId: string; value: FactValue }

/** Only exact factual claims are supported in Phase 1; no semantic entailment guesses. */
export function validateClaim(profile: CandidateProfile, claim: FactualClaim): Validation {
  const facts = profile.facts.filter(fact => fact.id === claim.factId);
  return facts.length === 1 && isDeepStrictEqual(facts[0]?.value, claim.value)
    ? { ok: true } : reject('Missing, ambiguous, or unsupported candidate fact');
}

export function validateConsent(policy: ApplicationPolicy, consentId: string): Validation {
  return Object.hasOwn(policy.consent, consentId) && policy.consent[consentId] === true
    ? { ok: true } : reject('Explicit consent required');
}

export function validateWorkAuthorization(profile: CandidateProfile, country: string): Validation {
  const claim = { factId: `authorization.${country}`, value: true };
  return /^[A-Z]{2}$/.test(country) && validateClaim(profile, claim).ok
    ? { ok: true } : reject('Verified authorization for this country required');
}

export interface SalaryOffer {
  country: string;
  currency: string;
  period: SalaryPolicy['period'];
  guaranteedMinimum: number;
  basis: SalaryPolicy['basis'];
}

export function validateSalary(policy: ApplicationPolicy, offer: SalaryOffer): Validation {
  const floor = Object.hasOwn(policy.salaryByCountry, offer.country)
    ? policy.salaryByCountry[offer.country] : undefined;
  if (!floor || floor.minimum === null) return reject('User-provided salary floor required');
  if (!/^[A-Z]{2}$/.test(floor.country) || !/^[A-Z]{3}$/.test(floor.currency)
    || floor.basis !== 'gross-base' || !['hour', 'month', 'year'].includes(floor.period)
    || !Number.isFinite(floor.minimum) || floor.minimum < 0
    || !Number.isFinite(offer.guaranteedMinimum) || offer.guaranteedMinimum < 0) {
    return reject('Invalid salary configuration or offer');
  }
  if (floor.country !== offer.country || floor.currency !== offer.currency
    || floor.period !== offer.period || floor.basis !== offer.basis) {
    return reject('Salary country, currency, period, and basis must match; no automatic conversion');
  }
  return offer.guaranteedMinimum >= floor.minimum
    ? { ok: true } : reject('Offer below configured salary floor');
}
