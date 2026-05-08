import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:http", () => ({
  createServer: vi.fn(() => ({ listen: vi.fn() }))
}));

vi.mock("./registry.js", () => ({ RegistryClient: vi.fn() }));
vi.mock("./kubernetes.js", () => ({ KubernetesAdapter: vi.fn() }));
vi.mock("./state.js", () => ({ StateStore: vi.fn() }));
vi.mock("./reconciler.js", () => ({ Reconciler: vi.fn() }));

describe("reconcileWithRetry", () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  });

  it("retries transient reconciliation failures", async () => {
    const { reconcileWithRetry } = (await import("./server.js")) as {
      reconcileWithRetry: (
        reconcile: () => Promise<void>,
        options: { attempts: number; delayMs: number; sleep: (delayMs: number) => Promise<void> }
      ) => Promise<void>;
    };
    const reconcile = vi.fn(async () => {
      if (reconcile.mock.calls.length < 3) throw new Error("transient failure");
    });
    const sleep = vi.fn(async () => {});

    await reconcileWithRetry(reconcile, { attempts: 3, delayMs: 5, sleep });

    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });
});
