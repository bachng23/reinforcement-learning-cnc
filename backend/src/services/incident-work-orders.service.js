const { ApiError } = require('../lib/api-error');
const { lookupWorkOrderSummaries } = require('./work-order-read.service');

const unavailable = () => new ApiError(503, 'INCIDENT_LINK_TARGET_UNAVAILABLE', 'Linked work orders could not be verified');

// The write caller holds the shared factory lock, ordered user locks and the
// incident lock. Work Order commands use the same factory lock. Lock targets in
// stable order too; never open a separate transaction for a lifecycle check.
async function linkedWorkOrders(tx, user, factoryId, ids, { lock = false } = {}) {
  if (!ids.length) return [];
  const unique = [...new Set(ids)].sort();
  if (unique.length > 50) throw unavailable();
  if (lock) {
    for (const id of unique) {
      await tx.$queryRaw`SELECT id FROM work_orders WHERE factory_id=${factoryId} AND id=${id}::uuid FOR SHARE`;
    }
  }
  let response;
  try {
    response = await lookupWorkOrderSummaries(tx, user, { factory_id: factoryId, ids: unique });
  } catch (error) {
    if ([404, 503].includes(error.statusCode)) throw unavailable();
    throw error;
  }
  // Do not manufacture terminal states when the producer cannot supply a target.
  if (!response.success || !Array.isArray(response.data) || response.data.length !== unique.length) throw unavailable();
  const byId = new Map(response.data.map(order => [order.id, order]));
  if (byId.size !== unique.length || unique.some(id => !byId.has(id))
    || response.data.some(order => order.factory_id !== factoryId)) throw unavailable();
  return ids.map(id => ({ ...byId.get(id), availability: 'available' }));
}

module.exports = { linkedWorkOrders };
