import {test, expect} from '@playwright/test';
import type {Simulation} from '../../lib/simulation/types';
import type {DemoObservationRead} from '../../types/generated/demo-read';
test.use({video: 'on', viewport: {width: 1440, height: 900}});

test('real learned-policy factory flow: failure, inspection, review, CM, reload and completion', async ({page}, info) => {
  test.skip(!process.env.JCST_RELEASE_REGISTRY, 'INTEGRATION_PENDING: supply actual registered S/F checkpoints; API examples are not acceptance.');
  test.setTimeout(360000);
  const commands: {url: string; body: string | null}[] = [];
  page.on('request', request => {if (request.method() === 'POST' && request.url().includes('/demo/sessions')) commands.push({url: request.url(), body: request.postData()});});
  await page.goto('/login'); await page.getByLabel('Username').fill('jcst-browser'); await page.getByLabel('Password', {exact: true}).fill('jcst-browser-test-password');
  await page.getByRole('button', {name: /sign in/i}).click(); await page.goto('/overview');
  await expect(page.getByRole('button', {name: 'Create simulation'})).toBeEnabled({timeout: 30000});
  const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/demo/sessions'));
  await page.getByRole('button', {name: 'Create simulation'}).click();
  const creation = await created; expect(creation.status()).toBe(201); const session = (await creation.json()).data as Simulation;
  const read = async() => {
    const result = await page.request.get(`http://127.0.0.1:5108/api/v1/research/demo/sessions/${session.id}`); expect(result.ok()).toBe(true); return (await result.json()).data as Simulation;
  };
  const observe = async() => {
    const current = await read(); const response = await page.request.get(`http://127.0.0.1:5108/api/v1/research/demo/sessions/${session.id}/observation?expectedRevision=${current.revision}`);
    expect(response.ok()).toBe(true); return (await response.json()).data as DemoObservationRead;
  };
  await page.getByLabel('Simulation speed').selectOption('200');
  await page.getByRole('button', {name: 'Run simulator', exact: true}).click();
  await expect(page.locator('.sim-clock')).toContainText(/Paused|Awaiting decision/, {timeout: 60000});
  const failure = (await observe()).incidents.find(incident => incident.status === 'OPEN'); expect(failure).toBeDefined();
  await page.getByRole('button', {name: `Inspect incident ${failure!.machineId}/${failure!.componentId} at tick ${failure!.openedAtTick}`}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  if ((await read()).status === 'RUNNING') await page.getByRole('button', {name: 'Request policy proposal / step'}).click();
  await expect(page.getByRole('link', {name: 'Review full matching'})).toBeVisible({timeout: 30000});
  const beforeReload = commands.length; await page.reload(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(1200); expect(commands).toHaveLength(beforeReload); expect((await read()).status).toBe('REVIEW');
  await page.getByRole('link', {name: 'Review full matching'}).click();
  await expect(page.getByText('Registered policy S recommends')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({path: info.outputPath('real-policy-review.png')});
  await page.getByRole('button', {name: 'Approve & dispatch'}).click(); await expect(page).toHaveURL(/\/overview\?session=/);
  await expect(page.getByRole('button', {name: 'Run simulator'})).toBeEnabled({timeout: 30000});
  let state = await read();
  for (let step = 0; step < 12 && !(await observe()).incidents.find(incident => incident.incidentId === failure!.incidentId && incident.status === 'RESOLVED'); step++) {
    expect(state.status).toBe('RUNNING'); const previous = state.revision;
    await page.getByRole('button', {name: 'Step', exact: true}).click();
    await expect.poll(async() => (await read()).revision, {timeout: 30000}).toBeGreaterThan(previous); state = await read();
  }
  const repaired = await observe(); expect(repaired.incidents.find(incident => incident.incidentId === failure!.incidentId)?.status).toBe('RESOLVED');
  for (const incident of repaired.incidents.filter(item => item.status !== 'RESOLVED')) {
    await expect(page.getByRole('button', {name: `Inspect incident ${incident.machineId}/${incident.componentId} at tick ${incident.openedAtTick}`})).toBeVisible();
  }
  const repairWrites = commands.length; await page.reload(); await page.waitForTimeout(1200); expect(commands).toHaveLength(repairWrites);
  await expect(page.getByRole('button', {name: 'Run simulator'})).toBeEnabled({timeout: 30000});
  await page.screenshot({path: info.outputPath('real-repaired-factory.png')});
  await page.getByLabel('Auto-approve future policy decisions').check(); await page.getByLabel('Pause on new failure').uncheck();
  await page.getByRole('button', {name: 'Run simulator'}).click();
  await expect(page.locator('.sim-clock')).toContainText('Episode complete', {timeout: 240000});
  const completed = await read(); expect(completed.status).toBe('COMPLETE'); expect(completed.audits?.primary.status).toBe('PASS');
  expect(completed.audits?.baseline.status).toBe('PASS');
  expect((await observe()).incidents.some(incident => incident.machineId !== failure!.machineId)).toBe(true);
  await page.screenshot({path: info.outputPath('real-completed-factory.png')});
  const finalWrites = commands.length; await page.reload(); await page.waitForTimeout(1200); expect(commands).toHaveLength(finalWrites);
});
