import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
const source = new URL('../../contracts/jcst/v1/jcst.schema.json', import.meta.url);
const target = new URL('../types/generated/jcst.ts', import.meta.url);
// json-schema-to-typescript currently reads draft-07 tuple `items`, while
// Pydantic emits draft-2020-12 `prefixItems`. Preserve exact tuple element types.
function tupleCompatibility(value) {
  if (Array.isArray(value)) return value.map(tupleCompatibility);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, tupleCompatibility(v)]));
  if (result.prefixItems) { result.items = result.prefixItems; result.additionalItems = false; delete result.prefixItems; }
  return result;
}
const output = await compile(tupleCompatibility(JSON.parse(await readFile(source, 'utf8'))), 'JCSTCatalog', {
  bannerComment: '/* Generated from contracts/jcst/v1/jcst.schema.json. Do not edit. */',
  unreachableDefinitions: true, maxItems: -1,
});
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8').catch(() => '') !== output) {
    console.error('JCST TypeScript drift. Run npm run contracts:jcst:generate'); process.exitCode = 1;
  }
} else await writeFile(target, output);
