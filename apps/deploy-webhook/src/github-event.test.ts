import { describe, expect, it } from "vitest";
import { parseGitHubPackageEvent } from "./github-event.js";

const basePayload = {
  action: "published",
  package: {
    package_type: "container",
    name: "z8-docs",
    owner: { login: "umami-creative-gmbh" },
    package_version: {
      created_at: "2026-05-08T10:00:00Z",
      container_metadata: { tag: { name: "sha-abcdef1" } }
    }
  }
};

describe("parseGitHubPackageEvent", () => {
  it("extracts an allowlisted SHA image observation", () => {
    expect(parseGitHubPackageEvent(basePayload, "umami-creative-gmbh")).toEqual({
      packageName: "z8-docs",
      publishedAt: "2026-05-08T10:00:00.000Z",
      tag: "sha-abcdef1"
    });
  });

  it("ignores package events without a valid package version creation timestamp", () => {
    const missingTimestampPayload = {
      ...basePayload,
      package: {
        ...basePayload.package,
        package_version: { container_metadata: { tag: { name: "sha-abcdef1" } } }
      }
    };
    const invalidTimestampPayload = {
      ...basePayload,
      package: {
        ...basePayload.package,
        package_version: { created_at: "not-a-date", container_metadata: { tag: { name: "sha-abcdef1" } } }
      }
    };

    expect(parseGitHubPackageEvent(missingTimestampPayload, "umami-creative-gmbh")).toBeNull();
    expect(parseGitHubPackageEvent(invalidTimestampPayload, "umami-creative-gmbh")).toBeNull();
  });

  it("ignores unrelated owners", () => {
    const payload = { ...basePayload, package: { ...basePayload.package, owner: { login: "other" } } };
    expect(parseGitHubPackageEvent(payload, "umami-creative-gmbh")).toBeNull();
  });

  it("ignores non-published package actions", () => {
    const payload = { ...basePayload, action: "deleted" };
    expect(parseGitHubPackageEvent(payload, "umami-creative-gmbh")).toBeNull();
  });

  it("ignores non-container package types", () => {
    const payload = { ...basePayload, package: { ...basePayload.package, package_type: "npm" } };
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
