'use client';
import {useEffect,useRef,useState} from 'react';
import type {TechnicianCommand,TechnicianExecutor} from './technicians';
import {technicianError} from './technicians';
import type {Simulation} from './types';

type Receipt={command:TechnicianCommand;key:string;fingerprint:string};
export function useTechnicianWrite(scope:string,execute:TechnicianExecutor){
  const storage=`aims-technician-write:${scope}`;
  const generation=useRef(0),locked=useRef(false),abort=useRef<AbortController|null>(null);
  const [state,setState]=useState<{scope:string;pending:boolean;error?:string;status?:number;result?:Simulation}>();
  const [recovery,setRecovery]=useState<{scope:string;command:TechnicianCommand}>();
  const journal=useRef<Receipt|null>(null);
  useEffect(()=>{const active=++generation.current;journal.current=null;
    try{const saved=JSON.parse(sessionStorage.getItem(storage)??'null') as Receipt|null;if(saved?.key&&saved.command&&saved.fingerprint)setRecovery({scope,command:saved.command});else setRecovery(undefined);}catch{setRecovery(undefined);}
    return()=>{generation.current=active+1;abort.current?.abort();locked.current=false;};
  },[scope,storage]);
  function reset(){journal.current=null;try{sessionStorage.removeItem(storage);}catch{}setState(undefined);setRecovery(undefined);}
  async function run(command:TechnicianCommand){
    if(locked.current)return;locked.current=true;
    const active=generation.current;const controller=new AbortController();abort.current=controller;
    // Fixed field order; body is exactly the generated DTO reviewed by the user.
    const fingerprint=JSON.stringify([command.kind,command.sessionId,command.technicianIndex,command.basisTick,command.body.revision,command.kind==='absence'?command.body.durationTicks:null,command.body.reason]);
    let saved=journal.current;
    if(!saved){try{saved=JSON.parse(sessionStorage.getItem(storage)??'null') as Receipt|null;}catch{}}
    if(saved?.fingerprint!==fingerprint)saved={command,key:crypto.randomUUID(),fingerprint};
    journal.current=saved;try{sessionStorage.setItem(storage,JSON.stringify(saved));}catch{}
    setState({scope,pending:true});
    try{const result=await execute(saved.command,saved.key,controller.signal);
      if(controller.signal.aborted||active!==generation.current)return;
      reset();setState({scope,pending:false,result});return result;
    }catch(e){if(!controller.signal.aborted&&active===generation.current){
      const status=(e as {status?:number}).status;
      const uncertain=Boolean((e as {outcomeUnknown?:boolean}).outcomeUnknown);
      if(!uncertain&&status&&status>=400&&status<500){journal.current=null;try{sessionStorage.removeItem(storage);}catch{}setRecovery(undefined);}else setRecovery({scope,command:saved.command});
      setState({scope,pending:false,error:technicianError(e),status:uncertain?undefined:status});
    }}
    finally{if(active===generation.current)locked.current=false;}
  }
  const current=state?.scope===scope?state:undefined;
  return {...current,pending:current?.pending??false,recovery:recovery?.scope===scope?recovery.command:undefined,run,reset};
}
