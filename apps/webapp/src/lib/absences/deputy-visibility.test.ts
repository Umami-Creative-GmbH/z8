import { describe, expect, it } from "vitest";
import { canOpenEmployeeProfile } from "./deputy-visibility";

describe("canOpenEmployeeProfile", () => {
	it("lets an organization admin open every profile", () => {
		expect(
			canOpenEmployeeProfile({
				viewerIsOrganizationAdmin: true,
				viewerRole: "employee",
				managesEmployee: false,
			}),
		).toBe(true);
	});

	it("lets a manager open only the profiles of employees they manage", () => {
		const manager = { viewerIsOrganizationAdmin: false, viewerRole: "manager" as const };
		expect(canOpenEmployeeProfile({ ...manager, managesEmployee: true })).toBe(true);
		expect(canOpenEmployeeProfile({ ...manager, managesEmployee: false })).toBe(false);
	});

	it("never lets an employee open a profile, even of someone linked to them", () => {
		expect(
			canOpenEmployeeProfile({
				viewerIsOrganizationAdmin: false,
				viewerRole: "employee",
				managesEmployee: true,
			}),
		).toBe(false);
	});
});
