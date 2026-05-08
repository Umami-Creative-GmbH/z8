import { ApiException, CoreV1Api, KubeConfig, type V1ConfigMap } from "@kubernetes/client-node";
import type { ImageObservation } from "./github-event.js";

export type DeployState = {
  observed: Record<string, ImageObservation["packageName"][]>;
  deployed: Record<string, string>;
  failures: Record<string, string>;
};

type StateStoreOptions = {
  namespace: string;
  name: string;
  coreApi?: CoreV1Api;
};

const stateKey = "state.json";
const recordObservationAttempts = 3;

function emptyState(): DeployState {
  return { observed: {}, deployed: {}, failures: {} };
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
    deployed: parsed.deployed ?? {},
    failures: parsed.failures ?? {}
  };
}

export function addObservation(state: DeployState, observation: ImageObservation): DeployState {
  const packages = new Set(state.observed[observation.tag] ?? []);
  packages.add(observation.packageName);

  return {
    ...state,
    observed: {
      ...state.observed,
      [observation.tag]: Array.from(packages).sort()
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
    for (let attempt = 1; attempt <= recordObservationAttempts; attempt++) {
      const state = addObservation(await this.read(), observation);

      try {
        await this.write(state);
        return state;
      } catch (error) {
        if (!isConflict(error) || attempt === recordObservationAttempts) throw error;
      }
    }

    throw new Error("Unreachable recordObservation retry state");
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
