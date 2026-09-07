import type { ProductApiClient } from "@/types/product-api";

function notConfigured<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`Unexpected ProductApiClient.${method} call in test.`));
}

export function createProductApiStub(
  overrides: Partial<ProductApiClient> = {},
): ProductApiClient {
  return {
    listPolicies: () => notConfigured("listPolicies"),
    listExperiments: () => notConfigured("listExperiments"),
    createExperiment: () => notConfigured("createExperiment"),
    runExperiment: () => notConfigured("runExperiment"),
    getExperiment: () => notConfigured("getExperiment"),
    getEpisode: () => notConfigured("getEpisode"),
    retryEpisode: () => notConfigured("retryEpisode"),
    cancelEpisode: () => notConfigured("cancelEpisode"),
    ...overrides,
  };
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
