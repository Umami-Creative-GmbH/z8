# Kubernetes Image Webhook Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-cluster GitHub webhook receiver that deploys new SHA-tagged GHCR images to the matching Z8 Kubernetes workloads.

**Architecture:** Add a dedicated `apps/deploy-webhook` Node/TypeScript service with small modules for signature verification, event parsing, GHCR readiness checks, state, and Kubernetes rollout reconciliation. Package it as `ghcr.io/umami-creative-gmbh/z8-deploy-webhook`, deploy it into `app-prod`, and expose only `/webhooks/github` through Traefik.

**Tech Stack:** Node 22, TypeScript, Vitest, native `fetch`, `@kubernetes/client-node`, Kubernetes RBAC/Deployment/Service/Ingress, GHCR OCI registry API.

---

## File Structure

- Create `apps/deploy-webhook/package.json`: workspace package scripts and runtime dependencies.
- Create `apps/deploy-webhook/tsconfig.json`: TypeScript config for the service and tests.
- Create `apps/deploy-webhook/src/config.ts`: environment parsing with safe defaults and secret-backed values.
- Create `apps/deploy-webhook/src/signature.ts`: GitHub HMAC-SHA256 verification.
- Create `apps/deploy-webhook/src/github-event.ts`: parse GitHub package events into image/tag observations.
- Create `apps/deploy-webhook/src/registry.ts`: verify a `repo:sha-...` tag exists in GHCR.
- Create `apps/deploy-webhook/src/state.ts`: ConfigMap-backed rollout state and in-process locking.
- Create `apps/deploy-webhook/src/kubernetes.ts`: focused Kubernetes operations for deployments, jobs, logs, and rollout waits.
- Create `apps/deploy-webhook/src/reconciler.ts`: app/docs/marketing reconciliation rules.
- Create `apps/deploy-webhook/src/server.ts`: HTTP server with `/healthz` and `/webhooks/github`.
- Create `apps/deploy-webhook/src/*.test.ts`: unit tests for signature, event parsing, registry behavior, and reconciliation.
- Create `docker/Dockerfile.deploy-webhook`: production image for the receiver.
- Create `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`: workflow contract check.
- Create `.github/workflows/publish-deploy-webhook-image.yml`: build and publish the receiver image with `latest`, `sha-*`, and semver tags.
- Create `infra/hetzner-k8s/k8s/app/deploy-webhook-rbac.yaml`: service account, role, role binding.
- Create `infra/hetzner-k8s/k8s/app/deploy-webhook-deployment.yaml`: receiver Deployment and Secret references.
- Create `infra/hetzner-k8s/k8s/app/deploy-webhook-service.yaml`: ClusterIP service.
- Create `infra/hetzner-k8s/k8s/app/deploy-webhook-ingress.yaml`: Traefik ingress for GitHub webhooks.
- Modify `infra/hetzner-k8s/k8s/kustomization.yaml`: include the new manifests.

## Task 1: Workspace App Skeleton And Core Config

**Files:**
- Create: `apps/deploy-webhook/package.json`
- Create: `apps/deploy-webhook/tsconfig.json`
- Create: `apps/deploy-webhook/src/config.ts`

- [ ] **Step 1: Create package metadata**

Create `apps/deploy-webhook/package.json`:

```json
{
  "name": "deploy-webhook",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@kubernetes/client-node": "^1.4.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `apps/deploy-webhook/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write config parser**

Create `apps/deploy-webhook/src/config.ts`:

```ts
export type AppConfig = {
  port: number;
  namespace: string;
  githubOwner: string;
  githubWebhookSecret: string;
  ghcrToken?: string;
  registryHost: string;
  rolloutTimeoutMs: number;
  migrationTimeoutMs: number;
  stateConfigMapName: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    port: intEnv("PORT", 8080),
    namespace: process.env.NAMESPACE ?? "app-prod",
    githubOwner: process.env.GITHUB_OWNER ?? "umami-creative-gmbh",
    githubWebhookSecret: requiredEnv("GITHUB_WEBHOOK_SECRET"),
    ghcrToken: process.env.GHCR_TOKEN || undefined,
    registryHost: process.env.REGISTRY_HOST ?? "ghcr.io",
    rolloutTimeoutMs: intEnv("ROLLOUT_TIMEOUT_MS", 600_000),
    migrationTimeoutMs: intEnv("MIGRATION_TIMEOUT_MS", 900_000),
    stateConfigMapName: process.env.STATE_CONFIG_MAP_NAME ?? "deploy-webhook-state"
  };
}
```

- [ ] **Step 4: Run package install**

Run: `pnpm install`

Expected: lockfile updates successfully and the new workspace package is detected.

- [ ] **Step 5: Build should fail until server exists**

Run: `pnpm --filter deploy-webhook build`

