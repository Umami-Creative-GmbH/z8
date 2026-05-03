import { describe, expect, it, vi } from "vitest";
import { assertSameLegalEntityTarget } from "./holiday-scope";

vi.mock("../employees/employee-action-utils", () => ({
	getEmployeeSettingsActorContext: vi.fn(),
	getManagedEmployeeIdsForSettingsActor: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
	},
}));

describe("holiday scope helpers", () => {
	it("rejects assigning a holiday to an employee in another legal entity", () => {
		expect(() =>
			assertSameLegalEntityTarget({
				holidayLegalEntityId: "entity-a",
				targetLegalEntityId: "entity-b",
				targetLabel: "employee",
			}),
		).toThrow("The selected employee belongs to a different legal entity.");
	});
});
