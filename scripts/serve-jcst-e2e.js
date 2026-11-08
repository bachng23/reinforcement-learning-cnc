// Dedicated, disposable browser-test schema. Never uses DATABASE_URL as fallback.
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const url = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing');
if (!['postgres:','postgresql:'].includes(url.protocol) || !/_(test|ci)$/.test(url.pathname)) throw new Error('Explicit dedicated TEST_DATABASE_URL ending in _test/_ci is required');
const schema = `jcst_browser_${crypto.randomBytes(8).toString('hex')}`;
url.searchParams.set('schema',schema);
process.env.DATABASE_URL=url.toString(); process.env.NODE_ENV='test';
process.env.JWT_SECRET='jcst-browser-test-only-secret-at-least-32-characters';
process.env.CLIENT_URL='http://127.0.0.1:3108';
process.env.RESEARCH_ARTIFACT_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'jcst-browser-artifacts-'));
const cli=path.join(root,'backend/node_modules/prisma/build/index.js');
const migrated=spawnSync(process.execPath,[cli,'migrate','deploy','--schema',path.join(root,'backend/prisma/schema.prisma')],{env:process.env,stdio:'inherit'});
if(migrated.status!==0)throw new Error('Browser test migration failed');
const prisma=require('../backend/src/config/prisma');
const app=require('../backend/src/app');
const service=require('../backend/src/research/service');
const bcrypt=require('../backend/node_modules/bcrypt');
const controller=new AbortController(); let server, loop;
async function main(){
  const user=await prisma.user.create({data:{username:'jcst-browser',passwordHash:await bcrypt.hash('jcst-browser-test-password',4),role:'ADMIN'}});
  const seeded=await service.enqueueImport(user,require('../contracts/jcst/v1/fixtures/engineering-bundle.json'),'browser-seed');
  await service.workOnce();
  const job=await service.getJob(user,seeded.job.id);if(job.status!=='SUCCEEDED')throw new Error('Engineering seed import failed');
  loop=(async()=>{while(!controller.signal.aborted){if(!await service.workOnce({signal:controller.signal}))await new Promise(r=>setTimeout(r,100));}})();
  server=app.listen(5108,'127.0.0.1',()=>console.log('JCST_BROWSER_READY'));
}
async function cleanup(){
  controller.abort(); if(server)await new Promise(r=>server.close(r)); if(loop)await loop;
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await prisma.$disconnect();
  fs.rmSync(process.env.RESEARCH_ARTIFACT_DIR,{recursive:true,force:true});
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>cleanup().then(()=>process.exit(0)));
main().catch(async error=>{console.error(error);await cleanup();process.exitCode=1;});