Expected: FAIL because `src/server.ts` does not exist yet or there are no inputs beyond config.

- [ ] **Step 6: Commit**

```bash
git add apps/deploy-webhook/package.json apps/deploy-webhook/tsconfig.json apps/deploy-webhook/src/config.ts pnpm-lock.yaml
git commit -m "feat: add deploy webhook workspace"
```

## Task 2: Signature Verification And Event Parsing

**Files:**
- Create: `apps/deploy-webhook/src/signature.ts`
- Create: `apps/deploy-webhook/src/signature.test.ts`
- Create: `apps/deploy-webhook/src/github-event.ts`
- Create: `apps/deploy-webhook/src/github-event.test.ts`

- [ ] **Step 1: Write signature tests**

Create `apps/deploy-webhook/src/signature.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature } from "./signature.js";

describe("verifyGitHubSignature", () => {
  it("accepts a valid sha256 signature", () => {
    const body = Buffer.from('{"zen":"keep it logically awesome"}');
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGitHubSignature(body, signature, "secret")).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const body = Buffer.from("{}");
    expect(verifyGitHubSignature(body, "sha256=bad", "secret")).toBe(false);
  });

  it("rejects missing or non-sha256 signatures", () => {
    expect(verifyGitHubSignature(Buffer.from("{}"), undefined, "secret")).toBe(false);
    expect(verifyGitHubSignature(Buffer.from("{}"), "sha1=abc", "secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run signature test to verify failure**

Run: `pnpm --filter deploy-webhook test -- signature.test.ts`

Expected: FAIL with module not found for `./signature.js`.

- [ ] **Step 3: Implement signature verification**

Create `apps/deploy-webhook/src/signature.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(body: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const receivedHex = signatureHeader.slice("sha256=".length);
  const expectedHex = createHmac("sha256", secret).update(body).digest("hex");

  const received = Buffer.from(receivedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
```

- [ ] **Step 4: Write event parser tests**

Create `apps/deploy-webhook/src/github-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGitHubPackageEvent } from "./github-event.js";

const basePayload = {
  action: "published",
  package: {
    package_type: "container",
    name: "z8-docs",
    owner: { login: "umami-creative-gmbh" },
    package_version: {
      container_metadata: { tag: { name: "sha-abcdef1" } }
    }
  }
};

describe("parseGitHubPackageEvent", () => {
  it("extracts an allowlisted SHA image observation", () => {
    expect(parseGitHubPackageEvent(basePayload, "umami-creative-gmbh")).toEqual({
      packageName: "z8-docs",
      tag: "sha-abcdef1"
    });
  });

  it("ignores unrelated owners", () => {
    const payload = { ...basePayload, package: { ...basePayload.package, owner: { login: "other" } } };
    expect(parseGitHubPackageEvent(payload, "umami-creative-gmbh")).toBeNull();
  });

  it("ignores non-SHA tags and unknown packages", () => {
    const latestPayload = {
      ...basePayload,
      package: {
        ...basePayload.package,
        package_version: { container_metadata: { tag: { name: "latest" } } }
      }
    };
    const unknownPayload = { ...basePayload, package: { ...basePayload.package, name: "other-image" } };
    expect(parseGitHubPackageEvent(latestPayload, "umami-creative-gmbh")).toBeNull();
    expect(parseGitHubPackageEvent(unknownPayload, "umami-creative-gmbh")).toBeNull();
  });
});
```

- [ ] **Step 5: Implement event parser**

Create `apps/deploy-webhook/src/github-event.ts`:

```ts
export type ImageObservation = {
  packageName: "z8-webapp" | "z8-worker" | "z8-migration" | "z8-docs" | "z8-marketing";
  tag: string;
};

const allowedPackages = new Set<ImageObservation["packageName"]>([
  "z8-webapp",
  "z8-worker",
  "z8-migration",
  "z8-docs",
  "z8-marketing"
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseGitHubPackageEvent(payload: unknown, expectedOwner: string): ImageObservation | null {
  if (!isObject(payload)) return null;
  const packageValue = payload.package;
  if (!isObject(packageValue)) return null;

  const owner = isObject(packageValue.owner) ? getString(packageValue.owner.login) : null;
  if (owner !== expectedOwner) return null;

  const packageName = getString(packageValue.name);
  if (!packageName || !allowedPackages.has(packageName as ImageObservation["packageName"])) return null;

  const packageVersion = isObject(packageValue.package_version) ? packageValue.package_version : null;
  const containerMetadata = packageVersion && isObject(packageVersion.container_metadata) ? packageVersion.container_metadata : null;
  const tagObject = containerMetadata && isObject(containerMetadata.tag) ? containerMetadata.tag : null;
  const tag = tagObject ? getString(tagObject.name) : null;

  if (!tag || !/^sha-[a-f0-9]+$/.test(tag)) return null;

  return { packageName: packageName as ImageObservation["packageName"], tag };
}
```

- [ ] **Step 6: Run parser tests**

Run: `pnpm --filter deploy-webhook test -- signature.test.ts github-event.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/deploy-webhook/src/signature.ts apps/deploy-webhook/src/signature.test.ts apps/deploy-webhook/src/github-event.ts apps/deploy-webhook/src/github-event.test.ts
git commit -m "feat: verify deploy webhook events"
```

## Task 3: Registry Readiness Checker

**Files:**
- Create: `apps/deploy-webhook/src/registry.ts`
- Create: `apps/deploy-webhook/src/registry.test.ts`

- [ ] **Step 1: Write registry tests**

Create `apps/deploy-webhook/src/registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RegistryClient } from "./registry.js";

describe("RegistryClient", () => {
  it("returns true when GHCR has the manifest", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });
    await expect(client.hasTag("z8-docs", "sha-abcdef1")).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ghcr.io/v2/umami-creative-gmbh/z8-docs/manifests/sha-abcdef1",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("returns false when the manifest is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });
    await expect(client.hasTag("z8-docs", "sha-missing")).resolves.toBe(false);
  });

  it("uses bearer auth when a token is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", token: "token", fetchImpl });
    await client.hasTag("z8-docs", "sha-abcdef1");
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
  });
});
```

- [ ] **Step 2: Implement registry checker**

Create `apps/deploy-webhook/src/registry.ts`:

```ts
import type { ImageObservation } from "./github-event.js";

