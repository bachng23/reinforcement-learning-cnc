import {test,expect,type Page} from '@playwright/test';
import {technicianSession,commandResponse,workforce} from '../technician-fixtures';
import {savedSituation,branchId,injected} from '../situation-fixtures';
import type {Simulation} from '@/lib/simulation/types';
// M1 HTTP contract harness. Server states below are prescribed examples, not a Flex engine.
async function harness(page:Page,role='ENGINEER'){
  let session=technicianSession();session.context={layoutId:'machining'};session.primary.state.components.forEach(parts=>parts.forEach(c=>{c.failed=false;}));
  let failure:string|null=null,hold=false,release:(()=>void)|undefined;const posts:{path:string;body:Record<string,unknown>;key:string|undefined}[]=[];
  const receipts=new Map<string,unknown>();let frozen:Simulation|undefined;
  const saved={...savedSituation(),name:'Absent workforce checkpoint',sourceSessionId:session.id,sessionId:session.id,sourceRevision:session.revision,revision:session.revision,sourceTick:5,tick:5,layoutId:'machining'};
  const context=()=>{session.comparisonContext={...session.comparisonContext!,cacheIdentity:(session.revision%10).toString().repeat(64)};};
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1/research','');
    const headers={'access-control-allow-origin':'http://127.0.0.1:3119','access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Idempotency-Key'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const send=(data:unknown)=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify({success:true,data})});
    const error=(code:string,status:number)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify({success:false,error:{code,message:code}})});
    if(url.pathname==='/api/v1/auth/me')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({success:true,user:{id:'10000000-0000-4000-8000-000000000002',role,username:'Engineer'}})});
    if(path==='/capabilities')return send({learned_releases:[]});
    if(request.method()==='POST'){
      const body=request.postDataJSON() as Record<string,unknown>,key=request.headers()['idempotency-key'];posts.push({path,body,key});
      if(key&&receipts.has(key))return send(receipts.get(key));
      if(role!=='ENGINEER'&&role!=='ADMIN')return error('FORBIDDEN',403);
      if(path.endsWith('/absence')||path.endsWith('/return')){
        if(hold)await new Promise<void>(resolve=>{release=resolve;});
        if(failure){const code=failure;failure=null;if(code==='NETWORK'){return route.abort('failed');}if(code==='DEMO_STALE'){session.revision++;context();return error(code,409);}return error(code,503);}
        if(body.revision!==session.revision)return error('DEMO_STALE',409);
        session=structuredClone(session);session.revision++;session.status='RUNNING';session.pending=null;session.playbackPaused=true;
        const index=Number(path.match(/technicians\/(\d+)/)?.[1]);
        if(path.endsWith('/absence')){
          const fixture=technicianSession('ABSENT'),tick=session.primary.state.tick;
          session.technicianAvailability=fixture.technicianAvailability;session.technicians=fixture.technicians;
          session.comparisonContext=fixture.comparisonContext;
          const interval=session.technicianAvailability!.absences[0];interval.technicianIndex=index;interval.startTick=tick;interval.returnTick=tick+Number(body.durationTicks);
          const event=session.technicianAvailability!.events[0];event.technicianIndex=index;event.tick=tick;event.reason=String(body.reason);
          session.technicians![index]={technicianIndex:index,availability:'ABSENT',currentJob:null,activeAbsence:{eventId:interval.eventId,startTick:tick,returnTick:interval.returnTick},returnTick:interval.returnTick};
        }else{
          const event={eventId:'10000000-0000-4000-8000-000000000088',technicianIndex:index,type:'ABSENCE_RETURNED_EARLY' as const,tick:session.primary.state.tick,actor:{type:'USER' as const,userId:'10000000-0000-4000-8000-000000000002'},reason:String(body.reason)};
          const calendar=session.technicianAvailability!;calendar.version++;calendar.events.push(event);Object.assign(calendar.absences[0],{endedTick:event.tick,endedByEventId:event.eventId});
          calendar.origin={eventId:event.eventId,tick:event.tick,workforceVersion:calendar.version};
          session.comparisonContext={...session.comparisonContext!,workforceVersion:calendar.version,origin:calendar.origin};session.technicians=workforce().technicians;
        }
        context();const result=commandResponse(session);if(key)receipts.set(key,result);return send(result);
      }
      if(path.endsWith('/snapshots')){frozen=structuredClone(session);Object.assign(saved,{sourceRevision:session.revision,revision:session.revision,sourceTick:session.primary.state.tick,tick:session.primary.state.tick,name:String(body.name)});if(key)receipts.set(key,saved);return send(saved);}
      if(path===`/demo/snapshots/${saved.snapshotId}/sessions`){
        session={...structuredClone(frozen??session),id:branchId,sessionId:branchId,revision:0,tick:saved.sourceTick,playbackPaused:true,incidents:[],branch:{branchId,snapshotId:saved.snapshotId,snapshotHash:saved.snapshotHash,sourceSessionId:saved.sourceSessionId,sourceRevision:saved.sourceRevision,sourceTick:saved.sourceTick,branchStartTick:saved.sourceTick,interventionRevision:0}};context();if(key)receipts.set(key,session);return send(session);
      }
      if(path.endsWith('/incidents')){
        session=structuredClone(session);session.revision++;
        const event={...injected(),machineIndex:2,componentIndex:1,scheduledTick:session.primary.state.tick,appliedTick:session.primary.state.tick,requestedReason:String(body.reason)};
        session.primary.state.components[2][1].failed=true;session.incidents=[event];context();return send({session,event});
      }
      if(path.endsWith('/commands')){
        session=structuredClone(session);session.revision++;session.primary.state.tick++;session.baseline.state.tick=session.primary.state.tick;session.tick=session.primary.state.tick;
        const calendar=session.technicianAvailability!;
        for(const interval of calendar.absences){if(interval.endedTick===null&&interval.returnTick<=session.tick){interval.endedTick=interval.returnTick;interval.endedByEventId=interval.automaticEndEventId;
          calendar.events.push({eventId:interval.automaticEndEventId,technicianIndex:interval.technicianIndex,type:'ABSENCE_ENDED',tick:interval.returnTick,actor:{type:'SYSTEM',userId:null},reason:'Absence interval elapsed'});session.technicians=workforce().technicians;}}
        if(session.incidents?.length&&session.technicians?.[0].availability==='ABSENT'){session.status='REVIEW';session.pending={tick:session.tick,action:[[2,1,1]],baseline_action:[],catalogue:[[],[[2,1,1]]]};}
        context();return send(session);
      }
      return error('UNEXPECTED_TEST_COMMAND',404);
    }
    if(path.endsWith('/technicians'))return send(commandResponse(session));
    if(path==='/demo/snapshots')return send({items:[saved],nextCursor:null});
    if(path===`/demo/snapshots/${saved.snapshotId}`)return send(saved);
    if(path.endsWith('/incidents'))return send({sessionId:session.id,revision:session.revision,tick:session.primary.state.tick,source:'JCST_SIMULATION',events:session.incidents??[]});
    if(path.includes('/health')||path.endsWith('/work-orders'))return error('COMPONENT_TEST_INSPECTION_UNAVAILABLE',503);
    if(path===`/demo/sessions/${session.id}`)return send(session);
    return error('UNEXPECTED_TEST_READ',404);
  });
  return {posts,current:()=>session,hold:()=>{hold=true;},release:()=>{hold=false;release?.();},fail:(code:string)=>{failure=code;},review:()=>{session.status='REVIEW';session.pending={tick:session.primary.state.tick,action:[[2,1,0]],baseline_action:[],catalogue:[[],[[2,1,0]]]};},busy:()=>{const fixture=technicianSession('BUSY');session={...fixture,context:{layoutId:'machining'}};}};
}
async function open(page:Page){await page.goto(`/simulation?session=${technicianSession().id}`);await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'Inspect technician T1',exact:true}).click();}
async function absence(page:Page){const panel=page.getByRole('complementary',{name:'Technician T1 details'});await panel.getByRole('button',{name:'Mark temporarily absent'}).click();await expect(panel.getByRole('button',{name:'Confirm temporary absence'})).toBeEnabled();return panel;}

