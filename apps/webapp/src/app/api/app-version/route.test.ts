import { afterEach, describe, expect, it, vi } from "vitest";

async function importRoute(buildHash: string | undefined) {
	vi.resetModules();
	vi.stubEnv("NEXT_PUBLIC_BUILD_HASH", buildHash);

	return import("./route");
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("GET /api/app-version", () => {
	it("returns the fallback build hash when no build hash is configured", async () => {
		const { GET } = await importRoute(undefined);
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ buildHash: "development" });
	});

	it("returns the configured build hash", async () => {
		const { GET } = await importRoute("build_123");
		const response = await GET();
		const body = await response.json();

		expect(body).toEqual({ buildHash: "build_123" });
	});

	it("prevents caching stale deployment metadata", async () => {
		const { GET } = await importRoute(undefined);
		const response = await GET();

		expect(response.headers.get("cache-control")).toBe(
			"no-store, no-cache, must-revalidate, proxy-revalidate",
		);
		expect(response.headers.get("pragma")).toBe("no-cache");
		expect(response.headers.get("expires")).toBe("0");
	});
});
