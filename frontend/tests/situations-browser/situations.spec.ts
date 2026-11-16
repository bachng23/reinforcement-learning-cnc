import {test,expect,type Page} from '@playwright/test';
import {branchSession,savedSituation,sourceSession,sourceId,branchId,injected} from '../situation-fixtures';
import {healthAt,workOrdersAt} from '../simulation-inspection-fixtures';

// Explicit M1 browser double. It exercises the consumer, not the missing Flex physics/runtime.
async function contractHarness(page:Page,tick:6|7){
  let source=sourceSession(tick);let branch=branchSession(tick);let saved=savedSituation(tick);let frozen=structuredClone(source);
  let unavailable=false;const posts:{path:string;body:Record<string,unknown>;key:string|undefined}[]=[];
  const receipts=new Map<string,unknown>();
  await page.route('**/api/v1/**',async route=>{
    const req=route.request();const url=new URL(req.url());const path=url.pathname.replace('/api/v1/research','');
    const headers={'access-control-allow-origin':'http://127.0.0.1:3116','access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Idempotency-Key'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const send=(data:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify({success:true,data})});
    const error=(code:string,status:number)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify({success:false,error:{code,message:code}})});
    if(url.pathname==='/api/v1/auth/me')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({success:true,user:{id:'10000000-0000-4000-8000-000000000003',role:'ENGINEER',username:'Operator'}})});
    if(path==='/capabilities')return send({learned_releases:[]});
    if(req.method()==='POST'){
      const body=req.postDataJSON() as Record<string,unknown>;const key=req.headers()['idempotency-key'];posts.push({path,body,key});
      if(key&&receipts.has(key))return send(receipts.get(key),201);
      if(path===`/demo/sessions/${sourceId}/snapshots`){
        frozen=structuredClone(source);saved={...saved,name:String(body.name),description:String(body.description??''),layoutId:String(body.layoutId),sourceRevision:source.revision,revision:source.revision,sourceTick:source.primary.state.tick,tick:source.primary.state.tick};
        if(key)receipts.set(key,saved);return send(saved,201);
      }
      if(path===`/demo/snapshots/${saved.snapshotId}/sessions`){
        if(unavailable)return error('DEMO_SCENARIO_RUNTIME_UNAVAILABLE',503);
        branch={...branch,...structuredClone(frozen),id:branchId,sessionId:branchId,revision:0,tick:saved.sourceTick,playbackPaused:true,
          context:{layoutId:saved.layoutId},incidents:[],branch:{...branch.branch,snapshotId:saved.snapshotId,snapshotHash:saved.snapshotHash,sourceRevision:saved.sourceRevision,sourceTick:saved.sourceTick,branchStartTick:saved.sourceTick}};
        if(key)receipts.set(key,branch);return send(branch,201);
      }
      if(path===`/demo/sessions/${branchId}/incidents`){
        if(unavailable)return error('DEMO_SCENARIO_RUNTIME_UNAVAILABLE',503);
        if(body.revision!==branch.revision)return error('DEMO_STALE',409);
        const when=Number(body.scheduledTick);const event={...injected(when>branch.tick?'SCHEDULED':'APPLIED'),scheduledTick:when,appliedTick:when>branch.tick?null:when,
          machineIndex:Number(body.machineIndex),componentIndex:Number(body.componentIndex),requestedReason:String(body.reason)};
        branch=structuredClone(branch);branch.revision++;branch.incidents=[...branch.incidents??[],event];
        if(event.status==='APPLIED')branch.primary.state.components[event.machineIndex][event.componentIndex].failed=true;
        const result={session:branch,event};if(key)receipts.set(key,result);return send(result,201);
      }
      if(path.endsWith('/commands')){
        if(path.includes(sourceId)){source=sourceSession(7);return send(source);}
        branch=structuredClone(branch);branch.revision++;branch.tick++;branch.primary.state.tick=branch.tick;branch.baseline.state.tick=branch.tick;
        branch.incidents=branch.incidents?.map(event=>{
          if(event.status!=='SCHEDULED'||event.scheduledTick!==branch.tick)return event;
          branch.primary.state.components[event.machineIndex][event.componentIndex].failed=true;
          return {...event,status:'APPLIED',appliedTick:branch.tick};
        });return send(branch);
      }
      return error('UNEXPECTED_TEST_COMMAND',404);
    }
    if(path==='/demo/snapshots')return send({items:[saved],nextCursor:null});
    if(path===`/demo/snapshots/${saved.snapshotId}`)return send(saved);
    const current=path.includes(branchId)?branch:source;
    if(path.endsWith('/incidents'))return send({sessionId:current.id,revision:current.revision,tick:current.primary.state.tick,source:'JCST_SIMULATION',events:current.incidents??[]});
    if(path.includes('/health')){
      if(Number(url.searchParams.get('expectedRevision'))!==current.revision)return error('DEMO_STALE',409);
      const machine=Number(path.match(/machines\/(\d+)/)?.[1]);const template=healthAt(current.primary.state.tick===6?6:7);
      const servicing=current.primary.state.jobs.some(job=>job?.machine===machine);const failed=current.primary.state.components[machine].some(component=>component.failed);
      const status=servicing?'IN_SERVICE':failed?'BREAKDOWN':'WORKING';
      const components=current.primary.state.components[machine].map((component,index)=>({componentIndex:index,ageTicks:component.age,failed:component.failed,failureRisk:null,riskUnavailableReason:servicing?'IN_SERVICE':failed?'BREAKDOWN':null}));
      const events=(machine===2?template.history.events:[]).map(event=>({...event,eventId:'je1_'+Buffer.from(JSON.stringify([current.id,'primary',event.recordTick,event.eventIndex])).toString('base64url')}));
      for(const event of current.incidents??[]){if(event.status==='APPLIED'&&event.machineIndex===machine)events.push({eventId:event.eventId,type:'failure',tick:event.appliedTick!,recordTick:event.appliedTick!,eventIndex:-1,machineIndex:machine,componentIndex:event.componentIndex,technicianIndex:null,kind:null,provenance:'CONTROLLED_INCIDENT'} as typeof events[number]);}
      return send({...template,sessionId:current.id,revision:current.revision,tick:current.primary.state.tick,machineIndex:machine,machineStatus:status,components,
        history:{...template.history,toTick:current.primary.state.tick,samples:[],events}});
    }
    if(path.endsWith('/work-orders')){
      const machine=Number(url.searchParams.get('machineIndex'));const data=workOrdersAt(current.primary.state.tick===6?6:7);
      return send({...data,sessionId:current.id,revision:current.revision,tick:current.primary.state.tick,items:data.items.filter(order=>order.machineIndex===machine)});
    }
    if(path===`/demo/sessions/${sourceId}`||path===`/demo/sessions/${branchId}`)return send(current);
    return error('UNEXPECTED_TEST_READ',404);
  });
  return {posts,unavailable:()=>{unavailable=true;},current:()=>branch,saved:()=>saved};
}

