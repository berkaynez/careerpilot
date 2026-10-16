import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SubmissionReceipt, SubmissionVerifier } from '../contracts.js';
import { applicationHtml, applicationKinds, documentHtml, escapeHtml, validateApplication } from './forms.js';
import type { ApplicationKind } from './forms.js';

export interface MockServer extends SubmissionVerifier {
  origin: string;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 32_768) throw new Error('Request too large');
    body += String(chunk);
  }
  return body;
}

export async function startMockServer(port = 0): Promise<MockServer> {
  const submissions = new Map<string, { receipt: SubmissionReceipt; kind: ApplicationKind; payload: string }>();
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-DNS-Prefetch-Control', 'off');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
    const reply = (status: number, body: string) => { response.writeHead(status); response.end(body); };
    try {
      if (request.headers.host !== new URL(origin).host) return reply(403, 'Unexpected Host');
      const url = new URL(request.url ?? '/', origin);
      if (url.origin !== origin) return reply(403, 'Unexpected origin');
      if (request.method === 'GET' && url.pathname === '/') {
        return reply(200, documentHtml('CareerPilot local demo', `<h1>Local application lab</h1><p>Use fictional data only. All submissions stay in memory on this machine.</p>
          ${applicationKinds.map(kind => `<p><a href="/applications/${kind}">${kind} application</a></p>`).join('')}`));
      }
      const match = /^\/applications\/(single|multi|dynamic)(\/submit)?$/.exec(url.pathname);
      if (match) {
        const kind = match[1] as ApplicationKind;
        if (request.method === 'GET' && !match[2]) {
          const runId = url.searchParams.get('runId') ?? randomUUID();
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) return reply(400, 'Invalid run ID');
          return reply(200, applicationHtml(kind, runId));
        }
        if (request.method === 'POST' && match[2]) {
          if (request.headers.origin !== origin) return reply(403, 'Same-origin submission required');
          if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return reply(415, 'URL-encoded form required');
          const data = new URLSearchParams(await readBody(request));
          const errors = validateApplication(kind, data);
          if (errors.length) return reply(422, documentHtml('Application needs corrections', `<h1>Application not submitted</h1><div role="alert">${errors.map(escapeHtml).join('<br>')}</div>`));
          const runId = data.get('runId')!;
          data.sort();
          const existing = submissions.get(runId);
          if (existing && (existing.kind !== kind || existing.payload !== data.toString())) return reply(409, 'Run already submitted with different data');
          const receipt = existing?.receipt ?? { runId, receiptId: randomUUID(), origin };
          submissions.set(runId, { receipt, kind, payload: data.toString() });
          return reply(200, documentHtml('Mock application received', `<h1>Mock application received</h1><section role="status" data-receipt-id="${receipt.receiptId}">
            Receipt: ${receipt.receiptId}<br>Run: ${escapeHtml(runId)}</section><p>No real application was sent.</p><a href="/">Return to the lab</a>`));
        }
        return reply(405, 'Method not allowed');
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/receipts/')) {
        const runId = decodeURIComponent(url.pathname.slice('/api/receipts/'.length));
        const receipt = submissions.get(runId)?.receipt;
        response.setHeader('Content-Type', 'application/json');
        return reply(receipt ? 200 : 404, JSON.stringify(receipt ?? { error: 'No receipt' }));
      }
      return reply(404, 'Not found');
    } catch {
      return reply(400, 'Invalid request');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    async verify(runId, signal) {
      signal.throwIfAborted();
      const receipt = submissions.get(runId)?.receipt;
      return receipt ? { ...receipt } : null;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
