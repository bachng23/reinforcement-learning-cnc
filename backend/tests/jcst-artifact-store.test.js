const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { artifactStore, canonical, sha } = require('../src/research/artifact-store');
test('canonical identity ignores object key order and preserves decimal seed strings', () => {
  expect(sha(canonical({seed:'18446744073709551617',b:1}))).toBe(sha(canonical({b:1,seed:'18446744073709551617'})));
  expect(canonical({seed:'18446744073709551617'})).toContain('"18446744073709551617"');
});
test('atomic concurrent publication, corruption detection and path confinement', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'jcst-store-')); const store=artifactStore(root);
  try {
    const hashes=await Promise.all([store.put('original bytes\n'),store.put('original bytes\n')]);
    expect(hashes[0]).toBe(hashes[1]); expect((await store.get(hashes[0])).toString()).toBe('original bytes\n');
    await expect(store.get('../secret')).rejects.toMatchObject({code:'INVALID_ARTIFACT_HASH'});
    await fs.writeFile(path.join(root,hashes[0].slice(0,2),hashes[0]),'changed');
    await expect(store.get(hashes[0])).rejects.toMatchObject({code:'ARTIFACT_CORRUPT'});
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
