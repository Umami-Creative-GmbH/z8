import { ApiException } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { addObservation, type DeployState, StateStore } from "./state.js";

describe("addObservation", () => {
  it("adds observed packages once and keeps them sorted", () => {
    const state: DeployState = {
      observed: { "sha-abcdef1": ["z8-worker"] },
      observedAt: {},
      deployed: { web: "sha-old" },
      deployedAt: {},
      latestAcceptedAt: {},
      failures: { "sha-old": "failed" }
    };

    expect(addObservation(state, { tag: "sha-abcdef1", packageName: "z8-webapp", publishedAt: "2026-05-08T10:00:00.000Z" })).toEqual({
      observed: { "sha-abcdef1": ["z8-webapp", "z8-worker"] },
      observedAt: { "sha-abcdef1": { "z8-webapp": "2026-05-08T10:00:00.000Z" } },
      deployed: { web: "sha-old" },
      deployedAt: {},
      failures: { "sha-old": "failed" },
      latestAcceptedAt: { app: "2026-05-08T10:00:00.000Z" }
    });
    expect(addObservation(state, { tag: "sha-abcdef1", packageName: "z8-worker", publishedAt: "2026-05-08T10:01:00.000Z" }).observed["sha-abcdef1"]).toEqual([
      "z8-worker"
    ]);
  });
});

describe("StateStore", () => {
  it("retries updates on conflicts and preserves concurrent deployed markers", async () => {
    let stored: { resourceVersion: string; state: DeployState } = {
      resourceVersion: "1",
      state: { observed: {}, observedAt: {}, deployed: { docs: "sha-docs" }, deployedAt: {}, failures: {}, latestAcceptedAt: {} }
    };
    let injectedConcurrentUpdate = false;
    const coreApi = {
      readNamespacedConfigMap: vi.fn(async () => ({
        metadata: { resourceVersion: stored.resourceVersion },
        data: { "state.json": JSON.stringify(stored.state) }
      })),
      replaceNamespacedConfigMap: vi.fn(async ({ body }: { body: { metadata?: { resourceVersion?: string }; data?: Record<string, string> } }) => {
        if (!injectedConcurrentUpdate) {
          injectedConcurrentUpdate = true;
          stored = {
            resourceVersion: "2",
            state: {
              observed: {},
              observedAt: {},
              deployed: { docs: "sha-docs", marketing: "sha-marketing" },
              deployedAt: {},
              failures: {},
              latestAcceptedAt: {}
            }
          };
        }

        if (body.metadata?.resourceVersion !== stored.resourceVersion) {
          throw new ApiException(409, "conflict", {}, {});
        }

        stored = {
          resourceVersion: String(Number(stored.resourceVersion) + 1),
          state: JSON.parse(body.data?.["state.json"] ?? "{}") as DeployState
        };
        return body;
      }),
      createNamespacedConfigMap: vi.fn()
    };

    const store = new StateStore({ namespace: "app-prod", name: "deploy-webhook-state", coreApi: coreApi as never });

    await expect(
      store.update((state) => ({ ...state, deployed: { ...state.deployed, app: "sha-app" } }))
    ).resolves.toEqual({
      observed: {},
      observedAt: {},
      deployed: { app: "sha-app", docs: "sha-docs", marketing: "sha-marketing" },
      deployedAt: {},
      latestAcceptedAt: {},
      failures: {}
    });
    expect(coreApi.replaceNamespacedConfigMap).toHaveBeenCalledTimes(2);
    expect(stored.state.deployed).toEqual({ app: "sha-app", docs: "sha-docs", marketing: "sha-marketing" });
  });

  it("uses the same resourceVersion as the observed state when recording observations", async () => {
    let stored: { resourceVersion: string; state: DeployState } = {
      resourceVersion: "1",
      state: {
        observed: { "sha-abcdef1": ["z8-worker"] },
        observedAt: {},
        deployed: {},
        deployedAt: {},
        failures: {},
        latestAcceptedAt: {}
      }
    };
    let readCount = 0;
    let injectedConcurrentUpdate = false;
    const injectConcurrentUpdate = () => {
      injectedConcurrentUpdate = true;
      stored = {
        resourceVersion: "2",
        state: {
          observed: { "sha-abcdef1": ["z8-docs", "z8-worker"] },
          observedAt: {},
          deployed: {},
          deployedAt: {},
          failures: {},
          latestAcceptedAt: {}
        }
      };
    };
    const coreApi = {
      readNamespacedConfigMap: vi.fn(async () => {
        readCount += 1;
        if (readCount === 2 && !injectedConcurrentUpdate) injectConcurrentUpdate();

        return {
          metadata: { resourceVersion: stored.resourceVersion },
          data: { "state.json": JSON.stringify(stored.state) }
        };
      }),
      replaceNamespacedConfigMap: vi.fn(async ({ body }: { body: { metadata?: { resourceVersion?: string }; data?: Record<string, string> } }) => {
        if (!injectedConcurrentUpdate) injectConcurrentUpdate();

        if (body.metadata?.resourceVersion !== stored.resourceVersion) {
          throw new ApiException(409, "conflict", {}, {});
        }

        const state = JSON.parse(body.data?.["state.json"] ?? "{}") as DeployState;
        stored = { resourceVersion: String(Number(stored.resourceVersion) + 1), state };
        return body;
      }),
      createNamespacedConfigMap: vi.fn()
    };

    const store = new StateStore({ namespace: "app-prod", name: "deploy-webhook-state", coreApi: coreApi as never });

    await expect(store.recordObservation({ tag: "sha-abcdef1", packageName: "z8-webapp", publishedAt: "2026-05-08T10:00:00.000Z" })).resolves.toEqual({
      observed: { "sha-abcdef1": ["z8-docs", "z8-webapp", "z8-worker"] },
      observedAt: { "sha-abcdef1": { "z8-webapp": "2026-05-08T10:00:00.000Z" } },
      deployed: {},
      deployedAt: {},
      latestAcceptedAt: { app: "2026-05-08T10:00:00.000Z" },
      failures: {}
    });

    expect(coreApi.replaceNamespacedConfigMap).toHaveBeenCalledTimes(2);
    expect(stored.state).toEqual({
      observed: { "sha-abcdef1": ["z8-docs", "z8-webapp", "z8-worker"] },
      observedAt: { "sha-abcdef1": { "z8-webapp": "2026-05-08T10:00:00.000Z" } },
      deployed: {},
      deployedAt: {},
      latestAcceptedAt: { app: "2026-05-08T10:00:00.000Z" },
      failures: {}
    });
  });
});
