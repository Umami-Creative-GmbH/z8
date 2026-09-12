import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
	default: vi.fn(() => () => NextResponse.next()),
}));
vi.mock("@/lib/setup/config-cache", () => ({
	isPlatformConfigured: async () => false,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	classifyDomainHost: () => null,
	resolvePlatformOrganization: vi.fn(),
}));

import { NextRequest, NextResponse } from "next/server";
import { config, proxy } from "./proxy";

function matchesProxy(pathname: string) {
	return config.matcher.some((matcher) =>
		new RegExp(`^${matcher}$`).test(pathname),
	);
}

describe("proxy matcher", () => {
	it("rewrites setup code requests directly to the cookie exchange without rendering the secret URL", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/de/setup?code=operator-secret"),
		);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://app.example.com/api/setup/authorize?code=operator-secret&locale=de",
		);
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("cache-control")).toContain("no-store");
	});
	it("preserves the three-letter Swiss German setup locale", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/gsw/setup?code=operator-secret"),
		);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://app.example.com/api/setup/authorize?code=operator-secret&locale=gsw",
		);
	});
	it.each(["/setup", "/de/setup", "/gsw/setup"])(
		"keeps clean setup pages public and non-cacheable: %s",
		async (path) => {
			const response = await proxy(
				new NextRequest(`https://app.example.com${path}`),
			);
			expect(response.headers.get("location")).toBeNull();
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cache-control")).toContain("no-store");
		},
	);

	it("does not locale-prefix PostHog ingest proxy requests", () => {
		expect(matchesProxy("/ingest/flags")).toBe(false);
		expect(matchesProxy("/ingest/static/array.js")).toBe(false);
	});

	it("covers API routes", () => {
		expect(matchesProxy("/api/time-entries")).toBe(true);
		expect(matchesProxy("/api/mobile/home")).toBe(true);
	});

	it("passes API requests to route handlers without page middleware", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/api/time-entries", {
				headers: { authorization: "Bearer session-token" },
			}),
		);
		expect(response.headers.get("x-middleware-next")).toBe("1");
		expect(response.headers.get("location")).toBeNull();
	});
});
