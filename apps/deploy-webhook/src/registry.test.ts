import { describe, expect, it, vi } from "vitest";
import { RegistryClient } from "./registry.js";

describe("RegistryClient", () => {
  it("returns true when the manifest tag exists", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });

    await expect(client.hasTag("z8-webapp", "sha-abcdef1")).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ghcr.io/v2/umami-creative-gmbh/z8-webapp/manifests/sha-abcdef1",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("returns false when the manifest tag is missing", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });

    await expect(client.hasTag("z8-worker", "sha-abcdef1")).resolves.toBe(false);
  });

  it("sends a bearer token and manifest accept header when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const client = new RegistryClient({
      registryHost: "ghcr.io",
      owner: "umami-creative-gmbh",
      token: "registry-token",
      fetchImpl
    });

    await client.hasTag("z8-docs", "sha-abcdef1");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ghcr.io/v2/umami-creative-gmbh/z8-docs/manifests/sha-abcdef1",
      {
        method: "HEAD",
        headers: {
          Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
          Authorization: "Bearer registry-token"
        }
      }
    );
  });

  it("throws when the registry returns an unexpected non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });

    await expect(client.hasTag("z8-marketing", "sha-abcdef1")).rejects.toThrow(
      "Registry lookup failed for z8-marketing:sha-abcdef1 with status 500"
    );
  });
});
