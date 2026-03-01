import { describe, expect, it } from "vitest";

import { getNamespacesForRoute } from "@/tolgee/shared";

describe("route namespaces", () => {
	it("loads admin namespaces for /platform-admin", () => {
		expect(getNamespacesForRoute("/platform-admin")).toEqual(["common", "admin"]);
	});

	it("loads admin+settings namespaces for /platform-admin/worker-queue", () => {
		expect(getNamespacesForRoute("/platform-admin/worker-queue")).toEqual([
			"common",
			"admin",
			"settings",
		]);
	});

	it("loads admin+settings namespaces for nested /platform-admin/worker-queue routes", () => {
		expect(getNamespacesForRoute("/platform-admin/worker-queue/jobs/123")).toEqual([
			"common",
			"admin",
			"settings",
		]);
	});

	it("does not match /platform-admin prefix for /platform-administer", () => {
		expect(getNamespacesForRoute("/platform-administer")).toEqual(["common"]);
	});

	it("does not special-case legacy /admin", () => {
		expect(getNamespacesForRoute("/admin")).toEqual(["common"]);
	});
});
