import { test, expect, type Page } from '@playwright/test';
import { healthAt, simulationAt } from '../simulation-inspection-fixtures';

async function componentApi(page:Page) {
  let snapshot=simulationAt(5);let readError=0;const commands:unknown[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(); const url=new URL(request.url());
    const headers={'access-control-allow-origin':'http://127.0.0.1:3114','access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Idempotency-Key'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const fulfill=(data:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/api/v1/auth/me')return fulfill({success:true,user:{id:'component-operator',username:'Operator',role:'ADMIN'}});
    if(url.pathname.endsWith('/capabilities'))return fulfill({success:true,data:{learned_releases:[]}});
    if(url.pathname.includes('/health')) {
      if(readError)return fulfill({success:false,error:{code:'DB_UNAVAILABLE',message:'Unavailable'}},readError);
      if(url.pathname.includes('/machines/0/'))return fulfill({success:false,error:{code:'DEMO_MACHINE_NOT_FOUND',message:'No fixture for M1'}},404);
      return fulfill({success:true,data:healthAt(snapshot.primary.state.tick as 5|6|7)});
    }
    if(url.pathname.endsWith('/commands')) {
      commands.push(request.postDataJSON());snapshot=simulationAt(snapshot.primary.state.tick===5?6:7);
    }
    return fulfill({success:true,data:snapshot});
  });
  return { commands, error:(status:number)=>{readError=status;} };
}

test('fixture browser evidence: inspect → approve → t6 → t7 → reload; desktop/narrow',async({page},info)=>{
  const api=await componentApi(page);const id=simulationAt(5).id;
  await page.goto(`/simulation?session=${id}&machine=2&inspect=1`);
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'Component health'})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Component',exact:true})).toHaveValue('1');
  await expect(dialog.getByText('Failure detected',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('component-only-t5.png'),fullPage:false});
  await dialog.getByRole('button',{name:'View dispatch proposal'}).click();
  await page.getByRole('button',{name:'Approve & dispatch'}).click();
  await expect(dialog.getByText('In progress',{exact:true})).toBeVisible();
  await dialog.getByRole('heading',{name:'Maintenance work and history'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('component-only-t6.png'),fullPage:false});
  await dialog.getByRole('button',{name:'View dispatch proposal'}).click();
  await page.getByRole('button',{name:'Approve & dispatch'}).click();
  await expect(dialog.getByTestId('service-record').locator('header').getByText('Completed',{exact:true})).toBeVisible();
  const identity=await dialog.getByTestId('service-record').getAttribute('data-evidence-id');
  await page.screenshot({path:info.outputPath('component-only-t7-health.png'),fullPage:false});
  await dialog.getByRole('heading',{name:'Maintenance work and history'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('component-only-t7.png'),fullPage:false});
  expect(api.commands).toHaveLength(2); await page.reload();
  await expect(page.getByTestId('service-record')).toHaveAttribute('data-evidence-id',identity!);
  expect(api.commands).toHaveLength(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Close machine details'}).focus();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('fixture browser evidence: unavailable, retry and no cross-machine fallback',async({page},info)=>{
  const api=await componentApi(page);api.error(503);
  await page.goto(`/simulation?session=${simulationAt(5).id}&machine=2&inspect=1`);
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('unavailable');
  await page.screenshot({path:info.outputPath('component-only-error.png'),fullPage:false});
  api.error(0);await dialog.getByRole('button',{name:'Retry machine history'}).click();
  await expect(dialog.getByRole('heading',{name:'Component health'})).toBeVisible();
  await dialog.getByRole('combobox',{name:'Inspect machine',exact:true}).selectOption('0');
  await expect(dialog.getByRole('heading',{name:'Component health'})).not.toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('not available');
  expect(api.commands).toHaveLength(0);
});