type FetchLike = typeof fetch;

export class RegistryClient {
  private readonly registryHost: string;
  private readonly owner: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { registryHost: string; owner: string; token?: string; fetchImpl?: FetchLike }) {
    this.registryHost = options.registryHost;
    this.owner = options.owner;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async hasTag(packageName: ImageObservation["packageName"], tag: string): Promise<boolean> {
    const url = `https://${this.registryHost}/v2/${this.owner}/${packageName}/manifests/${tag}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"
    };

    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await this.fetchImpl(url, { method: "HEAD", headers });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Registry check failed for ${packageName}:${tag} with HTTP ${response.status}`);
    return true;
  }
}
```

- [ ] **Step 3: Run registry tests**

Run: `pnpm --filter deploy-webhook test -- registry.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/deploy-webhook/src/registry.ts apps/deploy-webhook/src/registry.test.ts
git commit -m "feat: check ghcr image readiness"
```

## Task 4: Kubernetes Adapter And State Store

**Files:**
- Create: `apps/deploy-webhook/src/kubernetes.ts`
- Create: `apps/deploy-webhook/src/state.ts`

- [ ] **Step 1: Implement Kubernetes adapter**

Create `apps/deploy-webhook/src/kubernetes.ts`:

```ts
import * as k8s from "@kubernetes/client-node";

export type DeploymentTarget = "web" | "worker" | "docs" | "marketing";

export class KubernetesAdapter {
  private readonly appsApi: k8s.AppsV1Api;
  private readonly batchApi: k8s.BatchV1Api;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly namespace: string;

  constructor(namespace: string) {
    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromClusterAndUser({ name: "cluster" }, { name: "user" });
    try {
      kubeConfig.loadFromDefault();
    } catch {
      kubeConfig.loadFromCluster();
    }
    this.appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.batchApi = kubeConfig.makeApiClient(k8s.BatchV1Api);
    this.coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.namespace = namespace;
  }

  async getDeploymentImage(deployment: DeploymentTarget, container: string): Promise<string | null> {
    const response = await this.appsApi.readNamespacedDeployment({ name: deployment, namespace: this.namespace });
    const found = response.spec?.template.spec?.containers.find((candidate) => candidate.name === container);
    return found?.image ?? null;
  }

  async setDeploymentImage(deployment: DeploymentTarget, container: string, image: string): Promise<void> {
    await this.appsApi.patchNamespacedDeployment({
      name: deployment,
      namespace: this.namespace,
      body: { spec: { template: { spec: { containers: [{ name: container, image }] } } } },
      contentType: k8s.PatchUtils.PATCH_FORMAT_STRATEGIC_MERGE_PATCH
    });
  }

