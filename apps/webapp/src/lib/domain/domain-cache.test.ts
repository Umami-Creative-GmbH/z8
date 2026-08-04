import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/env", () => ({
	env: { DOMAIN_CACHE_TTL_SECONDS: "2" },
}));

import { domainCache } from "./domain-cache";

describe("domainCache", () => {
	afterEach(() => {
		domainCache.clear();
		vi.useRealTimers();
	});

	test("keeps entries through the configured TTL boundary and expires them after it", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const context = {
			organizationId: "org-1",
		} as Parameters<typeof domainCache.set>[1];
		domainCache.set("example.com", context);

		vi.advanceTimersByTime(2_000);
		expect(domainCache.get("example.com")).toBe(context);

		vi.advanceTimersByTime(1);
		expect(domainCache.get("example.com")).toBeNull();
	});
});
