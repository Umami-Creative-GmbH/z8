import type { ImageObservation } from "./github-event.js";

type RegistryClientOptions = {
  registryHost: string;
  owner: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

const manifestAcceptHeader = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json";

export class RegistryClient {
  private readonly registryHost: string;
  private readonly owner: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ registryHost, owner, token, fetchImpl = fetch }: RegistryClientOptions) {
    this.registryHost = registryHost;
    this.owner = owner;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async hasTag(packageName: ImageObservation["packageName"], tag: string): Promise<boolean> {
    const headers: Record<string, string> = { Accept: manifestAcceptHeader };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await this.fetchImpl(
      `https://${this.registryHost}/v2/${this.owner}/${packageName}/manifests/${tag}`,
      { method: "HEAD", headers }
    );

    if (response.ok) return true;
    if (response.status === 404) return false;

    throw new Error(`Registry lookup failed for ${packageName}:${tag} with status ${response.status}`);
  }
}
