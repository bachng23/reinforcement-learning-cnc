// Isolated, manifest-verified runtime for Windows CRLF checkouts. Production
// verification remains unchanged; no files in the source checkout are rewritten.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
function runtime() {
  const source = path.resolve(__dirname, '../../../ai_services');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jcst-health-runtime-'));
  const close = () => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())
      || !path.basename(root).startsWith('jcst-health-runtime-')) throw new Error('Unexpected temporary runtime cleanup target');
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    fs.cpSync(path.join(source, 'domain/jcst'), path.join(root, 'domain/jcst'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(source, 'scripts/jcst_bridge.py'), path.join(root, 'scripts/jcst_bridge.py'));
    const vendor = path.join(root, 'vendor/jcst');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'vendor/jcst/manifest.json')));
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, 'manifest.json'), JSON.stringify(manifest));
    for (const [name, entry] of Object.entries(manifest.files)) {
      let bytes = fs.readFileSync(path.join(source, 'vendor/jcst', name));
      const hash = b => createHash('sha256').update(b).digest('hex');
      if (hash(bytes) !== entry.sha256) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
      if (hash(bytes) !== entry.sha256) throw new Error(`Pinned runtime mismatch: ${name}`);
      const target = path.join(vendor, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    return { script: path.join(root, 'scripts/jcst_bridge.py'), close };
  } catch (e) {
    close(); throw e;
  }
}
module.exports = { runtime };
