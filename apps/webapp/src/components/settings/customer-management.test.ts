import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CustomerManagement", () => {
	it("guards manager create actions when there are no scoped projects", () => {
		const source = readFileSync(new URL("./customer-management.tsx", import.meta.url), "utf8");

		expect(source.includes("canCreateCustomer")).toBe(true);
		expect(source.includes("No managed projects available")).toBe(true);
		expect(source.includes("disabled={!canCreateCustomer}")).toBe(true);
	});
});
