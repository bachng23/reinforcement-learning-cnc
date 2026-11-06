const { fork } = require('node:child_process');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
async function startApi(environment = {}) {
  const child = fork(require.resolve('./work-order-http-process'), [], {
    env: { ...process.env, ...environment },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const closed = once(child, 'exit');
  let timer;
  const stop = async () => {
    if (child.connected) child.send('stop');
    const kill = setTimeout(() => child.kill(), 5000);
    try {
      await closed;
    } finally {
      clearTimeout(kill);
    }
  };
  try {
    const [ready] = await Promise.race([
      once(child, 'message'),
      closed.then(() => {
        throw Error('API process exited before ready');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('API process startup timeout')), 15000);
      }),
    ]);
    clearTimeout(timer);
    return {
      stop,
      async http(path, user, { body, key = randomUUID() } = {}) {
        const r = await fetch(`http://127.0.0.1:${ready.port}/api/v1${path}`, {
          method: body ? 'POST' : 'GET',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: 'Bearer ' + jwt.sign({ id: user.id }, process.env.JWT_SECRET),
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
            'X-Request-Id': 'restart-proof',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return {
          status: r.status,
          body: await r.json(),
          replay: r.headers.get('idempotency-replayed'),
          cache: r.headers.get('cache-control'),
        };
      },
    };
  } catch (error) {
    clearTimeout(timer);
    await stop();
    throw error;
  }
}
module.exports = { startApi };
