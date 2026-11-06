jest.mock('../src/services/work-order-read.service', () => ({ lookupWorkOrderSummaries: jest.fn() }));
const { lookupWorkOrderSummaries: lookup } = require('../src/services/work-order-read.service');
const { linkedWorkOrders } = require('../src/services/incident-work-orders.service');
const tx = { $queryRaw: jest.fn() };
const actor = { id: 'actor' };
beforeEach(() => jest.clearAllMocks());
test('empty links do not call the producer', async () => {
  expect(await linkedWorkOrders(tx, actor, 'factory', [])).toEqual([]);
  expect(lookup).not.toHaveBeenCalled();
});
test('uses the same transaction, bounded ordered locks and preserves producer statuses', async () => {
  lookup.mockResolvedValue({ success: true, data: [
    { id: 'a', factory_id: 'factory', status: 'COMPLETED' },
    { id: 'b', factory_id: 'factory', status: 'CLOSED' },
  ] });
  const result = await linkedWorkOrders(tx, actor, 'factory', ['b', 'a'], { lock: true });
  expect(tx.$queryRaw.mock.calls.map(call => call.slice(1))).toEqual([['factory', 'a'], ['factory', 'b']]);
  expect(lookup).toHaveBeenCalledWith(tx, actor, { factory_id: 'factory', ids: ['a', 'b'] });
  expect(result.map(row => [row.id, row.status, row.availability])).toEqual([
    ['b', 'CLOSED', 'available'], ['a', 'COMPLETED', 'available'],
  ]);
});
test.each([404, 503])('producer %i fails closed', async statusCode => {
  lookup.mockRejectedValue({ statusCode });
  await expect(linkedWorkOrders(tx, actor, 'factory', ['a'])).rejects.toMatchObject({
    statusCode: 503, code: 'INCIDENT_LINK_TARGET_UNAVAILABLE',
  });
});
test('fresh authorization failures are not hidden', async () => {
  lookup.mockRejectedValue({ statusCode: 401 });
  await expect(linkedWorkOrders(tx, actor, 'factory', ['a'])).rejects.toMatchObject({ statusCode: 401 });
});
test.each([
  { success: true, data: [] },
  { success: true, data: [{ id: 'other', factory_id: 'factory' }] },
  { success: true, data: [{ id: 'a', factory_id: 'other' }] },
])('rejects missing or cross-scope producer data', async response => {
  lookup.mockResolvedValue(response);
  await expect(linkedWorkOrders(tx, actor, 'factory', ['a'])).rejects.toMatchObject({ code: 'INCIDENT_LINK_TARGET_UNAVAILABLE' });
});
