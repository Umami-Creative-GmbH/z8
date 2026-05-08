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
