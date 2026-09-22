const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { ApiError } = require('../lib/api-error');

const root = path.resolve(__dirname, '../..');
function pythonExecutable() {
  if (process.env.OPERATIONS_PYTHON) return process.env.OPERATIONS_PYTHON;
  const local = path.join(root, '.venv-operations', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return fs.existsSync(local) ? local : 'python';
}

// Transport-only bridge; no shell and no HTTP input is used as a command or path.
function pythonJson(script, args = [], input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), [script, ...args], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let overflow = false;
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', (part) => {
      out += part;
      if (Buffer.byteLength(out) > 4 * 1024 * 1024) { overflow = true; child.kill(); }
    });
    child.stderr.resume(); // Never expose raw contract input, environment or tracebacks.
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new ApiError(503, 'OPERATIONS_VALIDATOR_UNAVAILABLE', 'Operations validator is unavailable')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 2 && !overflow) return reject(new ApiError(400, 'INVALID_OPERATIONS_SCHEMA', 'Operations contract or seed hash validation failed'));
      if (code !== 0 || overflow) return reject(new ApiError(503, 'OPERATIONS_VALIDATOR_UNAVAILABLE', 'Operations validator is unavailable'));
      try { resolve(JSON.parse(out)); } catch { reject(new ApiError(503, 'OPERATIONS_VALIDATOR_UNAVAILABLE', 'Operations validator returned an invalid response')); }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  // JSON objects may originate in another JS realm (fetch/structuredClone).
  if (value && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value)?.constructor?.name === 'Object')) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new ApiError(400, 'INVALID_OPERATIONS_SCHEMA', 'Payload must contain finite JSON values');
}
const contentHash = (payload) => createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
async function validatePayload(payload, mode = 'snapshot') {
  canonicalJson(payload); // Reject unsupported/non-finite input before JSON transport can coerce it.
  const result = await pythonJson(path.join(root, 'scripts/validate-operations.py'), [], { mode, payload });
  if (!result.ok) throw new ApiError(400, 'INVALID_OPERATIONS_SCHEMA', 'Operations contract validation failed');
  return result.payload;
}
const loadCanonicalSeedPlan = () => pythonJson(path.resolve(root, '../scripts/demo-seed-plan.py'), ['seed']);
module.exports = { contentHash, validatePayload, loadCanonicalSeedPlan };
