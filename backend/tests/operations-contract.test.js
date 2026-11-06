const { contentHash } = require('../src/services/operations-contract.service');
const { authorizeFactory } = require('../src/services/operations-context.service');

test('content hashes ignore object key order, preserve array order and reject non-finite JSON', () => {
  expect(contentHash({ b: [1, 2], a: { z: 'hello', x: null } })).toBe(contentHash({ a: { x: null, z: 'hello' }, b: [1, 2] }));
  expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  expect(() => contentHash({ value: NaN })).toThrow();
  expect(() => contentHash({ value: Infinity })).toThrow();
});
test('factory access async lookup fails closed and explicit environment mode respects DB role', async () => {
  const old=process.env.OPERATIONS_FACTORY_ACCESS;
  const viewer='11111111-1111-4111-8111-111111111111';
  const db={user:{findUnique:async ({where})=>({id:where.id,active:true,role:'VIEWER'})},factory:{findUnique:async()=>({factoryId:'factory1'})}};
  try {process.env.OPERATIONS_FACTORY_ACCESS=JSON.stringify({factory1:[viewer]});
    await expect(authorizeFactory(db,{id:viewer,role:'ADMIN'},'factory1')).resolves.toMatchObject({role:'VIEWER'});
    await expect(authorizeFactory(db,{id:viewer},'factory2')).rejects.toMatchObject({statusCode:404});
    db.user.findUnique=async()=>{throw Object.assign(new Error('private'),{code:'P1001'});};
    await expect(authorizeFactory(db,{id:viewer},'factory1')).rejects.toMatchObject({statusCode:503});
  }finally{if(old===undefined)delete process.env.OPERATIONS_FACTORY_ACCESS;else process.env.OPERATIONS_FACTORY_ACCESS=old;}
});
