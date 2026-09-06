process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters';

jest.mock('../src/config/prisma', () => ({
  episode: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
}));

const prisma = require('../src/config/prisma');
const {
  claimNextPendingEpisode,
  transitionEpisode,
} = require('../src/services/episode-lifecycle.service');

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-02T10:00:00.000Z');

const arrangeSuccessfulTransition = (status) => {
  const episode = { id: EPISODE_ID, status };
  prisma.episode.updateMany.mockResolvedValue({ count: 1 });
  prisma.episode.findUnique.mockResolvedValue(episode);
  return episode;
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('transitionEpisode', () => {
  test.each([
    {
      label: 'PENDING -> RUNNING',
      from: 'PENDING',
      to: 'RUNNING',
      expectedData: {
        status: 'RUNNING',
        startedAt: NOW,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        errorCode: null,
        errorMessage: null,
      },
    },
    {
      label: 'RUNNING -> COMPLETED',
      from: 'RUNNING',
      to: 'COMPLETED',
      expectedData: {
        status: 'COMPLETED',
        completedAt: NOW,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    },
    {
      label: 'RUNNING -> FAILED',
      from: 'RUNNING',
      to: 'FAILED',
      expectedData: {
        status: 'FAILED',
        failedAt: NOW,
        completedAt: null,
        errorCode: 'ENGINE_ERROR',
        errorMessage: 'Episode execution failed',
      },
    },
    {
      label: 'PENDING -> CANCELLED',
      from: 'PENDING',
      to: 'CANCELLED',
      expectedData: {
        status: 'CANCELLED',
        cancelledAt: NOW,
        completedAt: null,
      },
    },
  ])('performs valid transition $label atomically', async ({ from, to, expectedData }) => {
    const storedEpisode = arrangeSuccessfulTransition(to);

    await expect(transitionEpisode({
      episodeId: EPISODE_ID,
      from,
      to,
      now: NOW,
    })).resolves.toBe(storedEpisode);

    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: EPISODE_ID, status: from },
      data: expectedData,
    });
    expect(prisma.episode.findUnique).toHaveBeenCalledWith({
      where: { id: EPISODE_ID },
    });
  });

  test('preserves a supplied safe engine error on RUNNING -> FAILED', async () => {
    arrangeSuccessfulTransition('FAILED');

    await transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'RUNNING',
      to: 'FAILED',
      errorCode: 'SIMULATION_TIMEOUT',
      errorMessage: 'Simulation timed out',
      now: NOW,
    });

    expect(prisma.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        errorCode: 'SIMULATION_TIMEOUT',
        errorMessage: 'Simulation timed out',
      }),
    }));
  });

  test('retries FAILED -> PENDING by incrementing attempt and resetting result state', async () => {
    arrangeSuccessfulTransition('PENDING');

    await transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'FAILED',
      to: 'PENDING',
      now: NOW,
    });

    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: EPISODE_ID, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempt: { increment: 1 },
        queuedAt: NOW,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        errorCode: null,
        errorMessage: null,
        stepsCompleted: 0,
        totalCost: null,
        failureCount: null,
        replacementCount: null,
        waitingSteps: null,
      },
    });
  });

  test('allows RUNNING -> CANCELLED only when worker cancellation is explicitly supported', async () => {
    arrangeSuccessfulTransition('CANCELLED');

    await transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'RUNNING',
      to: 'CANCELLED',
      allowRunningCancellation: true,
      now: NOW,
    });

    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: EPISODE_ID, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        cancelledAt: NOW,
        completedAt: null,
      },
    });
  });

  test('rejects RUNNING -> CANCELLED when worker cancellation is unsupported', async () => {
    await expect(transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'RUNNING',
      to: 'CANCELLED',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RUNNING_CANCELLATION_UNSUPPORTED',
    });

    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
  });

  test.each([
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'FAILED'],
    ['RUNNING', 'PENDING'],
    ['COMPLETED', 'RUNNING'],
    ['CANCELLED', 'PENDING'],
  ])('rejects invalid transition %s -> %s before accessing the database', async (from, to) => {
    await expect(transitionEpisode({
      episodeId: EPISODE_ID,
      from,
      to,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_EPISODE_TRANSITION',
    });

    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
  });

  test('rejects an atomic transition race when another actor already changed status', async () => {
    prisma.episode.updateMany.mockResolvedValue({ count: 0 });
    prisma.episode.findUnique.mockResolvedValue({ id: EPISODE_ID, status: 'RUNNING' });

    await expect(transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'PENDING',
      to: 'RUNNING',
      now: NOW,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_EPISODE_TRANSITION',
      message: 'Episode is RUNNING; expected PENDING',
    });

    expect(prisma.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: EPISODE_ID, status: 'PENDING' },
    }));
  });

  test('returns EPISODE_NOT_FOUND when the conditional transition finds no episode', async () => {
    prisma.episode.updateMany.mockResolvedValue({ count: 0 });
    prisma.episode.findUnique.mockResolvedValue(null);

    await expect(transitionEpisode({
      episodeId: EPISODE_ID,
      from: 'PENDING',
      to: 'RUNNING',
    })).rejects.toMatchObject({
      statusCode: 404,
      code: 'EPISODE_NOT_FOUND',
    });
  });
});

