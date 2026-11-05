import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { compile } from 'json-schema-to-typescript';
// Reuse the parser in the locked schema compiler dependency graph.
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [require.resolve('json-schema-to-typescript')] }));
const source = await readFile(new URL('../../backend/research-openapi.yaml', import.meta.url), 'utf8');
const api = yaml.load(source);
const definitions = {
  ...api.components.schemas,
  DemoCreateRequest: api.paths['/demo/sessions'].post.requestBody.content['application/json'].schema,
  DemoCommandRequest: api.paths['/demo/sessions/{id}/commands'].post.requestBody.content['application/json'].schema,
};
const schema = JSON.parse(JSON.stringify({ definitions }).replaceAll('#/components/schemas/', '#/definitions/'));
const output = await compile(schema, 'DemoReadCatalog', {
  bannerComment: '/* Generated from backend/research-openapi.yaml. Do not edit. */',
  unreachableDefinitions: true, maxItems: -1,
});
const target = new URL('../types/generated/demo-read.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== output.replaceAll('\r\n', '\n')) {
    console.error('Demo read contract drift. Run npm run contracts:demo:generate'); process.exitCode = 1;
  }
} else await writeFile(target, output);
