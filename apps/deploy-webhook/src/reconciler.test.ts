import { describe, expect, it, vi } from "vitest";
import { Reconciler, type ReconcilerDependencies } from "./reconciler.js";
import type { ImageObservation } from "./github-event.js";
import type { DeployState } from "./state.js";

function createDependencies(state: DeployState): ReconcilerDependencies & { calls: string[] } {
  const calls: string[] = [];
  const currentImages = new Map<string, string | null>();
  const hasTag = vi.fn(async (packageName: ImageObservation["packageName"], tag: string) => {
    calls.push(`hasTag:${packageName}:${tag}`);
    return true;
  });

  return {
    calls,
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
        state = nextState;
      }),
      recordObservation: vi.fn(async (observation) => {
        const observed = new Set(state.observed[observation.tag] ?? []);
        observed.add(observation.packageName);
        state = {
          ...state,
          observed: { ...state.observed, [observation.tag]: Array.from(observed).sort() }
        };
        return state;
      })
    }
  };
}

describe("Reconciler", () => {
  it("records app observations and waits for all app package tags before rollout", async () => {
    const dependencies = createDependencies({ observed: { "sha-abc123": ["z8-webapp"] }, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile({ packageName: "z8-worker", tag: "sha-abc123" });

    expect(dependencies.state.recordObservation).toHaveBeenCalledWith({ packageName: "z8-worker", tag: "sha-abc123" });
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

    await reconciler.reconcile({ packageName: "z8-migration", tag: "sha-abc123" });

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

    await reconciler.reconcile({ packageName: "z8-docs", tag: "sha-abc123" });

    expect(dependencies.calls).toEqual([
      "hasTag:z8-docs:sha-abc123",
      "set:docs/docs:ghcr.io/umami-creative-gmbh/z8-docs:sha-abc123",
      "wait:docs:60000"
    ]);
    expect(dependencies.state.recordObservation).not.toHaveBeenCalled();
  });

  it("rolls out marketing independently", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile({ packageName: "z8-marketing", tag: "sha-abc123" });

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

    await reconciler.reconcile({ packageName: "z8-docs", tag: "sha-abc123" });

    expect(dependencies.calls).toEqual(["hasTag:z8-docs:sha-abc123"]);
    expect(dependencies.kube.setDeploymentImage).not.toHaveBeenCalled();
    expect(dependencies.kube.waitForDeploymentRollout).not.toHaveBeenCalled();
    expect(dependencies.state.write).not.toHaveBeenCalled();
  });

  it("skips patching but still waits when the deployment already uses the desired image", async () => {
    const dependencies = createDependencies({ observed: {}, deployed: {}, failures: {} });
    dependencies.kube.getDeploymentImage = vi.fn(async () => "ghcr.io/umami-creative-gmbh/z8-docs:sha-abc123");
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile({ packageName: "z8-docs", tag: "sha-abc123" });

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

    await reconciler.reconcile({ packageName: "z8-webapp", tag: "sha-abc123" });

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
      reconciler.reconcile({ packageName: "z8-migration", tag: "sha-abc123" }),
      reconciler.reconcile({ packageName: "z8-webapp", tag: "sha-abc123" })
    ]);

    expect(dependencies.kube.runMigration).toHaveBeenCalledTimes(1);
  });

  it("persists deployed tags after successful rollouts", async () => {
    const dependencies = createDependencies({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: {},
      failures: {}
    });
    const reconciler = new Reconciler(dependencies);

    await reconciler.reconcile({ packageName: "z8-migration", tag: "sha-abc123" });
    await reconciler.reconcile({ packageName: "z8-docs", tag: "sha-abc123" });
    await reconciler.reconcile({ packageName: "z8-marketing", tag: "sha-abc123" });

    expect(dependencies.state.write).toHaveBeenCalledWith({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: { app: "sha-abc123" },
      failures: {}
    });
    expect(dependencies.state.write).toHaveBeenCalledWith({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: { app: "sha-abc123", docs: "sha-abc123" },
      failures: {}
    });
    expect(dependencies.state.write).toHaveBeenCalledWith({
      observed: { "sha-abc123": ["z8-migration", "z8-webapp", "z8-worker"] },
      deployed: { app: "sha-abc123", docs: "sha-abc123", marketing: "sha-abc123" },
      failures: {}
    });
  });
});
