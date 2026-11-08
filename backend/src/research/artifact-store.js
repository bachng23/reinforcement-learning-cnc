const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ApiError } = require('../lib/api-error');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function artifactStore(root = process.env.RESEARCH_ARTIFACT_DIR || path.resolve(__dirname, '../../../artifacts/research')) {
  const location = digest => {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ApiError(400, 'INVALID_ARTIFACT_HASH', 'Invalid artifact hash');
    return path.join(root, digest.slice(0, 2), digest);
  };
  return {
    async put(bytes) {
      const data = Buffer.from(bytes); const digest = sha(data); const file = location(digest);
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Atomic publication; readers never observe a partial content-addressed file.
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      try { await fs.link(temporary, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      finally { await fs.unlink(temporary); }
      if (sha(await fs.readFile(file)) !== digest) throw new ApiError(409, 'ARTIFACT_CORRUPT', 'Stored artifact integrity check failed');
      return digest;
    },
    async get(digest) {
      let data;
      try { data = await fs.readFile(location(digest)); }
      catch (e) { if (e.code === 'ENOENT') throw new ApiError(409, 'ARTIFACT_UNAVAILABLE', 'Artifact bytes are unavailable'); throw e; }
      if (sha(data) !== digest) throw new ApiError(409, 'ARTIFACT_CORRUPT', 'Stored artifact integrity check failed');
      return data;
    },
    async json(digest) { return JSON.parse((await this.get(digest)).toString('utf8')); },
  };
}
module.exports = { artifactStore, sha, canonical };