describe('claimNextPendingEpisode', () => {
  test('claims the oldest pending candidate with a conditional status update', async () => {
    const claimedEpisode = { id: 'episode-1', status: 'RUNNING' };
    prisma.episode.findMany.mockResolvedValue([{ id: 'episode-1' }]);
    prisma.episode.updateMany.mockResolvedValue({ count: 1 });
    prisma.episode.findUnique.mockResolvedValue(claimedEpisode);

    await expect(claimNextPendingEpisode({ candidateLimit: 5 })).resolves.toBe(claimedEpisode);

    expect(prisma.episode.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      select: { id: true },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'episode-1', status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: expect.any(Date) },
    });
  });

  test('skips a candidate lost to another worker and claims the next one', async () => {
    const claimedEpisode = { id: 'episode-2', status: 'RUNNING' };
    prisma.episode.findMany.mockResolvedValue([
      { id: 'episode-1' },
      { id: 'episode-2' },
    ]);
    prisma.episode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.episode.findUnique.mockResolvedValue(claimedEpisode);

    await expect(claimNextPendingEpisode()).resolves.toBe(claimedEpisode);

    expect(prisma.episode.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'episode-1', status: 'PENDING' },
    }));
    expect(prisma.episode.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'episode-2', status: 'PENDING' },
    }));
    expect(prisma.episode.findUnique).toHaveBeenCalledWith({ where: { id: 'episode-2' } });
  });

  test('allows only one winner when two workers compete for the same candidate', async () => {
    let pending = true;
    const claimedEpisode = { id: 'episode-1', status: 'RUNNING' };
    prisma.episode.findMany.mockResolvedValue([{ id: 'episode-1' }]);
    prisma.episode.updateMany.mockImplementation(async () => {
      if (!pending) return { count: 0 };
      pending = false;
      return { count: 1 };
    });
    prisma.episode.findUnique.mockResolvedValue(claimedEpisode);

    const results = await Promise.all([
      claimNextPendingEpisode(),
      claimNextPendingEpisode(),
    ]);

    expect(results.filter(Boolean)).toEqual([claimedEpisode]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(prisma.episode.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.episode.findUnique).toHaveBeenCalledTimes(1);
  });

  test('returns null when there are no pending candidates', async () => {
    prisma.episode.findMany.mockResolvedValue([]);

    await expect(claimNextPendingEpisode()).resolves.toBeNull();
    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
    expect(prisma.episode.findUnique).not.toHaveBeenCalled();
  });

  test('returns null when every candidate was claimed by competitors', async () => {
    prisma.episode.findMany.mockResolvedValue([
      { id: 'episode-1' },
      { id: 'episode-2' },
    ]);
    prisma.episode.updateMany.mockResolvedValue({ count: 0 });

    await expect(claimNextPendingEpisode()).resolves.toBeNull();
    expect(prisma.episode.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.episode.findUnique).not.toHaveBeenCalled();
  });
});
