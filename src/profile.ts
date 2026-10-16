/** "Verified" here means checked against an authored fictional fixture. */
export interface Provenance {
  kind: 'fictional-fixture';
  source: string;
  verifiedOn: string;
}

export type FactValue = string | number | boolean | readonly string[];

export interface CandidateFact {
  id: string;
  value: FactValue;
  provenance: Provenance;
}

export interface CandidateProfile {
  id: string;
  fictional: true;
  facts: readonly CandidateFact[];
}

/** Local only; values must never be included in model messages or event logs. */
export interface PersonalData {
  references: Readonly<Record<string, string>>;
}

const provenance: Provenance = {
  kind: 'fictional-fixture',
  source: 'CareerPilot authored demonstration profile; no real person or credentials',
  verifiedOn: '2026-10-16',
};

export const fictionalCandidate: CandidateProfile = {
  id: 'candidate-demo',
  fictional: true,
  facts: [
    { id: 'experience.role', value: 'Software Engineer', provenance },
    { id: 'experience.company', value: 'Example Systems', provenance },
    { id: 'experience.employmentStatus', value: 'Employed', provenance },
    { id: 'education.school', value: 'Example Institute', provenance },
    { id: 'education.degree', value: 'Bachelor of Science', provenance },
    { id: 'experience.project', value: 'Built an internal task tracking application', provenance },
    { id: 'skills.languages', value: ['TypeScript', 'JavaScript'], provenance },
    { id: 'authorization.US', value: true, provenance },
    { id: 'sponsorship.US', value: false, provenance },
  ],
};

export const fictionalPersonalData: PersonalData = {
  references: {
    'personal.fullName': 'Alex Example',
    'personal.email': 'alex@example.invalid',
  },
};
