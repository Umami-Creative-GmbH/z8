import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/effect/runtime", () => ({
	AppLayer: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

import { assertSingleLegalEntityPayrollFilter } from "./actions";

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
