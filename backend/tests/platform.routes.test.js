process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters';

const app = require('../src/app');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('exposes platform health and API identity', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const apiResponse = await fetch(`${baseUrl}/api/v1`);

  expect(healthResponse.status).toBe(200);
  await expect(healthResponse.json()).resolves.toEqual({
    status: 'OK',
    service: 'research-api',
  });
  expect(apiResponse.status).toBe(200);
  await expect(apiResponse.json()).resolves.toEqual({
    name: 'CNC Research Platform API',
    version: '1',
  });
});

test('returns 404 for an unknown domain route', async () => {
  const response = await fetch(`${baseUrl}/api/v1/assets`);

  expect(response.status).toBe(404);
});
