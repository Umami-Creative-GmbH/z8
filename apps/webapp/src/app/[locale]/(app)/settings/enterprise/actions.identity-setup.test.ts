import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "actions.ts"), "utf8");

describe("enterprise identity setup action contracts", () => {
	const expectedExports = [
		"getEnterpriseIdentitySetupAction",
		"updateEnterpriseIdentityProviderAction",
		"registerEnterpriseIdentitySSOProviderAction",
		"recordEnterpriseIdentitySsoTestAction",
		"generateEnterpriseIdentityScimTokenAction",
		"refreshEnterpriseIdentityScimStatusAction",
		"updateEnterpriseIdentityAccessPolicyAction",
		"activateEnterpriseIdentitySetupAction",
	];

	it("exports the setup wizard server actions", () => {
		for (const actionName of expectedExports) {
			expect(source).toContain(`export async function ${actionName}`);
		}
	});

	it("gates actions through enterprise organization settings authorization", () => {
		expect(source).toContain("requireEnterpriseOrgAdmin()");
		expect(source).toContain("canManageCurrentOrganizationSettings(");
		expect(source).not.toContain('authContext.employee?.role !== "admin"');
	});

	it("keeps all setup persistence organization-scoped", () => {
		expect(source).toContain("enterpriseIdentitySetup.organizationId");
		expect(source).toContain("organizationId");
	});

	it("uses Better Auth SSO and SCIM APIs", () => {
		expect(source).toContain("registerSSOProvider");
		expect(source).toContain("generateSCIMToken");
		expect(source).toContain("listSCIMProviderConnections");
	});

	it("maps Better Auth identity errors before returning them", () => {
		expect(source).toContain("mapBetterAuthIdentityError");
	});

	it("does not modify or import generated auth schema", () => {
		expect(source).not.toContain("@/db/auth-schema");
		expect(source).not.toContain("../auth-schema");
	});

	it("keeps default role template as a top-level setup column", () => {
		expect(source).toContain("defaultRoleTemplateId");
		expect(source).not.toMatch(/pendingEnforcement\s*=\s*{[\s\S]*?defaultRoleTemplateId:/);
	});
});
