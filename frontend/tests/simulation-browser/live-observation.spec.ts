import {test, expect} from '@playwright/test';
import {simulation, observation, machineRead, incidentRead, capabilities, incidents} from '../live-simulation-fixtures';

// API examples only: these tests prove layout/interaction, NOT learned-runtime acceptance.
test('component evidence: factory, incident, timeline, reload and keyboard at desktop sizes', async ({page}, info) => {
  const session = simulation(); let writes = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({json: {success: true, user: {id: 'engineer', username: 'component-review', role: 'ENGINEER'}}});
    if (route.request().method() === 'POST') {writes++; return route.fulfill({status: 409, json: {success: false, error: {code: 'DEMO_STALE', message: 'Component evidence is read-only'}}});}
    if (url.pathname.endsWith('/capabilities')) return route.fulfill({json: {success: true, data: capabilities}});
    let data: unknown = session;
    if (url.pathname.endsWith('/observation')) data = observation(session);
    if (url.pathname.includes('/machines/')) data = machineRead(url.pathname.split('/machines/')[1], session);
    if (url.pathname.includes('/incidents/')) data = incidentRead(decodeURIComponent(url.pathname.split('/incidents/')[1]), session);
    return route.fulfill({json: {success: true, data}});
  });
  await page.goto(`/overview?session=${session.id}`);
  await expect(page.getByRole('button', {name: 'Inspect machine M3', exact: true})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Incident center'})).toBeVisible();
  const bounds = await page.getByRole('button', {name: 'Inspect machine M3', exact: true}).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(info.project.use.viewport!.height);
  await page.screenshot({path: info.outputPath('component-only-factory.png')});
  await page.getByRole('button', {name: 'Inspect machine M3', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('DEMO-PH-001 · Pump housing')).toBeVisible();
  await page.screenshot({path: info.outputPath('component-only-machine-profile.png')});
  await page.getByRole('button', {name: /C2 · failure tick 5 · Resolved/}).click();
  await expect(page.getByText('Completion · tick 7', {exact: true})).toBeVisible();
  await page.getByText('Completion · tick 7', {exact: true}).scrollIntoViewIfNeeded();
  await page.screenshot({path: info.outputPath('component-only-machine-timeline.png')});
  await page.reload(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('Failure · tick 5', {exact: true})).toBeVisible(); expect(writes).toBe(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Incident status').selectOption('RESOLVED');
  await expect(page.getByRole('button', {name: `Inspect incident M3/C2 at tick 5`})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', {name: 'Decision Center', exact: true}).last().click();
  await expect(page.getByText('Registered policy S recommends')).toBeVisible(); await page.screenshot({path: info.outputPath('component-only-decision.png')});
  expect(writes).toBe(0);
});

test('component evidence: unavailable and missing context never show the old hardcoded profile', async ({page}, info) => {
  const session = simulation(); let unavailable = true;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({json: {success: true, user: {id: 'engineer', role: 'ENGINEER'}}});
    if (url.pathname.endsWith('/capabilities')) return route.fulfill({json: {success: true, data: capabilities}});
    if (url.pathname.endsWith('/observation')) {
      if (unavailable) return route.fulfill({status: 503, json: {success: false, error: {code: 'DB_UNAVAILABLE', message: 'Unavailable'}}});
      return route.fulfill({json: {success: true, data: {...observation(session), context: null, contextStatus: 'MISSING_LEGACY', contextVersion: null, contextOrigin: null}}});
    }
    return route.fulfill({json: {success: true, data: session}});
  });
  await page.goto(`/overview?session=${session.id}`);
  await expect(page.getByText(/Simulation service unavailable/)).toBeVisible();
  await expect(page.getByText('CNC turning center', {exact: true})).toHaveCount(0);
  await page.screenshot({path: info.outputPath('component-only-error.png')});
  unavailable = false; await page.getByRole('button', {name: 'Retry observation'}).click();
  await expect(page.getByLabel('Machine list', {exact: true})).toBeVisible();
  await expect(page.getByText('CNC turning center', {exact: true})).toHaveCount(0);
  await page.screenshot({path: info.outputPath('component-only-missing-context.png')});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', {name: 'Run simulator'})).toBeVisible();
});
