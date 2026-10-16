export interface TokenUsage { inputTokens: number; outputTokens: number }

/** Integer micro-USD per million tokens; no implicit or guessed provider rates. */
export interface TokenPricing {
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
  source: string;
  verifiedOn: string;
}

export interface BudgetConfig {
  targetMicroUsd: number;
  hardStopMicroUsd: number;
  absoluteMaximumMicroUsd: number;
}

export const defaultBudgetConfig: BudgetConfig = {
  targetMicroUsd: 5_000_000,
  hardStopMicroUsd: 8_000_000,
  absoluteMaximumMicroUsd: 10_000_000,
};

export interface BudgetReservation { id: string; runId: string; month: string; reservedMicroUsd: number }
export interface BudgetSnapshot {
  month: string;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  targetReached: boolean;
}
export interface RunAccounting { usage: TokenUsage; costMicroUsd: number }

export interface BudgetManager {
  reserve(runId: string, maximumUsage: TokenUsage, pricing: TokenPricing): BudgetReservation;
  settle(reservationId: string, actualUsage: TokenUsage): RunAccounting;
  snapshot(): BudgetSnapshot;
  runAccounting(runId: string): RunAccounting;
}

const integer = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

export function estimateCost(usage: TokenUsage, pricing: TokenPricing): number {
  const values = [usage.inputTokens, usage.outputTokens, pricing.inputMicroUsdPerMillion, pricing.outputMicroUsdPerMillion];
  if (!values.every(integer) || !pricing.source.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(pricing.verifiedOn)) {
    throw new Error('Valid usage and explicitly sourced pricing required');
  }
  const numerator = BigInt(usage.inputTokens) * BigInt(pricing.inputMicroUsdPerMillion)
    + BigInt(usage.outputTokens) * BigInt(pricing.outputMicroUsdPerMillion);
  const rounded = (numerator + 999_999n) / 1_000_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Cost exceeds safe accounting range');
  return Number(rounded);
}

/** Process-local ledger for Phase 1; durable shared accounting is required before live calls. */
export class InMemoryBudgetManager implements BudgetManager {
  private readonly config: BudgetConfig;
  private readonly reservations = new Map<string, { reservation: BudgetReservation; pricing: TokenPricing; maximum: TokenUsage }>();
  private readonly spent = new Map<string, number>();
  private readonly runs = new Map<string, RunAccounting>();
  private sequence = 0;
  private overrun = false;

  constructor(config: BudgetConfig = defaultBudgetConfig, private readonly now: () => Date = () => new Date()) {
    if (!Object.values(config).every(integer) || config.targetMicroUsd > config.hardStopMicroUsd
      || config.hardStopMicroUsd > 8_000_000 || config.hardStopMicroUsd > config.absoluteMaximumMicroUsd
      || config.absoluteMaximumMicroUsd > 10_000_000) throw new Error('Invalid budget limits');
    this.config = { ...config };
  }

  private month(): string { return this.now().toISOString().slice(0, 7); }

  snapshot(): BudgetSnapshot {
    const month = this.month();
    const spentMicroUsd = this.spent.get(month) ?? 0;
    const reservedMicroUsd = [...this.reservations.values()]
      .filter(entry => entry.reservation.month === month)
      .reduce((sum, entry) => sum + entry.reservation.reservedMicroUsd, 0);
    return { month, spentMicroUsd, reservedMicroUsd, targetReached: spentMicroUsd + reservedMicroUsd >= this.config.targetMicroUsd };
  }

  reserve(runId: string, maximumUsage: TokenUsage, pricing: TokenPricing): BudgetReservation {
    if (!runId.trim()) throw new Error('Run ID required');
    const cost = estimateCost(maximumUsage, pricing);
    const snapshot = this.snapshot();
    if (this.overrun || snapshot.spentMicroUsd + snapshot.reservedMicroUsd + cost > this.config.hardStopMicroUsd) {
      throw new Error('Monthly hard stop reached');
    }
    const reservation = { id: String(++this.sequence), runId, month: snapshot.month, reservedMicroUsd: cost };
    this.reservations.set(reservation.id, { reservation, pricing: { ...pricing }, maximum: { ...maximumUsage } });
    return { ...reservation };
  }

  settle(reservationId: string, actualUsage: TokenUsage): RunAccounting {
    const entry = this.reservations.get(reservationId);
    if (!entry) throw new Error('Unknown or already settled reservation');
    const cost = estimateCost(actualUsage, entry.pricing);
    if (actualUsage.inputTokens > entry.maximum.inputTokens || actualUsage.outputTokens > entry.maximum.outputTokens) {
      this.overrun = true; // Record incurred cost, then refuse further requests.
    }
    const { month, runId } = entry.reservation;
    this.spent.set(month, (this.spent.get(month) ?? 0) + cost);
    this.reservations.delete(reservationId);
    const previous = this.runAccounting(runId);
    const updated = {
      usage: { inputTokens: previous.usage.inputTokens + actualUsage.inputTokens, outputTokens: previous.usage.outputTokens + actualUsage.outputTokens },
      costMicroUsd: previous.costMicroUsd + cost,
    };
    this.runs.set(runId, updated);
    return this.runAccounting(runId);
  }

  runAccounting(runId: string): RunAccounting {
    const entry = this.runs.get(runId) ?? { usage: { inputTokens: 0, outputTokens: 0 }, costMicroUsd: 0 };
    return { usage: { ...entry.usage }, costMicroUsd: entry.costMicroUsd };
  }
}