test('component: pending, absence, reload, return now and focus',async({page},info)=>{
  const api=await harness(page);await open(page);const panel=await absence(page);
  await panel.getByRole('region',{name:'Availability change review'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-absence-review.png')});api.hold();await panel.getByRole('button',{name:'Confirm temporary absence'}).click();
  await expect(panel.getByRole('button',{name:'Updating availability…'})).toBeDisabled();await panel.getByRole('button',{name:'Updating availability…'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-pending.png')});api.release();
  await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();expect(api.current().primary.state.tick).toBe(5);await expect(page.getByText('Technicians free: 1')).toBeVisible();
  await panel.getByRole('button',{name:'Done',exact:true}).click();await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-absent.png')});
  const count=api.posts.length;await page.reload();expect(api.posts.length).toBe(count);await page.getByRole('button',{name:'Inspect technician T1',exact:true}).click();await expect(panel).toContainText('t8');
  await panel.getByRole('button',{name:'Return now',exact:true}).click();await panel.getByRole('button',{name:'Confirm return now'}).click();await expect(panel.getByText('AVAILABLE',{exact:true})).toBeVisible();
  expect(api.current().primary.state.tick).toBe(5);await expect(page.getByRole('region',{name:'Workforce activity'})).toContainText('Returned early');await panel.getByRole('button',{name:'Done'}).click();
  await page.screenshot({path:info.outputPath('component-returned.png')});await panel.getByRole('button',{name:'Close technician panel'}).click();await expect(page.getByRole('button',{name:'Inspect technician T1',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('component: review invalidation, immutable snapshot reopen and server expiry',async({page},info)=>{
  const api=await harness(page);api.review();await open(page);const panel=await absence(page);await panel.getByRole('button',{name:'Confirm temporary absence'}).click();await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();expect(api.current().pending).toBeNull();
  await panel.getByRole('button',{name:'Done'}).click();await panel.getByRole('button',{name:'Close technician panel'}).click();await page.getByRole('button',{name:'Save situation',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Situation name',exact:true}).fill('Absent workforce checkpoint');await dialog.getByRole('button',{name:'Save situation',exact:true}).click();await expect(dialog.getByText('Saved “Absent workforce checkpoint”')).toBeVisible();await dialog.getByRole('button',{name:'Close situation panel'}).click();
  await page.getByRole('button',{name:'Step',exact:true}).click();await page.getByRole('button',{name:'Saved situations',exact:true}).click();await dialog.getByRole('button',{name:/Absent workforce checkpoint.*t5/}).click();await dialog.getByRole('button',{name:'Open as new session'}).click();
  await expect(page).toHaveURL(new RegExp(`session=${branchId}`));await page.getByRole('button',{name:'Inspect technician T1',exact:true}).click();await expect(panel).toContainText('ABSENT');await expect(panel).toContainText('t8');await page.screenshot({path:info.outputPath('component-restored-absence.png')});
  await panel.getByRole('button',{name:'Close technician panel'}).click();for(let step=0;step<3;step++){await page.getByRole('button',{name:'Step',exact:true}).click();}
  await expect(page.getByText('Technicians free: 2')).toBeVisible();await expect(page.getByRole('region',{name:'Workforce activity'})).toContainText('Absence ended');expect(api.current().primary.state.tick).toBe(8);
  await page.getByRole('button',{name:'Inspect technician T1',exact:true}).click();await expect(panel.getByText('AVAILABLE',{exact:true})).toBeVisible();
});
test('component: stale re-review, unavailable and exact-key recovery',async({page},info)=>{
  const api=await harness(page);await open(page);const panel=await absence(page);api.fail('DEMO_STALE');await panel.getByRole('button',{name:'Confirm temporary absence'}).click();
  await expect(panel.getByRole('alert')).toContainText('session changed');await panel.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-stale.png')});await panel.getByRole('button',{name:'Refresh availability context',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Confirm temporary absence'})).toBeDisabled();await panel.getByRole('button',{name:'Confirm updated availability context'}).click();api.fail('TECHNICIAN_RUNTIME_UNAVAILABLE');await panel.getByRole('button',{name:'Confirm temporary absence'}).click();await expect(panel.getByRole('alert')).toContainText('runtime is not installed');
  await panel.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-unavailable.png')});const before=api.posts.at(-1);await panel.getByRole('button',{name:'Recover previous availability change'}).click();
  await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();expect(api.posts.at(-1)).toEqual(before);expect(api.posts).toHaveLength(3);
});
test('component: VIEWER cannot change availability',async({page})=>{
  const api=await harness(page,'VIEWER');await open(page);const panel=page.getByRole('complementary',{name:'Technician T1 details'});await expect(panel.getByRole('button',{name:'Mark temporarily absent'})).toBeDisabled();expect(api.posts).toHaveLength(0);
});
test('component: busy technician must finish the actual repair',async({page},info)=>{
  const api=await harness(page);api.busy();await open(page);await page.getByRole('button',{name:'Inspect technician T2',exact:true}).click();const panel=page.getByRole('complementary',{name:'Technician T2 details'});
  await expect(panel.getByText('BUSY',{exact:true})).toBeVisible();await expect(panel).toContainText('M3 / C2');await expect(panel).toContainText('15 min');await expect(panel.getByRole('button',{name:'Mark temporarily absent'})).toBeDisabled();expect(api.posts).toHaveLength(0);await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-busy.png')});
});
test('component: absence links to restored-session incident and the server eligible proposal',async({page},info)=>{
  const api=await harness(page);await open(page);const panel=await absence(page);await panel.getByRole('button',{name:'Confirm temporary absence'}).click();await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'Done'}).click();await panel.getByRole('button',{name:'Close technician panel'}).click();
  await page.getByRole('button',{name:'Save situation',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Situation name',exact:true}).fill('Incident workforce checkpoint');await dialog.getByRole('button',{name:'Save situation',exact:true}).click();await expect(dialog.getByText('Saved “Incident workforce checkpoint”')).toBeVisible();await dialog.getByRole('button',{name:'Close situation panel'}).click();
  await page.getByRole('button',{name:'Saved situations',exact:true}).click();await dialog.getByRole('button',{name:/Incident workforce checkpoint.*t5/}).click();await dialog.getByRole('button',{name:'Open as new session'}).click();await expect(page).toHaveURL(new RegExp(`session=${branchId}`));
  await page.getByRole('button',{name:'Inspect machine M3'}).click();await dialog.getByRole('button',{name:'Create incident',exact:true}).click();await dialog.getByRole('combobox',{name:'Incident component'}).selectOption('1');await dialog.getByRole('textbox',{name:'Incident note'}).fill('M3/C2 workforce exercise');await dialog.getByRole('button',{name:'Create injected incident'}).click();await expect(dialog.getByText('Injected incident · APPLIED',{exact:true}).first()).toBeVisible();
  await dialog.getByRole('button',{name:'Close machine details'}).click();await page.getByRole('button',{name:'Step',exact:true}).click();await page.getByRole('button',{name:'Review assignments',exact:true}).click();
  const decision=page.getByRole('heading',{name:'Recommended assignments'});await expect(decision).toBeVisible();await expect(page.getByText('T1: Technician absent', {exact:false})).toBeVisible();expect(api.current().pending?.action).toEqual([[2,1,1]]);
  await page.getByRole('heading',{name:'Recommended assignments'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-eligible-proposal.png')});
});
test('component: 3D absence label and panel',async({page},info)=>{
  test.skip(info.project.name==='mobile','Mobile interaction is covered in the 2D project; desktop exercises WebGL markers.');
  const api=await harness(page);await open(page);const panel=await absence(page);await panel.getByRole('button',{name:'Confirm temporary absence'}).click();await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Done'}).click();await panel.getByRole('button',{name:'Close technician panel'}).click();await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect(page.locator('.sim-tech-marker[data-availability="ABSENT"]')).toContainText('T1 · Absent');await page.getByRole('group',{name:'Technician availability'}).getByRole('button',{name:'Inspect technician T1',exact:true}).click();
  await expect(panel.getByText('ABSENT',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('component-3d-absent.png')});expect(api.current().primary.state.tick).toBe(5);
  await panel.getByRole('button',{name:'Return now',exact:true}).click();await expect(panel.getByRole('button',{name:'Confirm return now'})).toBeEnabled();await panel.getByRole('region',{name:'Availability change review'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('component-3d-return-review.png')});
});
