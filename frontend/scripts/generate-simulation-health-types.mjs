import {readFile,writeFile} from 'node:fs/promises';
import {compile} from 'json-schema-to-typescript';
const schema=JSON.parse(await readFile(new URL('../contracts/simulation-machine-health.schema.json',import.meta.url),'utf8'));
const target=new URL('../types/generated/simulation-machine-health.ts',import.meta.url);
const result=await compile(schema,'SimulationMachineHealthContract',{
  bannerComment:'/* Generated from the Backend PR #64 OpenAPI snapshot (eff27fe). Do not edit. */',
});
if(process.argv.includes('--check')){
  const saved=await readFile(target,'utf8');
  if(saved.replaceAll('\r\n','\n')!==result.replaceAll('\r\n','\n'))throw new Error('Simulation health DTO is out of date');
}else await writeFile(target,result);
