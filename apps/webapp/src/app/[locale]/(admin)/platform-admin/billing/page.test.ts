import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform admin billing page translations", () => {
	it("does not render billing dashboard copy as hardcoded literals", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("getTranslate");
		for (const literal of [
			"Billing Dashboard",
			"Monitor subscriptions, revenue, and payment status",
			"Revenue Metrics",
			"Recent Subscriptions",
			"Monthly recurring revenue",
			"Active Subscriptions",
			"No subscriptions yet",
		]) {
			expect(source).not.toContain(`>${literal}<`);
		}
	});
});
