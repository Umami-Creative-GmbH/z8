import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SCIM reactivation identity ordering", () => {
	it("updates approved membership before employee activation in one transaction", () => {
		const source = readFileSync(
			new URL("./scim-provisioning.service.ts", import.meta.url),
			"utf8",
		);
		const implementationStart = source.indexOf(
			"export const SCIMProvisioningServiceLive",
		);
		const reactivation = source.slice(
			source.indexOf("onUserReactivated:", implementationStart),
			source.indexOf("onGroupMembershipChanged:", implementationStart),
		);
		const memberUpdatePosition = reactivation.indexOf(".update(schema.member)");
		const employeeUpdatePosition = reactivation.indexOf(".update(employee)");

		expect(reactivation).toContain("db.transaction(async (tx) =>");
		expect(memberUpdatePosition).toBeGreaterThanOrEqual(0);
		expect(employeeUpdatePosition).toBeGreaterThan(memberUpdatePosition);
		expect(reactivation).not.toContain("Effect.all([");
	});
});