  async waitForDeploymentRollout(deployment: DeploymentTarget, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const response = await this.appsApi.readNamespacedDeployment({ name: deployment, namespace: this.namespace });
      const desired = response.spec?.replicas ?? 1;
      const updated = response.status?.updatedReplicas ?? 0;
      const available = response.status?.availableReplicas ?? 0;
      const observedGeneration = response.status?.observedGeneration ?? 0;
      const generation = response.metadata?.generation ?? 0;
      if (updated >= desired && available >= desired && observedGeneration >= generation) return;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Timed out waiting for deployment/${deployment} rollout`);
  }

  async runMigration(tag: string, image: string, timeoutMs: number): Promise<void> {
    const safeTag = tag.replace(/[^a-z0-9-]/g, "-").slice(0, 40).replace(/-$/, "");
    const name = `drizzle-migrate-${safeTag}`.slice(0, 63).replace(/-$/, "");
    await this.batchApi.deleteNamespacedJob({ name, namespace: this.namespace, propagationPolicy: "Foreground" }).catch(() => undefined);
    await this.batchApi.createNamespacedJob({
      namespace: this.namespace,
      body: {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name, namespace: this.namespace },
        spec: {
          backoffLimit: 0,
          ttlSecondsAfterFinished: 3600,
          template: {
            spec: {
              enableServiceLinks: false,
              imagePullSecrets: [{ name: "ghcr-credentials" }],
              restartPolicy: "Never",
              containers: [{
                name: "migrate",
                image,
                imagePullPolicy: "IfNotPresent",
                workingDir: "/app/apps/webapp",
                command: ["node", "./scripts/migrate-with-lock.js"],
                env: [
                  { name: "VALKEY_HOST", value: "valkey" },
                  { name: "VALKEY_PORT", value: "6379" },
                  { name: "DB_MIGRATION_LOCK_ID", value: "74382643" },
                  { name: "DRIZZLE_MIGRATE_COMMAND", value: "pnpm exec drizzle-kit migrate --config ./drizzle.config.ts" }
                ],
                envFrom: [{ secretRef: { name: "app-secrets" } }]
              }]
            }
          }
        }
      }
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = await this.batchApi.readNamespacedJob({ name, namespace: this.namespace });
      if ((job.status?.succeeded ?? 0) > 0) return;
      if ((job.status?.failed ?? 0) > 0) throw new Error(`Migration job ${name} failed`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Timed out waiting for migration job ${name}`);
  }
}
```

- [ ] **Step 2: Implement ConfigMap state store**

Create `apps/deploy-webhook/src/state.ts`:

```ts
import * as k8s from "@kubernetes/client-node";
import type { ImageObservation } from "./github-event.js";

export type DeployState = {
  observed: Record<string, ImageObservation["packageName"][]>;
  deployed: Record<string, string>;
  failures: Record<string, string>;
};

export class StateStore {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly namespace: string;
  private readonly name: string;

  constructor(namespace: string, name: string) {
    const kubeConfig = new k8s.KubeConfig();
    try {
      kubeConfig.loadFromDefault();
    } catch {
      kubeConfig.loadFromCluster();
    }
    this.coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.namespace = namespace;
    this.name = name;
  }

  async read(): Promise<DeployState> {
    try {
      const configMap = await this.coreApi.readNamespacedConfigMap({ name: this.name, namespace: this.namespace });
      const raw = configMap.data?.state;
      if (!raw) return { observed: {}, deployed: {}, failures: {} };
      return JSON.parse(raw) as DeployState;
    } catch {
      return { observed: {}, deployed: {}, failures: {} };
    }
  }

  async write(state: DeployState): Promise<void> {
    const body = { metadata: { name: this.name, namespace: this.namespace }, data: { state: JSON.stringify(state, null, 2) } };
    try {
      await this.coreApi.replaceNamespacedConfigMap({ name: this.name, namespace: this.namespace, body });
    } catch {
      await this.coreApi.createNamespacedConfigMap({ namespace: this.namespace, body });
    }
  }

  async recordObservation(observation: ImageObservation): Promise<DeployState> {
    const state = await this.read();
    const packages = new Set(state.observed[observation.tag] ?? []);
    packages.add(observation.packageName);
    state.observed[observation.tag] = [...packages].sort() as ImageObservation["packageName"][];
    await this.write(state);
    return state;
  }
}
```

- [ ] **Step 3: Run TypeScript build**

Run: `pnpm --filter deploy-webhook build`

Expected: FAIL only because `src/server.ts` is not created yet; fix any TypeScript errors in `kubernetes.ts` or `state.ts` before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/deploy-webhook/src/kubernetes.ts apps/deploy-webhook/src/state.ts
git commit -m "feat: add deploy webhook kubernetes adapters"
```

## Task 5: Reconciler And HTTP Server

**Files:**
- Create: `apps/deploy-webhook/src/reconciler.ts`
- Create: `apps/deploy-webhook/src/reconciler.test.ts`
- Create: `apps/deploy-webhook/src/server.ts`

- [ ] **Step 1: Write reconciler tests**

