import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
	default: vi.fn(() => vi.fn()),
}));

import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

function matchesProxy(pathname: string) {
	return config.matcher.some((matcher) =>
		new RegExp(`^${matcher}$`).test(pathname),
	);
}

describe("proxy matcher", () => {
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
