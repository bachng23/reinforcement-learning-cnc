import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Simulation } from '@/lib/simulation/types';
import type { DemoWorkOrdersResponse } from '@/types/simulation-work-orders';

const sessions = 'http://127.0.0.1:5108/api/v1/research/demo/sessions';
const hasWorkOrders = existsSync('../backend/prisma/migrations/20261108000000_demo_work_order_projection/migration.sql');

async function readyForRepair(page: Page) {
  const send = async (url: string, data: object): Promise<Simulation> => {
    const response = await page.request.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } });
    await expect(response).toBeOK();
    return (await response.json()).data;
  };
  let session = await send(sessions, {
    case: 'base', seed: '990000001', mode: 'policy', primary: 'corrective', baseline: 'wait', continuous: true,
  });
  for (let i = 0; i < 12 && (session.primary.state.tick < 5 || session.status !== 'REVIEW'); i++) {
    const body = session.status === 'REVIEW'
      ? { command: 'approve', reason: 'Continue to the first repair proposal' }
      : { command: 'advance', autoApprove: false };
    session = await send(`${sessions}/${session.id}/commands`, { ...body, revision: session.revision });
  }
  expect(session.primary.state.tick).toBe(5);
  expect(session.pending?.action).toEqual([[2, 1, 1]]);
  return session;
}

test('authenticated simulator dispatch persists a work order through completion, reload and defer', async ({ page }) => {
  test.skip(!hasWorkOrders, 'Requires the simulator work-order backend migration in the checked-out tree.');
  await page.goto('/login');
  await page.getByLabel('Username').fill('jcst-browser');
  await page.getByLabel('Password', { exact: true }).fill('jcst-browser-test-password');
  const login = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: /sign in/i }).click();
  expect((await login).ok()).toBe(true);
  await expect(page).not.toHaveURL(/\/login$/);

  const openMachine = (session: Simulation) => page.goto(`/simulation?session=${session.id}&machine=2&inspect=1`);
  const session = await readyForRepair(page);
  await openMachine(session);
  const dialog = page.getByRole('dialog');
  const card = dialog.getByTestId('service-record');
  const review = dialog.getByRole('button', { name: 'View dispatch proposal' });
  await expect(dialog.getByText('Failure detected', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/No maintenance work recorded/)).toBeVisible();

  const commands: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url() === `${sessions}/${session.id}/commands`) {
      commands.push(request.postDataJSON());
    }
  });
  await review.click();
  await page.getByRole('button', { name: 'Approve & dispatch' }).click();
  await expect(card).toContainText('T2 · C2 · CM');
  await expect(card).toContainText('In progress');
  await expect(card).toContainText('15 min');
  await expect(card).toContainText('Manually approved');
  const workOrderId = await card.getAttribute('data-work-order-id');
  expect(workOrderId).toMatch(/^wo:je1_/);

  await review.click();
  await expect(card).toContainText('Completed');
  await expect(card).toContainText('t7');
  await expect(card).toHaveAttribute('data-work-order-id', workOrderId!);
  const ordersResponse = await page.request.get(`${sessions}/${session.id}/work-orders?machineIndex=2`);
  await expect(ordersResponse).toBeOK();
  const orders: DemoWorkOrdersResponse = await ordersResponse.json();
  expect(orders.data.items).toMatchObject([{ workOrderId, status: 'COMPLETED', completedTick: 7 }]);

  await page.reload();
  await expect(card).toHaveAttribute('data-work-order-id', workOrderId!);
  expect(commands).toEqual([
    expect.objectContaining({ command: 'approve', revision: session.revision }),
    expect.objectContaining({ command: 'advance', revision: session.revision + 1 }),
  ]);
  await dialog.getByRole('combobox', { name: 'Inspect machine', exact: true }).selectOption('0');
  await expect(card).toHaveCount(0);
  await expect(dialog.getByText(/No maintenance work recorded/)).toBeVisible();

  const deferred = await readyForRepair(page);
  await openMachine(deferred);
  await review.click();
  await page.getByRole('button', { name: 'Defer new assignments' }).click();
  await expect(dialog.getByText(/No maintenance work recorded/)).toBeVisible();
  const deferredOrders = await page.request.get(`${sessions}/${deferred.id}/work-orders?machineIndex=2`);
  await expect(deferredOrders).toBeOK();
  expect((await deferredOrders.json()).data).toMatchObject({ tick: 6, total: 0, items: [] });
});