Create `apps/deploy-webhook/src/reconciler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Reconciler } from "./reconciler.js";

describe("Reconciler", () => {
  it("waits for all app images before app rollout", async () => {
    const registry = { hasTag: vi.fn().mockResolvedValue(true) };
    const kube = { runMigration: vi.fn(), setDeploymentImage: vi.fn(), waitForDeploymentRollout: vi.fn(), getDeploymentImage: vi.fn().mockResolvedValue("old") };
    const state = { recordObservation: vi.fn().mockResolvedValue({ observed: { "sha-abc": ["z8-webapp"] }, deployed: {}, failures: {} }), read: vi.fn(), write: vi.fn() };
    const reconciler = new Reconciler({ registry, kube, state, owner: "umami-creative-gmbh", rolloutTimeoutMs: 1, migrationTimeoutMs: 1 });
    await reconciler.reconcile({ packageName: "z8-webapp", tag: "sha-abc" });
    expect(kube.runMigration).not.toHaveBeenCalled();
  });

  it("runs migration before app deployment patches", async () => {
    const registry = { hasTag: vi.fn().mockResolvedValue(true) };
    const kube = { runMigration: vi.fn(), setDeploymentImage: vi.fn(), waitForDeploymentRollout: vi.fn(), getDeploymentImage: vi.fn().mockResolvedValue("old") };
    const state = { recordObservation: vi.fn().mockResolvedValue({ observed: { "sha-abc": ["z8-webapp", "z8-worker", "z8-migration"] }, deployed: {}, failures: {} }), read: vi.fn(), write: vi.fn() };
    const reconciler = new Reconciler({ registry, kube, state, owner: "umami-creative-gmbh", rolloutTimeoutMs: 1, migrationTimeoutMs: 1 });
    await reconciler.reconcile({ packageName: "z8-worker", tag: "sha-abc" });
    expect(kube.runMigration).toHaveBeenCalledWith("sha-abc", "ghcr.io/umami-creative-gmbh/z8-migration:sha-abc", 1);
    expect(kube.setDeploymentImage).toHaveBeenCalledWith("web", "web", "ghcr.io/umami-creative-gmbh/z8-webapp:sha-abc");
    expect(kube.setDeploymentImage).toHaveBeenCalledWith("worker", "worker", "ghcr.io/umami-creative-gmbh/z8-worker:sha-abc");
  });

  it("deploys docs independently", async () => {
    const registry = { hasTag: vi.fn().mockResolvedValue(true) };
    const kube = { runMigration: vi.fn(), setDeploymentImage: vi.fn(), waitForDeploymentRollout: vi.fn(), getDeploymentImage: vi.fn().mockResolvedValue("old") };
    const state = { recordObservation: vi.fn().mockResolvedValue({ observed: {}, deployed: {}, failures: {} }), read: vi.fn(), write: vi.fn() };
    const reconciler = new Reconciler({ registry, kube, state, owner: "umami-creative-gmbh", rolloutTimeoutMs: 1, migrationTimeoutMs: 1 });
    await reconciler.reconcile({ packageName: "z8-docs", tag: "sha-docs" });
    expect(kube.setDeploymentImage).toHaveBeenCalledWith("docs", "docs", "ghcr.io/umami-creative-gmbh/z8-docs:sha-docs");
    expect(kube.runMigration).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement reconciler**

Create `apps/deploy-webhook/src/reconciler.ts`:

```ts
import type { ImageObservation } from "./github-event.js";
import type { RegistryClient } from "./registry.js";
import type { DeployState, StateStore } from "./state.js";
import type { DeploymentTarget, KubernetesAdapter } from "./kubernetes.js";

const appPackages = ["z8-webapp", "z8-worker", "z8-migration"] as const;

type Dependencies = {
  registry: Pick<RegistryClient, "hasTag">;
  kube: Pick<KubernetesAdapter, "runMigration" | "setDeploymentImage" | "waitForDeploymentRollout" | "getDeploymentImage">;
  state: Pick<StateStore, "recordObservation" | "read" | "write">;
  owner: string;
  rolloutTimeoutMs: number;
  migrationTimeoutMs: number;
};

export class Reconciler {
  constructor(private readonly deps: Dependencies) {}

  async reconcile(observation: ImageObservation): Promise<void> {
    const state = await this.deps.state.recordObservation(observation);
    if (appPackages.includes(observation.packageName as typeof appPackages[number])) {
      await this.reconcileApp(observation.tag, state);
      return;
    }
    if (observation.packageName === "z8-docs") {
      await this.reconcileDeployment("docs", "docs", "z8-docs", observation.tag);
      return;
    }
    if (observation.packageName === "z8-marketing") {
      await this.reconcileDeployment("marketing", "marketing", "z8-marketing", observation.tag);
    }
  }

  private async reconcileApp(tag: string, state: DeployState): Promise<void> {
    const observed = new Set(state.observed[tag] ?? []);
    if (!appPackages.every((packageName) => observed.has(packageName))) return;

    for (const packageName of appPackages) {
      if (!(await this.deps.registry.hasTag(packageName, tag))) return;
    }

    await this.deps.kube.runMigration(tag, this.image("z8-migration", tag), this.deps.migrationTimeoutMs);
    await this.reconcileDeployment("web", "web", "z8-webapp", tag);
    await this.reconcileDeployment("worker", "worker", "z8-worker", tag);
  }

