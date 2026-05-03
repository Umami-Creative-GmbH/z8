import { describe, expect, it } from "vitest";
import { getEmployeeDetailPermissions } from "./page-utils";

describe("getEmployeeDetailPermissions", () => {
	it("preserves manager edit permissions for managers with legal entity admin grants", () => {
		expect(
			getEmployeeDetailPermissions({
				accessTier: "entityAdmin",
				employeeRole: "manager",
			}),
		).toMatchObject({
			canManageEmployeeDetails: true,
			canManageSkills: true,
			canManageRates: true,
			canMoveLegalEntity: false,
		});
	});
});
