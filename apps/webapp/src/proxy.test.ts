import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
	default: vi.fn(() => vi.fn()),
}));

import { config } from "./proxy";

function matchesProxy(pathname: string) {
	return config.matcher.some((matcher) => new RegExp(`^${matcher}$`).test(pathname));
}

describe("proxy matcher", () => {
	it("does not locale-prefix PostHog ingest proxy requests", () => {
		expect(matchesProxy("/ingest/flags")).toBe(false);
		expect(matchesProxy("/ingest/static/array.js")).toBe(false);
	});
});
