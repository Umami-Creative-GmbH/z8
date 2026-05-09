import type { ImageObservation } from "./github-event.js";

type RegistryClientOptions = {
  registryHost: string;
  owner: string;
  registryUsername?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

const manifestAcceptHeader = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json";

type BearerChallenge = {
  realm?: string;
  service?: string;
  scope?: string;
};

function parseBearerChallenge(header: string | null): BearerChallenge | null {
  if (!header?.startsWith("Bearer ")) return null;

  const params: BearerChallenge = {};
  const matches = header.slice("Bearer ".length).matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)=(?:"([^"]*)"|([^,]*))(?:,|$)/g);

  for (const match of matches) {
    const key = match[1] as keyof BearerChallenge;
    if (key === "realm" || key === "service" || key === "scope") params[key] = match[2] ?? match[3] ?? "";
  }

  return params;
}

export class RegistryClient {
  private readonly registryHost: string;
  private readonly owner: string;
  private readonly registryUsername?: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ registryHost, owner, registryUsername, token, fetchImpl = fetch }: RegistryClientOptions) {
    this.registryHost = registryHost;
    this.owner = owner;
    this.registryUsername = registryUsername;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async hasTag(packageName: ImageObservation["packageName"], tag: string): Promise<boolean> {
    const manifestUrl = `https://${this.registryHost}/v2/${this.owner}/${packageName}/manifests/${tag}`;
    const response = await this.fetchManifest(manifestUrl);

    if (response.status === 401) {
      if (!this.token) {
        throw new Error(`Registry authentication challenge for ${packageName}:${tag} requires a configured token`);
      }
      if (!this.registryUsername) {
        throw new Error(`Registry authentication challenge for ${packageName}:${tag} requires a configured registry username`);
      }

      const registryToken = await this.requestRegistryToken(packageName, tag, response.headers.get("WWW-Authenticate"));
      return this.handleManifestResponse(packageName, tag, await this.fetchManifest(manifestUrl, registryToken));
    }

    return this.handleManifestResponse(packageName, tag, response);
  }

  private fetchManifest(manifestUrl: string, registryToken?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: manifestAcceptHeader };
    if (registryToken) headers.Authorization = `Bearer ${registryToken}`;

    return this.fetchImpl(manifestUrl, { method: "HEAD", headers });
  }

  private async requestRegistryToken(
    packageName: ImageObservation["packageName"],
    tag: string,
    challengeHeader: string | null
  ): Promise<string> {
    const challenge = parseBearerChallenge(challengeHeader);
    if (!challenge?.realm) throw new Error(`Registry authentication challenge for ${packageName}:${tag} is missing realm`);

    const url = new URL(challenge.realm);
    if (challenge.service) url.searchParams.set("service", challenge.service);
    if (challenge.scope) url.searchParams.set("scope", challenge.scope);

    const response = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Basic ${Buffer.from(`${this.registryUsername}:${this.token}`).toString("base64")}` }
    });

    if (!response.ok) {
      throw new Error(`Registry token request failed for ${packageName}:${tag} with status ${response.status}`);
    }

    const body = (await response.json()) as { token?: unknown; access_token?: unknown };
    const registryToken = typeof body.token === "string" ? body.token : body.access_token;
    if (typeof registryToken !== "string" || registryToken.length === 0) {
      throw new Error(`Registry token response for ${packageName}:${tag} did not include a token`);
    }

    return registryToken;
  }

  private handleManifestResponse(packageName: ImageObservation["packageName"], tag: string, response: Response): boolean {
    if (response.ok) return true;
    if (response.status === 404) return false;

    throw new Error(`Registry lookup failed for ${packageName}:${tag} with status ${response.status}`);
  }
}
