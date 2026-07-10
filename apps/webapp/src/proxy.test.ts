import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

	it("covers authenticated API routes for centralized app-access enforcement", () => {
		expect(matchesProxy("/api/time-entries")).toBe(true);
		expect(matchesProxy("/api/mobile/home")).toBe(true);
	});

	it("checks current app permissions before authenticated requests continue", () => {
		const source = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");

		expect(source).toContain("validateAppAccess");
		expect(source).toContain("auth.api.getSession");
		expect(source).toContain('pathname.startsWith("/api/")');
		expect(source).toContain('pathname !== "/api/auth/context"');
		expect(source).toContain('pathname.startsWith("/api/calendar/ics/")');
	});
});
