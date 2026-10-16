import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentEvent, EventSink } from './contracts.js';

/** Explicit projection prevents extra model/transport properties entering logs. */
export class JsonlEventSink implements EventSink {
  constructor(private readonly path: string) {}
  async write(event: AgentEvent): Promise<void> {
    const safe = { runId: event.runId, at: event.at, type: event.type, code: event.code,
      factIds: event.factIds, usage: event.usage, costMicroUsd: event.costMicroUsd };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await appendFile(this.path, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
  }
}
