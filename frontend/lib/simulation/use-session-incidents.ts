'use client';
import {useEffect,useRef,useState} from 'react';
import {situationsApi,situationError} from './situations';
import type {Simulation} from './types';
import type {IncidentList} from '@/types/generated/simulation-situations';

export type IncidentRead={data?:IncidentList;loading:boolean;error?:string;retry:()=>void};
export function useSessionIncidents(session:Simulation|undefined):IncidentRead{
  const id=session?.branch?session.id:undefined;const revision=session?.revision;
  const latest=useRef(session);latest.current=session;
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{id:string;revision:number;data?:IncidentList;error?:string;loading:boolean}>();
  useEffect(()=>{
    if(!id||revision===undefined)return;
    const abort=new AbortController();setState({id,revision,loading:true});
    const timer=setTimeout(async()=>{
      try{const data=await situationsApi.incidents(latest.current!,abort.signal);if(!abort.signal.aborted)setState({id,revision,data,loading:false});}
      catch(error){if(!abort.signal.aborted)setState({id,revision,loading:false,error:situationError(error)});}
    },180);
    return()=>{clearTimeout(timer);abort.abort();};
  },[id,revision,attempt]);
  const visible=state?.id===id&&state?.revision===revision?state:undefined;
  return {data:visible?.data,error:visible?.error,loading:Boolean(id)&&(!visible||visible.loading),retry:()=>setAttempt(value=>value+1)};
}
