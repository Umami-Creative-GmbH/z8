import { describe, expect, it } from "vitest";
import {
	buildCreateCustomerInput,
	requiresScopedProjectSelection,
} from "./customer-dialog.helpers";

describe("customer dialog helpers", () => {
	it("requires a project selection for manager creates only", () => {
		expect(requiresScopedProjectSelection("manager", false)).toBe(true);
		expect(requiresScopedProjectSelection("manager", true)).toBe(false);
		expect(requiresScopedProjectSelection("orgAdmin", false)).toBe(false);
	});

	it("builds a create payload with the selected scoped project id", () => {
		expect(
			buildCreateCustomerInput("org-1", {
				projectId: "project-1",
				name: "Scoped Customer",
				address: "",
				vatId: "",
				email: "",
				contactPerson: "",
				phone: "",
				website: "",
			}),
		).toEqual({
			organizationId: "org-1",
			projectId: "project-1",
			name: "Scoped Customer",
			address: undefined,
			vatId: undefined,
			email: undefined,
			contactPerson: undefined,
			phone: undefined,
			website: undefined,
		});
	});
});
