import type { DeploymentTarget } from "./kubernetes.js";
import type { ImageObservation } from "./github-event.js";
import type { DeployState } from "./state.js";

type AppPackageName = "z8-webapp" | "z8-worker" | "z8-migration";

type DeploymentSpec = {
  packageName: ImageObservation["packageName"];
  deployment: DeploymentTarget;
  container: string;
};

type DeployedKey = "app" | "appMigration" | "docs" | "marketing";

export type ReconcilerDependencies = {
  registry: {
    hasTag(packageName: ImageObservation["packageName"], tag: string): Promise<boolean>;
  };
  kube: {
    runMigration(tag: string, image: string, timeoutMs: number): Promise<void>;
    setDeploymentImage(deployment: DeploymentTarget, container: string, image: string): Promise<void>;
    waitForDeploymentRollout(deployment: DeploymentTarget, timeoutMs: number): Promise<void>;
    getDeploymentImage(deployment: DeploymentTarget, container: string): Promise<string | null>;
  };
  state: {
    recordObservation(observation: ImageObservation): Promise<DeployState>;
    read(): Promise<DeployState>;
    write(state: DeployState): Promise<void>;
    update(mutator: (state: DeployState) => DeployState): Promise<DeployState>;
  };
  owner: string;
  rolloutTimeoutMs: number;
  migrationTimeoutMs: number;
};

const appPackages: AppPackageName[] = ["z8-webapp", "z8-worker", "z8-migration"];

const independentDeployments: Partial<Record<ImageObservation["packageName"], DeploymentSpec>> = {
  "z8-docs": { packageName: "z8-docs", deployment: "docs", container: "docs" },
  "z8-marketing": { packageName: "z8-marketing", deployment: "marketing", container: "marketing" }
};

function isAppPackage(packageName: ImageObservation["packageName"]): packageName is AppPackageName {
  return appPackages.includes(packageName as AppPackageName);
}

export class Reconciler {
  private readonly dependencies: ReconcilerDependencies;
  private readonly inProgress = new Map<string, Promise<void>>();

  constructor(dependencies: ReconcilerDependencies) {
    this.dependencies = dependencies;
  }

  async reconcile(observation: ImageObservation): Promise<void> {
    if (isAppPackage(observation.packageName)) {
      await this.serialize(`app:${observation.tag}`, () => this.reconcileApp(observation));
      return;
    }

    const spec = independentDeployments[observation.packageName];
    if (spec) {
      await this.serialize(`${spec.deployment}:${observation.tag}`, () => this.reconcileIndependent(spec, observation.tag));
    }
  }

  private async serialize(key: string, reconcile: () => Promise<void>): Promise<void> {
    const previous = this.inProgress.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(reconcile);
    this.inProgress.set(key, current);

    try {
      await current;
    } finally {
      if (this.inProgress.get(key) === current) this.inProgress.delete(key);
    }
  }

  private async reconcileApp(observation: ImageObservation): Promise<void> {
    const state = await this.dependencies.state.recordObservation(observation);
    const observed = new Set(state.observed[observation.tag] ?? []);
    if (!appPackages.every((packageName) => observed.has(packageName))) return;

    if (state.deployed.app === observation.tag) {
      await this.deployAppImages(observation.tag);
      return;
    }

    for (const packageName of appPackages) {
      if (!(await this.dependencies.registry.hasTag(packageName, observation.tag))) return;
    }

    if (state.deployed.appMigration !== observation.tag) {
      await this.dependencies.kube.runMigration(
        observation.tag,
        this.image("z8-migration", observation.tag),
        this.dependencies.migrationTimeoutMs
      );
      await this.markDeployed("appMigration", observation.tag);
    }
    await this.deployAppImages(observation.tag);
    await this.markDeployed("app", observation.tag);
  }

  private async deployAppImages(tag: string): Promise<void> {
    await this.deployIfNeeded(
      { packageName: "z8-webapp", deployment: "web", container: "web" },
      tag,
      { skipRegistryCheck: true }
    );
    await this.deployIfNeeded(
      { packageName: "z8-worker", deployment: "worker", container: "worker" },
      tag,
      { skipRegistryCheck: true }
    );
  }

  private async reconcileIndependent(spec: DeploymentSpec, tag: string): Promise<void> {
    const deployedKey = spec.deployment as DeployedKey;
    if (!(await this.deployIfNeeded(spec, tag))) return;
    await this.markDeployed(deployedKey, tag);
  }

  private async deployIfNeeded(
    spec: DeploymentSpec,
    tag: string,
    options: { skipRegistryCheck?: boolean } = {}
  ): Promise<boolean> {
    const desiredImage = this.image(spec.packageName, tag);
    if (!options.skipRegistryCheck && !(await this.dependencies.registry.hasTag(spec.packageName, tag))) return false;

    const currentImage = await this.dependencies.kube.getDeploymentImage(spec.deployment, spec.container);
    if (currentImage === desiredImage) {
      await this.dependencies.kube.waitForDeploymentRollout(spec.deployment, this.dependencies.rolloutTimeoutMs);
      return true;
    }

    await this.dependencies.kube.setDeploymentImage(spec.deployment, spec.container, desiredImage);
    await this.dependencies.kube.waitForDeploymentRollout(spec.deployment, this.dependencies.rolloutTimeoutMs);
    return true;
  }

  private async markDeployed(key: DeployedKey, tag: string): Promise<void> {
    await this.dependencies.state.update((state) => {
      if (state.deployed[key] === tag) return state;
      return {
        ...state,
        deployed: { ...state.deployed, [key]: tag }
      };
    });
  }

  private image(packageName: ImageObservation["packageName"], tag: string): string {
    return `ghcr.io/${this.dependencies.owner}/${packageName}:${tag}`;
  }
}
