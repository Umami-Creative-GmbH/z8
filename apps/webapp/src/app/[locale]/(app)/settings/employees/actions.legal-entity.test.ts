import { describe, expect, it, vi } from "vitest";
import { assertCanAssignEmployeeLegalEntity } from "./actions";

vi.mock("./employee-mutations.actions", () => ({
	assignManagersAction: vi.fn(),
	createEmployeeAction: vi.fn(),
	updateEmployeeAction: vi.fn(),
	updateOwnProfileAction: vi.fn(),
}));

vi.mock("./employee-queries.actions", () => ({
	getEmployeeAction: vi.fn(),
	getEmployeesByIdsAction: vi.fn(),
	listEmployeesAction: vi.fn(),
	listEmployeesForSelectAction: vi.fn(),
}));

describe("assertCanAssignEmployeeLegalEntity", () => {
	it("allows org admins to assign any entity in the organization", () => {
		expect(() =>
			assertCanAssignEmployeeLegalEntity({
				isOrgAdmin: true,
				currentLegalEntityId: "entity-a",
				nextLegalEntityId: "entity-b",
				allowedLegalEntityIds: [],
			}),
		).not.toThrow();
	});

	it("prevents entity admins from moving employees between legal entities", () => {
		expect(() =>
			assertCanAssignEmployeeLegalEntity({
				isOrgAdmin: false,
				currentLegalEntityId: "entity-a",
				nextLegalEntityId: "entity-b",
				allowedLegalEntityIds: ["entity-a"],
			}),
		).toThrow("Only organization admins can move employees between legal entities.");
	});
});
