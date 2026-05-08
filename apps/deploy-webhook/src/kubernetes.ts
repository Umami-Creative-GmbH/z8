import {
  ApiException,
  AppsV1Api,
  BatchV1Api,
  KubeConfig,
  type V1Deployment,
  type V1Job
} from "@kubernetes/client-node";

export type DeploymentTarget = "web" | "worker" | "docs" | "marketing";

type KubernetesAdapterOptions = {
  namespace: string;
  appsApi?: AppsV1Api;
  batchApi?: BatchV1Api;
};

const migrationJobPrefix = "drizzle-migrate-";
const pollIntervalMs = 2_000;

function loadKubeConfig(): KubeConfig {
  const kubeConfig = new KubeConfig();
  if (process.env.NODE_ENV === "production") {
    kubeConfig.loadFromCluster();
  } else {
    kubeConfig.loadFromDefault();
  }
  return kubeConfig;
}

export function safeMigrationJobName(tag: string): string {
  let safeTag = tag
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!safeTag) safeTag = "release";

  let name = `${migrationJobPrefix}${safeTag}`;
  if (name.length > 63) name = name.slice(0, 63);
  return name.replace(/-+$/g, "");
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiException && error.code === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deploymentRolledOut(deployment: V1Deployment): boolean {
  const desiredReplicas = deployment.spec?.replicas ?? 1;
  const observedGeneration = deployment.status?.observedGeneration ?? 0;
  const generation = deployment.metadata?.generation ?? 0;
  const updatedReplicas = deployment.status?.updatedReplicas ?? 0;
  const availableReplicas = deployment.status?.availableReplicas ?? 0;

  return observedGeneration >= generation && updatedReplicas >= desiredReplicas && availableReplicas >= desiredReplicas;
}

export class KubernetesAdapter {
  private readonly namespace: string;
  private readonly appsApi: AppsV1Api;
  private readonly batchApi: BatchV1Api;

  constructor({ namespace, appsApi, batchApi }: KubernetesAdapterOptions) {
    this.namespace = namespace;

    if (appsApi && batchApi) {
      this.appsApi = appsApi;
      this.batchApi = batchApi;
      return;
    }

    const kubeConfig = loadKubeConfig();
    this.appsApi = appsApi ?? kubeConfig.makeApiClient(AppsV1Api);
    this.batchApi = batchApi ?? kubeConfig.makeApiClient(BatchV1Api);
  }

  async getDeploymentImage(deployment: DeploymentTarget, container: string): Promise<string | null> {
    try {
      const current = await this.appsApi.readNamespacedDeployment({ name: deployment, namespace: this.namespace });
      return current.spec?.template.spec?.containers.find((candidate) => candidate.name === container)?.image ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async setDeploymentImage(deployment: DeploymentTarget, container: string, image: string): Promise<void> {
    const current = await this.appsApi.readNamespacedDeployment({ name: deployment, namespace: this.namespace });
    const containers = current.spec?.template.spec?.containers;
    const target = containers?.find((candidate) => candidate.name === container);
    if (!target) throw new Error(`Deployment ${deployment} does not contain container ${container}`);

    target.image = image;
    await this.appsApi.replaceNamespacedDeployment({ name: deployment, namespace: this.namespace, body: current });
  }

  async waitForDeploymentRollout(deployment: DeploymentTarget, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "deployment status unavailable";

    while (Date.now() <= deadline) {
      const current = await this.appsApi.readNamespacedDeployment({ name: deployment, namespace: this.namespace });
      const desiredReplicas = current.spec?.replicas ?? 1;
      const observedGeneration = current.status?.observedGeneration ?? 0;
      const generation = current.metadata?.generation ?? 0;
      const updatedReplicas = current.status?.updatedReplicas ?? 0;
      const availableReplicas = current.status?.availableReplicas ?? 0;

      if (deploymentRolledOut(current)) return;

      lastStatus = `observedGeneration=${observedGeneration}/${generation}, updatedReplicas=${updatedReplicas}/${desiredReplicas}, availableReplicas=${availableReplicas}/${desiredReplicas}`;
      await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
    }

    throw new Error(`Timed out waiting for deployment ${deployment} rollout: ${lastStatus}`);
  }

  async runMigration(tag: string, image: string, timeoutMs: number): Promise<void> {
    const name = safeMigrationJobName(tag);
    await this.deleteJobIfExists(name, timeoutMs);
    await this.batchApi.createNamespacedJob({ namespace: this.namespace, body: this.createMigrationJob(name, image) });
    await this.waitForJobComplete(name, timeoutMs);
  }

  private async deleteJobIfExists(name: string, timeoutMs: number): Promise<void> {
    try {
      await this.batchApi.deleteNamespacedJob({ name, namespace: this.namespace, propagationPolicy: "Foreground" });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      try {
        await this.batchApi.readNamespacedJob({ name, namespace: this.namespace });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
    }

    throw new Error(`Timed out waiting for migration job ${name} deletion`);
  }

  private async waitForJobComplete(name: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const job = await this.batchApi.readNamespacedJobStatus({ name, namespace: this.namespace });
      if ((job.status?.succeeded ?? 0) > 0) return;
      if ((job.status?.failed ?? 0) > 0) throw new Error(`Migration job ${name} failed`);
      await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
    }

    throw new Error(`Timed out waiting for migration job ${name} completion`);
  }

  private createMigrationJob(name: string, image: string): V1Job {
    return {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name, namespace: this.namespace },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3_600,
        template: {
          spec: {
            enableServiceLinks: false,
            imagePullSecrets: [{ name: "ghcr-credentials" }],
            restartPolicy: "Never",
            containers: [
              {
                name: "migrate",
                image,
                imagePullPolicy: "IfNotPresent",
                workingDir: "/app",
                command: ["node", "./scripts/migrate-with-lock.js"],
                env: [
                  { name: "VALKEY_HOST", value: "valkey" },
                  { name: "VALKEY_PORT", value: "6379" },
                  { name: "DB_MIGRATION_LOCK_ID", value: "74382643" },
                  { name: "DRIZZLE_MIGRATE_COMMAND", value: "pnpm exec drizzle-kit migrate --config ./drizzle.config.ts" }
                ],
                envFrom: [{ secretRef: { name: "app-secrets" } }]
              }
            ]
          }
        }
      }
    };
  }
}
