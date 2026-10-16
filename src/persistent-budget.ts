import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { defaultBudgetConfig, estimateCost, InMemoryBudgetManager } from './budget.js';
import type { BudgetManager, BudgetReservation, BudgetSnapshot, RunAccounting, TokenPricing, TokenUsage } from './budget.js';

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.strictObject({ inputTokens: integer, outputTokens: integer });
const pricingSchema = z.strictObject({ inputMicroUsdPerMillion: integer, outputMicroUsdPerMillion: integer,
  source: z.string().min(1), verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const recordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reserve'), at: z.iso.datetime(), id: z.string(), runId: z.string().min(1), maximum: usageSchema, pricing: pricingSchema }),
  z.strictObject({ kind: z.literal('settle'), at: z.iso.datetime(), id: z.string(), actual: usageSchema }),
]);
type RecordEntry = z.infer<typeof recordSchema>;
type Pending = Extract<RecordEntry, { kind: 'reserve' }>;

/** Fsync'ed append-only ledger. Short exclusive file locks serialize processes.
 * An uncertain request, corrupt journal, or abandoned lock never resets spending.
 */
export class FileBudgetManager implements BudgetManager {
  private readonly path: string;
  constructor(path: string, private readonly limitMicroUsd = 5_000_000, private readonly now = () => new Date(),
    private readonly runLimitMicroUsd = 100_000) {
    if (!Number.isSafeInteger(limitMicroUsd) || limitMicroUsd <= 0 || limitMicroUsd > 8_000_000) throw new Error('BUDGET_LIMIT_INVALID');
    if (!Number.isSafeInteger(runLimitMicroUsd) || runLimitMicroUsd <= 0) throw new Error('BUDGET_RUN_LIMIT_INVALID');
    this.path = resolve(path);
    this.snapshot(); // Validate/create ledger before any provider can be invoked.
  }

  private transaction<T>(operation: (manager: InMemoryBudgetManager, pending: Map<string, Pending>, append: (entry: RecordEntry) => void) => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    let lockFd: number;
    try { lockFd = openSync(lock, 'wx', 0o600); } catch { throw new Error('BUDGET_LEDGER_LOCKED'); }
    let fd: number | undefined;
    try {
      fd = openSync(this.path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      if (!fstatSync(fd).isFile()) throw new Error('BUDGET_LEDGER_INVALID');
      const journal = readFileSync(fd, 'utf8');
      if (journal && !journal.endsWith('\n')) throw new Error('BUDGET_LEDGER_TRUNCATED');
      let replayTime = this.now();
      const manager = new InMemoryBudgetManager(defaultBudgetConfig, () => replayTime);
      const pending = new Map<string, Pending>();
      for (const line of journal.split('\n').filter(Boolean)) {
        const entry = recordSchema.parse(JSON.parse(line));
        replayTime = new Date(entry.at);
        if (entry.kind === 'reserve') {
          const reservation = manager.reserve(entry.runId, entry.maximum, entry.pricing);
          if (reservation.id !== entry.id) throw new Error('BUDGET_LEDGER_SEQUENCE_INVALID');
          pending.set(entry.id, entry);
        } else {
          manager.settle(entry.id, entry.actual);
          pending.delete(entry.id);
        }
      }
      replayTime = this.now();
      return operation(manager, pending, entry => {
        const bytes = Buffer.from(`${JSON.stringify(entry)}\n`);
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd!, bytes, offset, bytes.length - offset);
        fsyncSync(fd!); // Must complete before caller sends a paid request.
      });
    } catch (error) {
      // Do not include journal contents or provider metadata in error messages.
      if (error instanceof Error && /^BUDGET_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('BUDGET_LEDGER_UNAVAILABLE');
    } finally {
      if (fd !== undefined) closeSync(fd);
      closeSync(lockFd);
      unlinkSync(lock);
    }
  }

  reserve(runId: string, maximum: TokenUsage, pricing: TokenPricing): BudgetReservation {
    return this.transaction((manager, pending, append) => {
      const snapshot = manager.snapshot();
      const cost = estimateCost(maximum, pricing);
      if (snapshot.spentMicroUsd + snapshot.reservedMicroUsd + cost > this.limitMicroUsd) throw new Error('BUDGET_MONTHLY_STOP');
      if (this.accounting(manager, pending, runId).costMicroUsd + cost > this.runLimitMicroUsd) throw new Error('BUDGET_RUN_STOP');
      let reservation: BudgetReservation;
      try { reservation = manager.reserve(runId, maximum, pricing); } catch { throw new Error('BUDGET_MONTHLY_STOP'); }
      append({ kind: 'reserve', at: this.now().toISOString(), id: reservation.id, runId, maximum, pricing });
      return reservation;
    });
  }

  settle(id: string, actual: TokenUsage): RunAccounting {
    return this.transaction((manager, pending, append) => {
      const entry = pending.get(id);
      if (!entry) throw new Error('BUDGET_RESERVATION_UNKNOWN');
      manager.settle(id, actual);
      append({ kind: 'settle', at: this.now().toISOString(), id, actual });
      return manager.runAccounting(entry.runId);
    });
  }

  snapshot(): BudgetSnapshot { return this.transaction(manager => manager.snapshot()); }

  runAccounting(runId: string): RunAccounting {
    return this.transaction((manager, pending) => this.accounting(manager, pending, runId));
  }

  private accounting(manager: InMemoryBudgetManager, pending: Map<string, Pending>, runId: string): RunAccounting {
    const accounting = manager.runAccounting(runId);
    // Count unresolved requests in both the run limit and conservative reports.
    for (const entry of pending.values()) if (entry.runId === runId) {
      accounting.costMicroUsd += estimateCost(entry.maximum, entry.pricing);
      accounting.usage.inputTokens += entry.maximum.inputTokens;
      accounting.usage.outputTokens += entry.maximum.outputTokens;
    }
    return accounting;
  }
}
