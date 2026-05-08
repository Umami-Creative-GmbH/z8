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

  it("exchanges a 401 challenge for a scoped registry token and retries", async () => {
    const manifestUrl = "https://ghcr.io/v2/umami-creative-gmbh/z8-docs/manifests/sha-abcdef1";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (url.toString() === manifestUrl && fetchImpl.mock.calls.length === 1) {
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:umami-creative-gmbh/z8-docs:pull"'
          }
        });
      }

      if (url.toString().startsWith("https://ghcr.io/token")) {
        return Response.json({ token: "scoped-registry-token" });
      }

      return new Response(null, { status: 200 });
    });
    const client = new RegistryClient({
      registryHost: "ghcr.io",
      owner: "umami-creative-gmbh",
      token: "configured-token",
      fetchImpl
    });

    await client.hasTag("z8-docs", "sha-abcdef1");

    expect(fetchImpl).toHaveBeenNthCalledWith(1, manifestUrl, {
      method: "HEAD",
      headers: {
        Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"
      }
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aumami-creative-gmbh%2Fz8-docs%3Apull",
      {
        headers: { Authorization: `Basic ${Buffer.from("token:configured-token").toString("base64")}` }
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(3, manifestUrl, {
      method: "HEAD",
      headers: {
        Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        Authorization: "Bearer scoped-registry-token"
      }
    });
  });

  it("throws when the registry challenges but no token is configured", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/name:pull"'
        }
      })
    );
    const client = new RegistryClient({ registryHost: "ghcr.io", owner: "umami-creative-gmbh", fetchImpl });

    await expect(client.hasTag("z8-worker", "sha-abcdef1")).rejects.toThrow(
      "Registry authentication challenge for z8-worker:sha-abcdef1 requires a configured token"
    );
  });

  it("throws when the registry challenge is missing required parameters", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer service="ghcr.io"' } })
    );
    const client = new RegistryClient({
      registryHost: "ghcr.io",
      owner: "umami-creative-gmbh",
      token: "configured-token",
      fetchImpl
    });

    await expect(client.hasTag("z8-migration", "sha-abcdef1")).rejects.toThrow(
      "Registry authentication challenge for z8-migration:sha-abcdef1 is missing realm"
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
