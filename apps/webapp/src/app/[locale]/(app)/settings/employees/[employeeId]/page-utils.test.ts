import { describe, expect, it } from "vitest";
import { getEmployeeDetailPermissions, shouldUseLegalEntitySelectionContext } from "./page-utils";

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

	it("skips legal entity selection context for manager fallback outside entity admin grants", () => {
		expect(
			shouldUseLegalEntitySelectionContext({
				accessTier: "entityAdmin",
				employeeLegalEntityId: "entity-b",
				allowedLegalEntityIds: ["entity-a"],
			}),
		).toBe(false);
	});
});
