import { createServer } from 'node:http';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { initRealtime } from './services/realtime.js';

async function main() {
  await connectDB();
  // No host → Node listens dual-stack (IPv4 + IPv6), so localhost, the Android
  // emulator (10.0.2.2) and phones on the same Wi-Fi can all reach it.
  const server = createServer(createApp());
  initRealtime(server);
  server.listen(env.port, () => console.log(`Subkamyaab API running on http://localhost:${env.port}/api/v1`));
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
