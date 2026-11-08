const { bridge } = require('../src/research/bridge');
test('runtime deadline aborts the child instead of returning partial output', async () => {
  await expect(bridge({operation:'capabilities'},{timeoutMs:1})).rejects.toMatchObject({code:'JCST_TIMEOUT'});
});
test('an already cancelled request cannot publish a runtime result', async () => {
  const controller=new AbortController();controller.abort();
  await expect(bridge({operation:'capabilities'},{signal:controller.signal})).rejects.toMatchObject({code:'RESEARCH_JOB_CANCELLED'});
});
test('runtime failures return a bounded public error rather than stderr or input', async () => {
  await expect(bridge({operation:'unsupported-private-payload'})).rejects.toMatchObject({code:'JCST_VALIDATION_FAILED',statusCode:422});
});
