import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/effect/runtime", () => ({
	AppLayer: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

import { assertPayrollConfigForMappingMutation, assertSingleLegalEntityPayrollFilter } from "./actions";

describe("assertSingleLegalEntityPayrollFilter", () => {
	it("accepts employees from the selected legal entity", () => {
		expect(() =>
			assertSingleLegalEntityPayrollFilter({
				selectedLegalEntityId: "entity-a",
				employees: [{ id: "emp-1", legalEntityId: "entity-a" }],
			}),
		).not.toThrow();
	});

	it("rejects mixed legal entity employee filters", () => {
		expect(() =>
			assertSingleLegalEntityPayrollFilter({
				selectedLegalEntityId: "entity-a",
				employees: [{ id: "emp-1", legalEntityId: "entity-b" }],
			}),
		).toThrow("Payroll exports can include employees from only one legal entity.");
	});
});

describe("assertPayrollConfigForMappingMutation", () => {
	it("accepts payroll configs from the selected legal entity", () => {
		expect(() =>
			assertPayrollConfigForMappingMutation({
				config: {
					organizationId: "org-1",
					legalEntityId: "entity-a",
				},
				organizationId: "org-1",
				legalEntityId: "entity-a",
			}),
		).not.toThrow();
	});

	it("rejects payroll configs from a different legal entity in the same organization", () => {
		expect(() =>
			assertPayrollConfigForMappingMutation({
				config: {
					organizationId: "org-1",
					legalEntityId: "entity-b",
				},
				organizationId: "org-1",
				legalEntityId: "entity-a",
			}),
		).toThrow("Configuration not found or access denied");
	});
});
