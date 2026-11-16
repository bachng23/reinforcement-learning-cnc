import {readFile,writeFile} from 'node:fs/promises';
const source=new URL('../contracts/jcst-situations/producer.d.ts',import.meta.url);
const target=new URL('../types/generated/simulation-situations.ts',import.meta.url);
const result='/* Generated verbatim from the Backend situation consumer DTO (be8b299). Do not edit. */\n'+(await readFile(source,'utf8')).replaceAll('\r\n','\n');
if(process.argv.includes('--check')){
  if((await readFile(target,'utf8')).replaceAll('\r\n','\n')!==result)throw new Error('Situation DTO is out of date');
}else await writeFile(target,result);
