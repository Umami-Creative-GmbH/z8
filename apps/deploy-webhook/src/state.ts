import { ApiException, CoreV1Api, KubeConfig, type V1ConfigMap } from "@kubernetes/client-node";
import type { ImageObservation } from "./github-event.js";

export type DeployState = {
  observed: Record<string, ImageObservation["packageName"][]>;
  observedAt: Record<string, Partial<Record<ImageObservation["packageName"], string>>>;
  deployed: Record<string, string>;
  deployedAt: Record<string, string>;
  failures: Record<string, string>;
  latestAcceptedAt: Record<string, string>;
};

type StateStoreOptions = {
  namespace: string;
  name: string;
  coreApi?: CoreV1Api;
};

type VersionedState = {
  state: DeployState;
  resourceVersion?: string;
};

const stateKey = "state.json";
const recordObservationAttempts = 3;
const updateAttempts = 3;

function emptyState(): DeployState {
  return { observed: {}, observedAt: {}, deployed: {}, deployedAt: {}, failures: {}, latestAcceptedAt: {} };
}

function loadKubeConfig(): KubeConfig {
  const kubeConfig = new KubeConfig();
  if (process.env.NODE_ENV === "production") {
    kubeConfig.loadFromCluster();
  } else {
    kubeConfig.loadFromDefault();
  }
  return kubeConfig;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiException && error.code === 404;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiException && error.code === 409;
}

function parseState(raw: string | undefined): DeployState {
  if (!raw) return emptyState();

  const parsed = JSON.parse(raw) as Partial<DeployState>;
  return {
    observed: parsed.observed ?? {},
    observedAt: parsed.observedAt ?? {},
    deployed: parsed.deployed ?? {},
    deployedAt: parsed.deployedAt ?? {},
    failures: parsed.failures ?? {},
    latestAcceptedAt: parsed.latestAcceptedAt ?? {}
  };
}

function deploymentGroup(packageName: ImageObservation["packageName"]): "app" | "docs" | "marketing" {
  if (packageName === "z8-docs") return "docs";
  if (packageName === "z8-marketing") return "marketing";
  return "app";
}

function isOlderThan(left: string, right: string | undefined): boolean {
  return Boolean(right && Date.parse(left) < Date.parse(right));
}

export function addObservation(state: DeployState, observation: ImageObservation): DeployState {
  const group = deploymentGroup(observation.packageName);
  const observedAt = state.observedAt ?? {};
  const latestAcceptedAt = state.latestAcceptedAt ?? {};
  const tagAlreadyObserved = Boolean(state.observed[observation.tag]?.length);
  if (!tagAlreadyObserved && isOlderThan(observation.publishedAt, latestAcceptedAt[group])) return state;

  const packages = new Set(state.observed[observation.tag] ?? []);
  packages.add(observation.packageName);
  const tagObservedAt = observedAt[observation.tag] ?? {};

  return {
    ...state,
    observed: {
      ...state.observed,
      [observation.tag]: Array.from(packages).sort()
    },
    observedAt: {
      ...observedAt,
      [observation.tag]: {
        ...tagObservedAt,
        [observation.packageName]: observation.publishedAt
      }
    },
    latestAcceptedAt: {
      ...latestAcceptedAt,
      [group]: isOlderThan(observation.publishedAt, latestAcceptedAt[group])
        ? latestAcceptedAt[group]
        : observation.publishedAt
    }
  };
}

export class StateStore {
  private readonly namespace: string;
  private readonly name: string;
  private readonly coreApi: CoreV1Api;

  constructor({ namespace, name, coreApi }: StateStoreOptions) {
    this.namespace = namespace;
    this.name = name;
    this.coreApi = coreApi ?? loadKubeConfig().makeApiClient(CoreV1Api);
  }

  async read(): Promise<DeployState> {
    try {
      const configMap = await this.coreApi.readNamespacedConfigMap({ name: this.name, namespace: this.namespace });
      return parseState(configMap.data?.[stateKey]);
    } catch (error) {
      if (isNotFound(error)) return emptyState();
      throw error;
    }
  }

  async write(state: DeployState): Promise<void> {
    const configMap = this.createConfigMap(state);

    try {
      const current = await this.coreApi.readNamespacedConfigMap({ name: this.name, namespace: this.namespace });
      await this.coreApi.replaceNamespacedConfigMap({
        name: this.name,
        namespace: this.namespace,
        body: { ...configMap, metadata: { ...configMap.metadata, resourceVersion: current.metadata?.resourceVersion } }
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.coreApi.createNamespacedConfigMap({ namespace: this.namespace, body: configMap });
    }
  }

  async recordObservation(observation: ImageObservation): Promise<DeployState> {
    return this.update((state) => addObservation(state, observation), recordObservationAttempts);
  }

  async update(mutator: (state: DeployState) => DeployState, attempts = updateAttempts): Promise<DeployState> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const current = await this.readVersioned();
      const state = mutator(current.state);

      try {
        await this.writeVersioned(state, current.resourceVersion);
        return state;
      } catch (error) {
        if (!isConflict(error) || attempt === attempts) throw error;
      }
    }

    throw new Error("Unreachable state update retry state");
  }

  private async readVersioned(): Promise<VersionedState> {
    try {
      const configMap = await this.coreApi.readNamespacedConfigMap({ name: this.name, namespace: this.namespace });
      return { state: parseState(configMap.data?.[stateKey]), resourceVersion: configMap.metadata?.resourceVersion };
    } catch (error) {
      if (isNotFound(error)) return { state: emptyState() };
      throw error;
    }
  }

  private async writeVersioned(state: DeployState, resourceVersion: string | undefined): Promise<void> {
    const configMap = this.createConfigMap(state);

    if (!resourceVersion) {
      await this.coreApi.createNamespacedConfigMap({ namespace: this.namespace, body: configMap });
      return;
    }

    await this.coreApi.replaceNamespacedConfigMap({
      name: this.name,
      namespace: this.namespace,
      body: { ...configMap, metadata: { ...configMap.metadata, resourceVersion } }
    });
  }

  private createConfigMap(state: DeployState): V1ConfigMap {
    return {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: this.name, namespace: this.namespace },
      data: { [stateKey]: JSON.stringify(state, null, 2) }
    };
  }
}
