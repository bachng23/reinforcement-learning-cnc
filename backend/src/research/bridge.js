const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { ApiError } = require('../lib/api-error');

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'ai_services/scripts/jcst_bridge.py');
const localPython = path.join(root, 'ai_services/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function bridge(input, { signal, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const command = process.env.JCST_PYTHON || (fs.existsSync(localPython) ? localPython : 'python3');
    const child = spawn(command, [process.env.JCST_BRIDGE_SCRIPT || script], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = ''; let bytes = 0; let settled = false;
    const finish = (err, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (err) child.kill('SIGKILL');
      if (err) reject(err); else resolve(value);
    };
    const abort = () => finish(new ApiError(409, 'RESEARCH_JOB_CANCELLED', 'Research job was cancelled'));
    const timer = setTimeout(() => finish(new ApiError(504, 'JCST_TIMEOUT', 'JCST runtime deadline exceeded')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 12_000_000) finish(new ApiError(413, 'JCST_OUTPUT_LIMIT', 'JCST runtime output limit exceeded'));
      else output += chunk;
    });
    child.stderr.resume();
    child.on('error', () => finish(new ApiError(503, 'JCST_UNAVAILABLE', 'JCST runtime is unavailable')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new ApiError(422, 'JCST_VALIDATION_FAILED', 'JCST input, replay or checkpoint validation failed'));
      try { finish(null, JSON.parse(output)); }
      catch { finish(new ApiError(502, 'JCST_INVALID_OUTPUT', 'JCST runtime returned invalid output')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
module.exports = { bridge };
