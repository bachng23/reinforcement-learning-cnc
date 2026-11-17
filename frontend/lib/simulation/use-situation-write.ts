'use client';
import {useEffect,useRef,useState} from 'react';
import type {SituationCommand,SituationExecutor,SituationResult} from './situations';
import {situationError} from './situations';

type Journal={input:string;key:string;command:SituationCommand};
function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
export function useSituationWrite(scope:string,execute:SituationExecutor){
  const [state,setState]=useState<{scope:string;pending:boolean;error?:string;code?:string;status?:number;result?:SituationResult}>();
  const lock=useRef(false);const controller=useRef<AbortController|null>(null);const generation=useRef(0);
  const storageKey=`aims-situation-write:${scope}`;const journal=useRef<Journal|null>(null);
  const [recovery,setRecovery]=useState<{scope:string;command:SituationCommand}>();
  useEffect(()=>{
    journal.current=null;const active=++generation.current;
    try{const saved=JSON.parse(sessionStorage.getItem(`aims-situation-write:${scope}`)??'null') as Journal|null;
      if(saved?.input&&typeof saved.key==='string'&&saved.command)setRecovery({scope,command:saved.command});else setRecovery(undefined);
    }catch{setRecovery(undefined);}
    return()=>{generation.current=active+1;controller.current?.abort();lock.current=false;};
  },[scope]);
  function reset(){journal.current=null;try{sessionStorage.removeItem(storageKey);}catch{}setState(undefined);setRecovery(undefined);}
  async function run(command:SituationCommand){
    if(lock.current)return;lock.current=true;
    const operationGeneration=generation.current;const abort=new AbortController();controller.current=abort;
    const input=canonical(command.kind==='open'?{kind:command.kind,snapshotId:command.snapshot.snapshotId,body:command.body}:command);
    let saved=journal.current;
    if(!saved){try{const value=JSON.parse(sessionStorage.getItem(storageKey)??'null') as Journal|null;if(value?.input&&typeof value.key==='string')saved=value;}catch{}}
    if(saved?.input!==input)saved={input,key:crypto.randomUUID(),command};
    journal.current=saved;try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
    setState({scope,pending:true});
    try{
      const result=await execute(saved.command,saved.key,abort.signal);
      if(abort.signal.aborted||operationGeneration!==generation.current)return;
      journal.current=null;try{sessionStorage.removeItem(storageKey);}catch{}
      setState({scope,pending:false,result});setRecovery(undefined);return result;
    }catch(error){
      if(!abort.signal.aborted&&operationGeneration===generation.current)setState({scope,pending:false,error:situationError(error),
        code:(error as {code?:string})?.code,status:(error as {status?:number})?.status});
    }finally{if(operationGeneration===generation.current)lock.current=false;}
  }
  const visible=state?.scope===scope?state:undefined;
  return {...visible,pending:visible?.pending??false,recovery:recovery?.scope===scope?recovery.command:undefined,run,reset};
}
