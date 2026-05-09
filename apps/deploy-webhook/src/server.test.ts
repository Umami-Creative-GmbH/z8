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

describe("validateWebhookHeaders", () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  });

  it("rejects requests without a GitHub package event header before body parsing", async () => {
    const { validateWebhookHeaders } = await import("./server.js");

    expect(validateWebhookHeaders({ "x-hub-signature-256": "sha256=abc" })).toEqual({
      body: "unsupported event",
      ok: false,
      statusCode: 400
    });
  });

  it("rejects requests without a signature before body parsing", async () => {
    const { validateWebhookHeaders } = await import("./server.js");

    expect(validateWebhookHeaders({ "x-github-event": "package" })).toEqual({
      body: "missing signature",
      ok: false,
      statusCode: 401
    });
  });

  it("accepts package events with signature and delivery identifiers", async () => {
    const { validateWebhookHeaders } = await import("./server.js");

    expect(
      validateWebhookHeaders({
        "x-github-delivery": "delivery-1",
        "x-github-event": "package",
        "x-hub-signature-256": "sha256=abc"
      })
    ).toEqual({ deliveryId: "delivery-1", ok: true, signatureHeader: "sha256=abc" });
  });
});
