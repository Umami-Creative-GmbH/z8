import type { DeploymentTarget } from "./kubernetes.js";
import type { ImageObservation } from "./github-event.js";
import type { DeployState } from "./state.js";

type AppPackageName = "z8-webapp" | "z8-worker" | "z8-migration";

type DeploymentSpec = {
  packageName: ImageObservation["packageName"];
  deployment: DeploymentTarget;
  container: string;
};

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

  constructor(dependencies: ReconcilerDependencies) {
    this.dependencies = dependencies;
  }

  async reconcile(observation: ImageObservation): Promise<void> {
    if (isAppPackage(observation.packageName)) {
      await this.reconcileApp(observation);
      return;
    }

    const spec = independentDeployments[observation.packageName];
    if (spec) await this.deployIfNeeded(spec, observation.tag);
  }

  private async reconcileApp(observation: ImageObservation): Promise<void> {
    const state = await this.dependencies.state.recordObservation(observation);
    const observed = new Set(state.observed[observation.tag] ?? []);
    if (!appPackages.every((packageName) => observed.has(packageName))) return;

    for (const packageName of appPackages) {
      if (!(await this.dependencies.registry.hasTag(packageName, observation.tag))) return;
    }

    await this.dependencies.kube.runMigration(
      observation.tag,
      this.image("z8-migration", observation.tag),
      this.dependencies.migrationTimeoutMs
    );
    await this.deployIfNeeded(
      { packageName: "z8-webapp", deployment: "web", container: "web" },
      observation.tag,
      { skipRegistryCheck: true }
    );
    await this.deployIfNeeded(
      { packageName: "z8-worker", deployment: "worker", container: "worker" },
      observation.tag,
      { skipRegistryCheck: true }
    );
  }

  private async deployIfNeeded(
    spec: DeploymentSpec,
    tag: string,
    options: { skipRegistryCheck?: boolean } = {}
  ): Promise<void> {
    const desiredImage = this.image(spec.packageName, tag);
    if (!options.skipRegistryCheck && !(await this.dependencies.registry.hasTag(spec.packageName, tag))) return;

    const currentImage = await this.dependencies.kube.getDeploymentImage(spec.deployment, spec.container);
    if (currentImage === desiredImage) return;

    await this.dependencies.kube.setDeploymentImage(spec.deployment, spec.container, desiredImage);
    await this.dependencies.kube.waitForDeploymentRollout(spec.deployment, this.dependencies.rolloutTimeoutMs);
  }

  private image(packageName: ImageObservation["packageName"], tag: string): string {
    return `ghcr.io/${this.dependencies.owner}/${packageName}:${tag}`;
  }
}
