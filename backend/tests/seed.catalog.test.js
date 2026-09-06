const { BUILT_IN_POLICIES, main } = require('../prisma/seed');

describe('policy catalog seed', () => {
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  afterAll(() => {
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
  });

  test('defines a small catalog with stable unique key/version pairs', () => {
    const keys = BUILT_IN_POLICIES.map((policy) => `${policy.policyKey}:${policy.version}`);

    expect(BUILT_IN_POLICIES).toHaveLength(3);
    expect(new Set(keys).size).toBe(keys.length);
    expect(BUILT_IN_POLICIES).toEqual(expect.arrayContaining([
      expect.objectContaining({ policyKey: 'fixed-schedule', version: '1.0.0' }),
      expect.objectContaining({ policyKey: 'threshold-uncertainty', version: '1.0.0' }),
    ]));
  });

  test('upserts the administrator and every active policy idempotently', async () => {
    process.env.ADMIN_PASSWORD = 'test-only-admin-password';
    const client = {
      user: { upsert: jest.fn().mockResolvedValue({ username: 'admin' }) },
      policy: {
        upsert: jest.fn(async ({ create }) => ({ id: create.policyKey, ...create })),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue('hashed-password');
    const logger = { log: jest.fn() };

    await main({ client, hashPassword, logger });
    await main({ client, hashPassword, logger });

    expect(client.user.upsert).toHaveBeenCalledTimes(2);
    expect(client.policy.upsert).toHaveBeenCalledTimes(6);
    for (const call of client.policy.upsert.mock.calls) {
      expect(call[0]).toMatchObject({
        update: { active: true },
        create: { active: true },
      });
    }
  });

  test('refuses to seed an implicit default password', async () => {
    delete process.env.ADMIN_PASSWORD;

    await expect(main({
      client: {},
      hashPassword: jest.fn(),
      logger: { log: jest.fn() },
    })).rejects.toThrow('ADMIN_PASSWORD is required');
  });
});
