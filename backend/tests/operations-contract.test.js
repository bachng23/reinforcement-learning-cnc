const { contentHash } = require('../src/services/operations-contract.service');
const { authorizeFactory } = require('../src/services/operations-context.service');

test('content hashes ignore object key order, preserve array order and reject non-finite JSON', () => {
  expect(contentHash({ b: [1, 2], a: { z: 'hello', x: null } })).toBe(contentHash({ a: { x: null, z: 'hello' }, b: [1, 2] }));
  expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  expect(() => contentHash({ value: NaN })).toThrow();
  expect(() => contentHash({ value: Infinity })).toThrow();
});
test('factory access fails closed unless user ID is explicitly granted; admin may read all', () => {
  const previous = process.env.OPERATIONS_FACTORY_ACCESS;
  try {
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ factory1: ['viewer-id'] });
    expect(() => authorizeFactory({ id: 'viewer-id', role: 'VIEWER' }, 'factory1')).not.toThrow();
    expect(() => authorizeFactory({ id: 'other', role: 'ENGINEER' }, 'factory1')).toThrow('Factory was not found');
    expect(() => authorizeFactory({ id: 'viewer-id', role: 'VIEWER' }, 'factory2')).toThrow();
    expect(() => authorizeFactory({ id: 'admin', role: 'ADMIN' }, 'factory2')).not.toThrow();
  } finally { if (previous === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = previous; }
});