  private async reconcileDeployment(deployment: DeploymentTarget, container: string, packageName: ImageObservation["packageName"], tag: string): Promise<void> {
    if (!(await this.deps.registry.hasTag(packageName, tag))) return;
    const desiredImage = this.image(packageName, tag);
    const currentImage = await this.deps.kube.getDeploymentImage(deployment, container);
    if (currentImage === desiredImage) return;
    await this.deps.kube.setDeploymentImage(deployment, container, desiredImage);
    await this.deps.kube.waitForDeploymentRollout(deployment, this.deps.rolloutTimeoutMs);
  }

  private image(packageName: ImageObservation["packageName"], tag: string): string {
    return `ghcr.io/${this.deps.owner}/${packageName}:${tag}`;
  }
}
```

- [ ] **Step 3: Implement HTTP server**

Create `apps/deploy-webhook/src/server.ts`:

```ts
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { parseGitHubPackageEvent } from "./github-event.js";
import { KubernetesAdapter } from "./kubernetes.js";
import { Reconciler } from "./reconciler.js";
import { RegistryClient } from "./registry.js";
import { verifyGitHubSignature } from "./signature.js";
import { StateStore } from "./state.js";

const config = loadConfig();
const reconciler = new Reconciler({
  registry: new RegistryClient({ registryHost: config.registryHost, owner: config.githubOwner, token: config.ghcrToken }),
  kube: new KubernetesAdapter(config.namespace),
  state: new StateStore(config.namespace, config.stateConfigMapName),
  owner: config.githubOwner,
  rolloutTimeoutMs: config.rolloutTimeoutMs,
  migrationTimeoutMs: config.migrationTimeoutMs
});

async function readBody(request: Parameters<typeof createServer>[0] extends (request: infer R, response: infer S) => void ? R : never): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.method !== "POST" || request.url !== "/webhooks/github") {
    response.writeHead(404);
    response.end();
    return;
  }

  const body = await readBody(request);
  if (!verifyGitHubSignature(body, request.headers["x-hub-signature-256"] as string | undefined, config.githubWebhookSecret)) {
    response.writeHead(401);
    response.end("invalid signature");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    response.writeHead(400);
    response.end("invalid json");
    return;
  }

  const observation = parseGitHubPackageEvent(payload, config.githubOwner);
  if (!observation) {
    response.writeHead(202);
    response.end("ignored");
    return;
  }

  response.writeHead(202);
  response.end("accepted");

  reconciler.reconcile(observation).catch((error: unknown) => {
    console.error("deploy reconciliation failed", { observation, error });
  });
});

server.listen(config.port, () => {
  console.log(`deploy webhook listening on :${config.port}`);
});
```

- [ ] **Step 4: Run service tests and build**

Run: `pnpm --filter deploy-webhook test && pnpm --filter deploy-webhook build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deploy-webhook/src/reconciler.ts apps/deploy-webhook/src/reconciler.test.ts apps/deploy-webhook/src/server.ts
git commit -m "feat: reconcile image webhook rollouts"
```

## Task 6: Docker Image And Publish Workflow

**Files:**
- Create: `docker/Dockerfile.deploy-webhook`
- Create: `.github/workflows/publish-deploy-webhook-image.yml`
- Create: `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

- [ ] **Step 1: Create Dockerfile**

Create `docker/Dockerfile.deploy-webhook`:

```dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
RUN apk add --no-cache ca-certificates tini
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/deploy-webhook/package.json ./apps/deploy-webhook/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter deploy-webhook...

FROM deps AS builder
COPY apps/deploy-webhook ./apps/deploy-webhook
RUN pnpm --filter deploy-webhook build

FROM base AS runtime
ENV NODE_ENV=production PORT=8080
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app
COPY --from=deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=app:nodejs /app/apps/deploy-webhook/node_modules ./apps/deploy-webhook/node_modules
COPY --from=builder --chown=app:nodejs /app/apps/deploy-webhook/dist ./apps/deploy-webhook/dist
COPY --from=builder --chown=app:nodejs /app/apps/deploy-webhook/package.json ./apps/deploy-webhook/package.json
WORKDIR /app/apps/deploy-webhook
USER app
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Create workflow verifier**

Create `scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`:

```js
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/publish-deploy-webhook-image.yml", "utf8");
const required = [
  "docker/Dockerfile.deploy-webhook",
  "ghcr.io/umami-creative-gmbh/z8-deploy-webhook",
  "type=raw,value=latest",
  "type=sha,prefix=sha-",
  "ubuntu-24.04-arm",
  "Verify workflow contract"
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    console.error(`Missing workflow contract text: ${needle}`);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Create publish workflow**

Create `.github/workflows/publish-deploy-webhook-image.yml` by copying the structure of `.github/workflows/publish-docs-image.yml`, replacing:

```yaml
name: Publish Deploy Webhook Image

on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: publish-deploy-webhook-image-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-native:
    name: Build Native (${{ matrix.arch }})
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 120
    strategy:
      fail-fast: true
      matrix:
        include:
          - arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Verify workflow contract
        run: node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push deploy webhook image by digest
        id: build_deploy_webhook
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./docker/Dockerfile.deploy-webhook
          platforms: ${{ matrix.platform }}
          outputs: type=image,name=ghcr.io/umami-creative-gmbh/z8-deploy-webhook,push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=deploy-webhook-${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=deploy-webhook-${{ matrix.arch }}
      - name: Export digest artifact
        env:
          DEPLOY_WEBHOOK_DIGEST: ${{ steps.build_deploy_webhook.outputs.digest }}
        run: |
          mkdir -p /tmp/digests/deploy-webhook
          touch "/tmp/digests/deploy-webhook/${DEPLOY_WEBHOOK_DIGEST#sha256:}"
      - name: Upload deploy webhook digest
        uses: actions/upload-artifact@v4
        with:
          name: digests-deploy-webhook-${{ matrix.arch }}
          path: /tmp/digests/deploy-webhook/*
          if-no-files-found: error

  publish-manifest:
    name: Publish Manifest
    needs: build-native
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Download amd64 digest
        uses: actions/download-artifact@v4
        with:
          name: digests-deploy-webhook-amd64
          path: /tmp/digests/amd64
      - name: Download arm64 digest
        uses: actions/download-artifact@v4
        with:
          name: digests-deploy-webhook-arm64
          path: /tmp/digests/arm64
      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/umami-creative-gmbh/z8-deploy-webhook
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=semver,pattern=v{{version}}
            type=semver,pattern=v{{major}}.{{minor}}
            type=semver,pattern=v{{major}}
      - name: Create and push multi-arch manifests
        env:
          IMAGE_NAME: ghcr.io/umami-creative-gmbh/z8-deploy-webhook
          TAGS: ${{ steps.meta.outputs.tags }}
        run: |
          set -euo pipefail
          set -- /tmp/digests/amd64/*
          AMD64_DIGEST="sha256:${1##*/}"
          set -- /tmp/digests/arm64/*
          ARM64_DIGEST="sha256:${1##*/}"
          for tag in $TAGS; do
            docker buildx imagetools create -t "$tag" "$IMAGE_NAME@$AMD64_DIGEST" "$IMAGE_NAME@$ARM64_DIGEST"
          done
```

- [ ] **Step 4: Verify Dockerfile and workflow contracts**

Run: `pnpm node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs && docker build -f docker/Dockerfile.deploy-webhook -t z8-deploy-webhook:local .`

Expected: verifier exits 0 and Docker image builds.

- [ ] **Step 5: Commit**

```bash
git add docker/Dockerfile.deploy-webhook .github/workflows/publish-deploy-webhook-image.yml scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs
git commit -m "feat: publish deploy webhook image"
```

## Task 7: Kubernetes Manifests

**Files:**
- Create: `infra/hetzner-k8s/k8s/app/deploy-webhook-rbac.yaml`
- Create: `infra/hetzner-k8s/k8s/app/deploy-webhook-deployment.yaml`
- Create: `infra/hetzner-k8s/k8s/app/deploy-webhook-service.yaml`
- Create: `infra/hetzner-k8s/k8s/app/deploy-webhook-ingress.yaml`
- Modify: `infra/hetzner-k8s/k8s/kustomization.yaml`

- [ ] **Step 1: Create RBAC manifest**

Create `infra/hetzner-k8s/k8s/app/deploy-webhook-rbac.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: deploy-webhook
  namespace: app-prod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deploy-webhook
  namespace: app-prod
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["create", "get", "patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deploy-webhook
  namespace: app-prod
subjects:
  - kind: ServiceAccount
    name: deploy-webhook
    namespace: app-prod
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: deploy-webhook
```

- [ ] **Step 2: Create Deployment manifest**

Create `infra/hetzner-k8s/k8s/app/deploy-webhook-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deploy-webhook
  namespace: app-prod
spec:
  replicas: 1
  selector:
    matchLabels:
      app: deploy-webhook
  template:
    metadata:
      labels:
        app: deploy-webhook
    spec:
      enableServiceLinks: false
      serviceAccountName: deploy-webhook
      imagePullSecrets:
        - name: ghcr-credentials
      containers:
        - name: deploy-webhook
          image: ghcr.io/umami-creative-gmbh/z8-deploy-webhook:latest
          imagePullPolicy: Always
          env:
            - name: PORT
              value: "8080"
            - name: NAMESPACE
              value: app-prod
            - name: GITHUB_OWNER
              value: umami-creative-gmbh
            - name: GITHUB_WEBHOOK_SECRET
              valueFrom:
                secretKeyRef:
                  name: deploy-webhook-secrets
                  key: github-webhook-secret
            - name: GHCR_TOKEN
              valueFrom:
                secretKeyRef:
                  name: deploy-webhook-secrets
                  key: ghcr-token
                  optional: true
          ports:
            - containerPort: 8080
              name: http
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
```

- [ ] **Step 3: Create Service manifest**

Create `infra/hetzner-k8s/k8s/app/deploy-webhook-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: deploy-webhook
  namespace: app-prod
spec:
  type: ClusterIP
  selector:
    app: deploy-webhook
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

- [ ] **Step 4: Create Ingress manifest**

Create `infra/hetzner-k8s/k8s/app/deploy-webhook-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: deploy-webhook
  namespace: app-prod
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - deploy-webhook.z8-time.app
      secretName: deploy-webhook-tls
  rules:
    - host: deploy-webhook.z8-time.app
      http:
        paths:
          - path: /webhooks/github
            pathType: Exact
            backend:
              service:
                name: deploy-webhook
                port:
                  number: 80
```

- [ ] **Step 5: Add manifests to kustomization**

Modify `infra/hetzner-k8s/k8s/kustomization.yaml` resources list to include:

```yaml
  - app/deploy-webhook-rbac.yaml
  - app/deploy-webhook-deployment.yaml
  - app/deploy-webhook-service.yaml
  - app/deploy-webhook-ingress.yaml
```

Place them near the other `app/*` resources, with RBAC before Deployment and Service before Ingress.

- [ ] **Step 6: Validate manifests locally**

Run: `kubectl kustomize infra/hetzner-k8s/k8s >/tmp/z8-kustomize.yaml`

Expected: command exits 0 and generated YAML includes `kind: Deployment` with `name: deploy-webhook`.

- [ ] **Step 7: Commit**

```bash
git add infra/hetzner-k8s/k8s/app/deploy-webhook-rbac.yaml infra/hetzner-k8s/k8s/app/deploy-webhook-deployment.yaml infra/hetzner-k8s/k8s/app/deploy-webhook-service.yaml infra/hetzner-k8s/k8s/app/deploy-webhook-ingress.yaml infra/hetzner-k8s/k8s/kustomization.yaml
git commit -m "feat: deploy image webhook receiver"
```

## Task 8: Final Verification And Operational Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-05-08-k8s-image-webhook-rollout-design.md` only if implementation decisions changed.

- [ ] **Step 1: Run unit tests**

Run: `pnpm --filter deploy-webhook test`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `pnpm --filter deploy-webhook build`

Expected: PASS.

- [ ] **Step 3: Run workflow verifier**

Run: `pnpm node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`

Expected: PASS.

- [ ] **Step 4: Validate Kubernetes YAML**

Run: `kubectl kustomize infra/hetzner-k8s/k8s >/tmp/z8-kustomize.yaml`

Expected: PASS.

- [ ] **Step 5: Build Docker image**

Run: `docker build -f docker/Dockerfile.deploy-webhook -t z8-deploy-webhook:local .`

Expected: PASS.

- [ ] **Step 6: List required live setup**

Report that live deployment requires these out-of-band secrets/actions:

```text
Kubernetes Secret app-prod/deploy-webhook-secrets with key github-webhook-secret.
Optional Kubernetes Secret key ghcr-token if GHCR packages are private or anonymous manifest checks fail.
GitHub package webhook configured to https://deploy-webhook.z8-time.app/webhooks/github using the same webhook secret.
DNS for deploy-webhook.z8-time.app pointing at the cluster ingress.
```

- [ ] **Step 7: Commit final verification notes if any docs changed**

```bash
git add docs/superpowers/specs/2026-05-08-k8s-image-webhook-rollout-design.md
git commit -m "docs: update deploy webhook rollout design"
```

Skip this commit if no docs changed.

## Self-Review

- Spec coverage: The plan covers in-cluster receiver, signature verification, allowlisted packages, SHA tags, app image gating, migrations before app rollout, docs and marketing independent rollout, ConfigMap state, RBAC, ingress, tests, and verification.
- Placeholder scan: No placeholder tasks remain. Every task names concrete files, commands, expected results, and code or manifest content.
- Type consistency: `ImageObservation`, package names, deployment names, and image references are consistent across parser, registry, reconciler, Docker, and Kubernetes manifests.
- Scope check: The plan is focused on one deploy webhook subsystem. GitHub webhook creation and secret provisioning remain explicitly operational setup, not repository implementation.