async function openLibrarySituation(page:Page){
  await page.getByRole('button',{name:'Saved situations',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:/Maintenance exercise.*t/}).click();
  await expect(dialog.getByRole('button',{name:'Open as new session'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Open as new session'}).click();
  await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(new RegExp(`session=${branchId}`));
}
test('component evidence: save repair snapshot, advance source, open independently paused',async({page},info)=>{
  const api=await contractHarness(page,6);await page.goto(`/simulation?session=${sourceId}`);
  await page.getByRole('button',{name:'Save situation',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByText(/T2 → M3\/C2/)).toBeVisible();await dialog.getByRole('textbox',{name:'Situation name',exact:true}).fill('Repair checkpoint');
  await page.screenshot({path:info.outputPath('component-save-repair.png')});
  await dialog.getByRole('button',{name:'Save situation',exact:true}).click();await expect(dialog.getByText('Saved “Repair checkpoint”')).toBeVisible();
  await dialog.getByRole('button',{name:'Close situation panel'}).click();await page.getByRole('button',{name:'Step',exact:true}).click();
  await page.getByRole('button',{name:'Saved situations',exact:true}).click();await dialog.getByRole('button',{name:/Repair checkpoint.*t6/}).click();
  await expect(dialog.getByRole('button',{name:'Open as new session'})).toBeEnabled();
  await page.screenshot({path:info.outputPath('component-library.png')});
  await dialog.getByRole('button',{name:'Open as new session'}).click();await expect(page).toHaveURL(new RegExp(`session=${branchId}`));
  await expect(page.getByRole('button',{name:'Run simulator',exact:true})).toBeEnabled();expect(api.current().primary.state.jobs[1]?.remaining).toBe(1);expect(api.current().tick).toBe(6);
  await expect(page.getByText(/Playback is paused/)).toBeVisible();await page.screenshot({path:info.outputPath('component-restored-paused.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('component evidence: open healthy situation, inject now, reload without reposting',async({page},info)=>{
  const api=await contractHarness(page,7);await page.goto(`/simulation?session=${sourceId}`);await openLibrarySituation(page);
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'Inspect machine M3'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Create incident',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Incident execution review'})).toContainText('Apply at t7');
  await dialog.getByRole('combobox',{name:'Incident component',exact:true}).selectOption('1');await dialog.getByRole('textbox',{name:'Incident note'}).fill('M3/C2 training failure');
  await dialog.getByRole('region',{name:'Incident execution review'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-incident-review.png')});
  await dialog.getByRole('button',{name:'Create injected incident'}).click();
  await expect(dialog.getByText('Injected incident · APPLIED',{exact:true}).first()).toBeVisible();expect(api.current().tick).toBe(7);
  await expect(dialog.getByRole('region',{name:'Injected incidents'}).getByText('Injected incident · APPLIED',{exact:true})).toBeVisible();
  await dialog.getByRole('region',{name:'Injected incidents'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-incident-applied.png')});
  const postCount=api.posts.length;await page.reload();await expect(page.getByRole('dialog').getByText('Injected incident · APPLIED',{exact:true})).toBeVisible();expect(api.posts).toHaveLength(postCount);
  expect(api.current().primary.state.components[2][1].failed).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('component evidence: schedule after two steps, display server outcome and runtime unavailable',async({page},info)=>{
  const api=await contractHarness(page,7);await page.goto(`/simulation?session=${sourceId}`);await openLibrarySituation(page);
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'Inspect machine M3'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Create incident',exact:true}).click();await expect(dialog.getByRole('region',{name:'Incident execution review'})).toBeVisible();
  await dialog.getByRole('combobox',{name:'Execution',exact:true}).selectOption('after');await dialog.getByRole('textbox',{name:'Incident note'}).fill('Scheduled training failure');
  await dialog.getByRole('button',{name:'Create injected incident'}).click();await expect(dialog.getByText('Injected incident · SCHEDULED',{exact:true}).first()).toBeVisible();
  await expect(dialog.getByRole('region',{name:'Injected incidents'}).getByText('Injected incident · SCHEDULED',{exact:true})).toBeVisible();
  expect(api.posts.at(-1)?.body.scheduledTick).toBe(9);await page.screenshot({path:info.outputPath('component-scheduled.png')});
  await dialog.getByRole('button',{name:'Close machine details'}).click();await page.getByRole('button',{name:'Step',exact:true}).click();await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.getByText('Injected incident · APPLIED',{exact:true})).toBeVisible();expect(api.current().tick).toBe(9);
  api.unavailable();await page.getByRole('button',{name:'Saved situations',exact:true}).click();await dialog.getByRole('button',{name:/Maintenance exercise/}).click();await dialog.getByRole('button',{name:'Open as new session'}).click();
  await expect(dialog.getByRole('alert')).toContainText('runtime is unavailable');await page.screenshot({path:info.outputPath('component-runtime-unavailable.png')});
  await expect(page).toHaveURL(new RegExp(`session=${branchId}`));
});
