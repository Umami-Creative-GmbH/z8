import { readFileSync } from "node:fs";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { rejectOrganizationSsoApprovalUpdate } from "./organization-sso-approval-update-guard";

describe("rejectOrganizationSsoApprovalUpdate", () => {
	it("refuses an SSO approval setting change through Better Auth's organization update", () => {
		expect(() => rejectOrganizationSsoApprovalUpdate({ ssoRequiresApproval: false })).toThrow(
			APIError,
		);
		expect(() =>
			rejectOrganizationSsoApprovalUpdate({ name: "Renamed", ssoRequiresApproval: true }),
		).toThrow(APIError);
	});

	it("admits updates that leave the SSO approval setting alone", () => {
		expect(() => rejectOrganizationSsoApprovalUpdate({ name: "Renamed" })).not.toThrow();
		expect(() =>
			rejectOrganizationSsoApprovalUpdate({ ssoRequiresApproval: undefined }),
		).not.toThrow();
	});

	it("is installed in the organization plugin's update hook", () => {
		const source = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
		expect(source).toMatch(
			/beforeUpdateOrganization: async \(\{ organization \}\) => \{[^}]*rejectOrganizationSsoApprovalUpdate\(organization\);/,
		);
	});
});
