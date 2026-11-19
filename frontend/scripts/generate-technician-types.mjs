import {readFile,writeFile} from 'node:fs/promises';
const target=new URL('../types/generated/simulation-technicians.ts',import.meta.url);
const text='/* Generated verbatim from Backend technician DTO (145edb0). Do not edit. */\n'+(await readFile(new URL('../contracts/jcst-technicians/producer.d.ts',import.meta.url),'utf8')).replaceAll('\r\n','\n');
if(process.argv.includes('--check')){if((await readFile(target,'utf8')).replaceAll('\r\n','\n')!==text)throw Error('Technician DTO is out of date');}else await writeFile(target,text);
