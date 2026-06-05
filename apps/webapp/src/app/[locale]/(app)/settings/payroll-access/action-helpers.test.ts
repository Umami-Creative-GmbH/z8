import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/effect/errors";
import { assertPayrollOfficerSettingsContext } from "./action-helpers";

describe("assertPayrollOfficerSettingsContext", () => {
	it("allows active-org users with CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: true,
				},
				"read",
			),
		).not.toThrow();
	});

	it("rejects users without CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: false,
				},
				"write",
			),
		).toThrow(AuthorizationError);
	});
});
