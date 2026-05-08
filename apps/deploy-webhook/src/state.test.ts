import { ApiException } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { addObservation, type DeployState, StateStore } from "./state.js";

describe("addObservation", () => {
  it("adds observed packages once and keeps them sorted", () => {
    const state: DeployState = {
      observed: { "sha-abcdef1": ["z8-worker"] },
      deployed: { web: "sha-old" },
      failures: { "sha-old": "failed" }
    };

    expect(addObservation(state, { tag: "sha-abcdef1", packageName: "z8-webapp" })).toEqual({
      observed: { "sha-abcdef1": ["z8-webapp", "z8-worker"] },
      deployed: { web: "sha-old" },
      failures: { "sha-old": "failed" }
    });
    expect(addObservation(state, { tag: "sha-abcdef1", packageName: "z8-worker" }).observed["sha-abcdef1"]).toEqual([
      "z8-worker"
    ]);
  });
});

describe("StateStore", () => {
  it("retries recordObservation when replacing the ConfigMap conflicts", async () => {
    const states: DeployState[] = [
      { observed: { "sha-abcdef1": ["z8-worker"] }, deployed: {}, failures: {} },
      { observed: { "sha-abcdef1": ["z8-docs", "z8-worker"] }, deployed: {}, failures: {} }
    ];
    const written: DeployState[] = [];
    let readCount = 0;
    const coreApi = {
      readNamespacedConfigMap: vi.fn(async () => ({
        metadata: { resourceVersion: String(readCount + 1) },
        data: { "state.json": JSON.stringify(states[Math.min(readCount++, states.length - 1)]) }
      })),
      replaceNamespacedConfigMap: vi.fn(async ({ body }: { body: { data?: Record<string, string> } }) => {
        const state = JSON.parse(body.data?.["state.json"] ?? "{}") as DeployState;
        written.push(state);
        if (written.length === 1) throw new ApiException(409, "conflict", {}, {});
        return body;
      }),
      createNamespacedConfigMap: vi.fn()
    };

    const store = new StateStore({ namespace: "app-prod", name: "deploy-webhook-state", coreApi: coreApi as never });

    await expect(store.recordObservation({ tag: "sha-abcdef1", packageName: "z8-webapp" })).resolves.toEqual({
      observed: { "sha-abcdef1": ["z8-docs", "z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });

    expect(coreApi.replaceNamespacedConfigMap).toHaveBeenCalledTimes(2);
    expect(written).toEqual([
      { observed: { "sha-abcdef1": ["z8-webapp", "z8-worker"] }, deployed: {}, failures: {} },
      { observed: { "sha-abcdef1": ["z8-docs", "z8-webapp", "z8-worker"] }, deployed: {}, failures: {} }
    ]);
  });
});
