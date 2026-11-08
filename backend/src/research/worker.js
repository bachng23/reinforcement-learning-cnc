require('dotenv').config({ quiet: true });
const prisma = require('../config/prisma');
const { workOnce } = require('./service');
const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
async function main() {
  while (!controller.signal.aborted) {
    const worked = await workOnce({ signal: controller.signal });
    if (!worked) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 500); controller.signal.addEventListener('abort', done, { once: true });
      if (controller.signal.aborted) done();
    });
  }
}
main().catch(error => { console.error(JSON.stringify({ code: 'RESEARCH_WORKER_STOPPED', name: error.name })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
