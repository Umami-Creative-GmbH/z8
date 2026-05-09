import { describe, expect, it, vi } from "vitest";
import { Reconciler, type ReconcilerDependencies } from "./reconciler.js";
import type { ImageObservation } from "./github-event.js";
import { addObservation } from "./state.js";
import type { DeployState } from "./state.js";

function createState(state: Partial<DeployState>): DeployState {
  return {
    observed: {},
    deliveryIds: [],
    observedAt: {},
    deployed: {},
    deployedAt: {},
    failures: {},
    latestAcceptedAt: {},
    ...state
  };
}

function createDependencies(initialState: Partial<DeployState>): ReconcilerDependencies & { calls: string[]; getState: () => DeployState } {
  const calls: string[] = [];
  let state = createState(initialState);
  const currentImages = new Map<string, string | null>();
  const hasTag = vi.fn(async (packageName: ImageObservation["packageName"], tag: string) => {
    calls.push(`hasTag:${packageName}:${tag}`);
    return true;
  });

  return {
    calls,
    getState: () => state,
    owner: "umami-creative-gmbh",
    rolloutTimeoutMs: 60_000,
    migrationTimeoutMs: 90_000,
    registry: { hasTag },
    kube: {
      getDeploymentImage: vi.fn(async (deployment, container) => currentImages.get(`${deployment}/${container}`) ?? null),
      runMigration: vi.fn(async (tag, image, timeoutMs) => {
        calls.push(`migration:${tag}:${image}:${timeoutMs}`);
      }),
      setDeploymentImage: vi.fn(async (deployment, container, image) => {
        calls.push(`set:${deployment}/${container}:${image}`);
        currentImages.set(`${deployment}/${container}`, image);
      }),
      waitForDeploymentRollout: vi.fn(async (deployment, timeoutMs) => {
        calls.push(`wait:${deployment}:${timeoutMs}`);
      })
    },
    state: {
      read: vi.fn(async () => state),
      write: vi.fn(async (nextState) => {
        state = createState(nextState);
      }),
      update: vi.fn(async (mutator) => {
        state = createState(mutator(state));
        return state;
      }),
      recordObservation: vi.fn(async (observation) => {
        state = addObservation(state, observation);
        return state;
      })
    }
  };
}

