'use client';
import {useEffect,useMemo,useState} from 'react';
import type {TechniciansResponse,TechnicianSummary} from '@/types/generated/simulation-technicians';
import type {Simulation} from './types';
import {embeddedTechnicians,getTechnicians,legacyTechnicians,technicianError} from './technicians';

export type TechnicianRead={rows?:TechnicianSummary[];data?:TechniciansResponse;loading:boolean;legacy:boolean;error?:string;retry:()=>void};
export function useTechnicianAvailability(session:Simulation|undefined,actorScope:string){
  const [attempt,setAttempt]=useState(0);
  const key=`${actorScope}:${session?.id}:${session?.revision}:${session?.primary.state.tick}`;
  const legacySession=Boolean(session&&session.technicianAvailability===undefined&&session.technicians===undefined&&session.comparisonContext===undefined);
  const embedded=useMemo(()=>{try{return {data:session?embeddedTechnicians(session):undefined};}catch(e){return {error:technicianError(e)};}},[session]);
  const [read,setRead]=useState<{key:string;data?:TechniciansResponse;legacy?:boolean;error?:string}>();
  useEffect(()=>{
    if(!session||legacySession||embedded.data||embedded.error)return;
    const abort=new AbortController();
    const timer=setTimeout(()=>{void getTechnicians(session,abort.signal).then(data=>{if(!abort.signal.aborted)setRead({key,data});}).catch(e=>{
      if(abort.signal.aborted)return;
      if((e as {status?:number}).status===404&&session.technicianAvailability===undefined)setRead({key,legacy:true});else setRead({key,error:technicianError(e)});
    });},120);
    return()=>{clearTimeout(timer);abort.abort();};
  },[session,key,attempt,embedded,legacySession]);
  const current=read?.key===key?read:undefined;
  const data=embedded.data??current?.data;const legacy=legacySession||Boolean(current?.legacy);
  return {data,rows:data?.technicians??(legacy&&session?legacyTechnicians(session):undefined),legacy,
    loading:Boolean(session&&!data&&!legacy&&!embedded.error&&!current?.error),error:embedded.error??current?.error,
    retry:()=>{setRead(undefined);setAttempt(n=>n+1);}} satisfies TechnicianRead;
}
