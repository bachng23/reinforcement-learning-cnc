// Separate API process for persistence/restart tests; never binds outside loopback.
const app = require('../../src/app');
const db = require('../../src/config/prisma');
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
  if (process.connected) process.disconnect();
}
process.on('message', (message) => {
  if (message === 'stop') stop();
});
process.on('disconnect', () => {
  if (!stopping) stop();
});