describe("Reconciler", () => {
  const appObservation = (packageName: ImageObservation["packageName"], tag = "sha-abc123", publishedAt = "2026-05-08T10:00:00.000Z") => ({
    packageName,
    publishedAt,
    tag
  });

  it("records app observations and waits for all app package tags before rollout", async () => {
    const dependencies = createDependencies({ observed: { "sha-abc123": ["z8-webapp"] }, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-worker"));

    expect(dependencies.state.update).toHaveBeenCalledWith(expect.any(Function));
    expect(dependencies.registry.hasTag).not.toHaveBeenCalled();
    expect(dependencies.kube.runMigration).not.toHaveBeenCalled();
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
  });

  it("runs migration before patching and waiting for web and worker", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-migration"));

    expect(dependencies.calls).toEqual([
      "hasTag:z8-webapp:sha-abc123",
      "hasTag:z8-worker:sha-abc123",
      "hasTag:z8-migration:sha-abc123",
      "migration:sha-abc123:ghcr.io/umami-creative-gmbh/z8-migration:sha-abc123:90000",
      "set:web/web:ghcr.io/umami-creative-gmbh/z8-webapp:sha-abc123",
      "wait:web:60000",
      "set:worker/worker:ghcr.io/umami-creative-gmbh/z8-worker:sha-abc123",
      "wait:worker:60000"
    ]);
  });

  it("rolls out docs independently when the registry tag exists", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-docs"));

    expect(dependencies.calls).toEqual([
      "hasTag:z8-docs:sha-abc123",
      "set:docs/docs:ghcr.io/umami-creative-gmbh/z8-docs:sha-abc123",
      "wait:docs:60000"
    ]);
    expect(dependencies.state.update).toHaveBeenCalledWith(expect.any(Function));
  });

  it("rolls out marketing independently", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-marketing"));

    expect(dependencies.calls).toEqual([
      "hasTag:z8-marketing:sha-abc123",
      "set:marketing/marketing:ghcr.io/umami-creative-gmbh/z8-marketing:sha-abc123",
      "wait:marketing:60000"
    ]);
  });

  it("skips deployment when the registry tag is missing", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    dependencies.registry.hasTag = vi.fn(async (packageName, tag) => {
      dependencies.calls.push(`hasTag:${packageName}:${tag}`);
      return false;
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-docs"));

    expect(dependencies.calls).toEqual(["hasTag:z8-docs:sha-abc123"]);
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
    expect(dependencies.kube.waitForDeploymentRollout).not.toHaveBeenCalled();
    expect(dependencies.state.write).not.toHaveBeenCalled();
  });

  it("skips patching but still waits when the deployment already uses the desired image", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    dependencies.kube.getDeploymentImage = vi.fn(async () => "ghcr.io/umami-creative-gmbh/z8-docs:sha-abc123");
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-docs"));

    expect(dependencies.calls).toEqual(["hasTag:z8-docs:sha-abc123", "wait:docs:60000"]);
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
    expect(dependencies.kube.waitForDeploymentRollout).toHaveBeenCalledWith("docs", 60_000);
  });

  it("does not re-run migration for a duplicate app event after the app tag is deployed", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: { app: "sha-abc123" },
      failures: {}
    });
    dependencies.kube.getDeploymentImage = vi.fn(async (deployment) =>
      deployment === "web"
        ? "ghcr.io/umami-creative-gmbh/z8-webapp:sha-abc123"
        : "ghcr.io/umami-creative-gmbh/z8-worker:sha-abc123"
    );
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-webapp"));

    expect(dependencies.kube.runMigration).not.toHaveBeenCalled();
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
    expect(dependencies.kube.waitForDeploymentRollout).toHaveBeenCalledWith("web", 60_000);
    expect(dependencies.kube.waitForDeploymentRollout).toHaveBeenCalledWith("worker", 60_000);
  });

  it("serializes concurrent app reconciles for the same tag", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await Promise.all([
      reconciler.reconcile(appObservation("z8-migration")),
      reconciler.reconcile(appObservation("z8-webapp"))
    ]);

    expect(dependencies.kube.runMigration).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent app reconciles across different tags", async () => {
    const dependencies = createDependencies({
      observed: {
        "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"],
        "sha-def456": ["z8-migration", "z8-webapp", "z8-worker"]
      },
      deployed: {},
      failures: {}
    });
    let activeMigrations = 0;
    let overlapped = false;
    dependencies.kube.runMigration = vi.fn(async () => {
      activeMigrations += 1;
      if (activeMigrations > 1) overlapped = true;
      await Promise.resolve();
      activeMigrations -= 1;
    });
    const reconciler = new Reconciler(dependencies);

    await Promise.all([
      reconciler.reconcile(appObservation("z8-migration", "sha-abc123", "2026-05-08T10:00:00.000Z")),
      reconciler.reconcile(appObservation("z8-migration", "sha-def456", "2026-05-08T10:01:00.000Z"))
    ]);

    expect(overlapped).toBe(false);
  });

  it("does not roll app back to an older fully observed tag", async () => {
    const dependencies = createDependencies({
      observed: { "sha-old123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: { app: "sha-new123", appMigration: "sha-new123" },
      deployedAt: { app: "2026-05-08T10:10:00.000Z", appMigration: "2026-05-08T10:10:00.000Z" },
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-migration", "sha-old123", "2026-05-08T10:00:00.000Z"));

    expect(dependencies.kube.runMigration).not.toHaveBeenCalled();
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
  });

  it("does not roll docs or marketing back to older tags", async () => {
    const dependencies = createDependencies({
      observed: {},
      deployed: { docs: "sha-new123", marketing: "sha-new123" },
      deployedAt: { docs: "2026-05-08T10:10:00.000Z", marketing: "2026-05-08T10:10:00.000Z" },
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-docs", "sha-old123", "2026-05-08T10:00:00.000Z"));
    await reconciler.reconcile(appObservation("z8-marketing", "sha-old123", "2026-05-08T10:00:00.000Z"));

    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
  });

  it("can durably record an observation without rolling it out", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.recordObservation(appObservation("z8-docs"));

    expect(dependencies.state.update).toHaveBeenCalledWith(expect.any(Function));
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
  });

  it("records a delivery id and skips duplicate delivery rollout work", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    const first = await reconciler.recordObservation(appObservation("z8-docs"), "delivery-1");
    const second = await reconciler.recordObservation(appObservation("z8-docs"), "delivery-1");

    expect(first.duplicateDelivery).toBe(false);
    expect(second.duplicateDelivery).toBe(true);
    expect(dependencies.getState().deliveryIds).toEqual(["delivery-1"]);
  });

  it("does not re-run migration when retrying after migration succeeded but app rollout failed", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    dependencies.kube.setDeploymentImage = vi.fn(async (deployment, container, image) => {
      dependencies.calls.push(`set:${deployment}/${container}:${image}`);
      if (deployment === "web") throw new Error("web rollout patch failed");
    });
    const reconciler = new Reconciler(dependencies);

    await expect(reconciler.reconcile(appObservation("z8-migration"))).rejects.toThrow(
      "web rollout patch failed"
    );
    dependencies.kube.setDeploymentImage = vi.fn(async (deployment, container, image) => {
      dependencies.calls.push(`set:${deployment}/${container}:${image}`);
    });

    await reconciler.reconcile(appObservation("z8-webapp"));

    expect(dependencies.kube.runMigration).toHaveBeenCalledTimes(1);
  });

  it("persists deployed tags after successful rollouts", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile(appObservation("z8-migration"));
    await reconciler.reconcile(appObservation("z8-docs"));
    await reconciler.reconcile(appObservation("z8-marketing"));

    expect(dependencies.state.update).toHaveBeenCalledWith(expect.any(Function));
    expect(dependencies.state.write).not.toHaveBeenCalled();
    expect(dependencies.getState()).toEqual({
      observed: { "sha-abc123": ["z8-docs", "z8-marketing", "z8-migration", "z8-webapp", "z8-worker"] },
      deliveryIds: [],
      observedAt: {
        "sha-abc123": {
          "z8-docs": "2026-05-08T10:00:00.000Z",
          "z8-marketing": "2026-05-08T10:00:00.000Z",
          "z8-migration": "2026-05-08T10:00:00.000Z"
        }
      },
      deployed: { appMigration: "sha-abc123", app: "sha-abc123", docs: "sha-abc123", marketing: "sha-abc123" },
      deployedAt: {
        appMigration: "2026-05-08T10:00:00.000Z",
        app: "2026-05-08T10:00:00.000Z",
        docs: "2026-05-08T10:00:00.000Z",
        marketing: "2026-05-08T10:00:00.000Z"
      },
      latestAcceptedAt: { app: "2026-05-08T10:00:00.000Z", docs: "2026-05-08T10:00:00.000Z", marketing: "2026-05-08T10:00:00.000Z" },
      failures: {}
    });
  });
});
