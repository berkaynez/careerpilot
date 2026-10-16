import { startMockServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const server = await startMockServer(port);
console.log(`CareerPilot local demo: ${server.origin}`);
console.log('Open this URL manually. Use only fictional data; Ctrl+C stops the server.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  void server.close().then(() => process.exit(0));
});
