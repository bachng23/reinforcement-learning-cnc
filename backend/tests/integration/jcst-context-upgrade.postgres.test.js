const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
test('populated upgrade from exact JCST base preserves session payload/revisions/audit and leaves context null', async () => {
  const root = path.resolve(__dirname, '../../..'), base = '3359d97a0b2bbef35b9d7ae02fe4200acaa7fb64';
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jcst-context-upgrade-'));
  const schema = 'product_api_it_jcst_up_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!/_(test|ci)$/.test(url.pathname)) throw Error('Dedicated test DB required');
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const journal = process.env.OPERATIONS_SCHEMA_JOURNAL;
  if (journal) fs.appendFileSync(journal, JSON.stringify({ schema,
    target: createHash('sha256').update(new URL(process.env.TEST_DATABASE_URL).toString()).digest('hex') }) + '\n');
  const git = args => execFileSync('git', args, { cwd: root });
  const cli = path.resolve(__dirname, '../../node_modules/prisma/build/index.js');
  const deploy = filename => execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', filename],
    { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 60000, stdio: 'pipe' });
  try {
    const files = git(['ls-tree', '-r', '--name-only', base, '--', 'backend/prisma']).toString().trim().split('\n')
      .filter(name => name === 'backend/prisma/schema.prisma' || name.startsWith('backend/prisma/migrations/'));
    for (const file of files) {
      const target = path.join(folder, file.slice('backend/prisma/'.length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, git(['show', base + ':' + file]));
    }
    deploy(path.join(folder, 'schema.prisma'));
    const user = await db.user.create({ data: { username: randomUUID(), passwordHash: 'upgrade-fixture', role: 'ENGINEER' } });
    const id = randomUUID(), original = { status: 'RUNNING', physical_seed: '990000001', oldPayload: ['keep', 7] };
    await db.$executeRaw`INSERT INTO demo_sessions(id,owner_id,request_key,request_hash,revision,payload_json,last_command_key,last_command_hash)
      VALUES(${id}::uuid,${user.id}::uuid,'original-key',${'a'.repeat(64)},7,${JSON.stringify(original)}::jsonb,'old-command',${'b'.repeat(64)})`;
    await db.auditLog.create({ data: { entityType: 'SYSTEM', entityId: id, actorUserId: user.id, action: 'DEMO_CREATED', payloadJson: { preserved: true } } });
    const capture = async () => ({ users: await db.$queryRawUnsafe('SELECT to_jsonb(u) AS row FROM users u ORDER BY id'),
      audit: await db.$queryRawUnsafe('SELECT to_jsonb(a) AS row FROM audit_logs a ORDER BY id'),
      sessions: await db.$queryRawUnsafe("SELECT to_jsonb(s) - 'context_json' AS row FROM demo_sessions s ORDER BY id") });
    const before = await capture();
    deploy(path.resolve(__dirname, '../../prisma/schema.prisma'));
    expect(await capture()).toEqual(before);
    const row = await db.demoSession.findUnique({ where: { id } });
    expect(row).toMatchObject({ revision: 7, contextJson: null, payloadJson: original, requestKey: 'original-key', lastCommandKey: 'old-command' });
  } finally {
    await db.$disconnect();
    const adminUrl = new URL(process.env.TEST_DATABASE_URL); adminUrl.searchParams.set('schema', 'public');
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    try { if (!/^product_api_it_jcst_up_[a-f0-9]{32}$/.test(schema)) throw Error('Unexpected owned schema');
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      if (journal) fs.writeFileSync(journal, fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)
        .filter(line => JSON.parse(line).schema !== schema).map(line => line + '\n').join(''));
    } finally { await admin.$disconnect(); }
    const resolved = path.resolve(folder);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('jcst-context-upgrade-')) throw Error('Unexpected temp folder');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}, 150000);
