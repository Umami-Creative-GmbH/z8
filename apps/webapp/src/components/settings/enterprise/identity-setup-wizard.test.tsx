import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wizardPath = join(
	process.cwd(),
	"src/components/settings/enterprise/identity-setup-wizard.tsx",
);
const tabsPath = join(
	process.cwd(),
	"src/components/settings/enterprise/domains-branding-tabs.tsx",
);

describe("IdentitySetupWizard source", () => {
	it("contains the operational setup step labels", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("Provider");
		expect(source).toContain("Domain");
		expect(source).toContain("SSO Configuration");
		expect(source).toContain("Test User");
		expect(source).toContain("SCIM Provisioning");
		expect(source).toContain("Access Policy");
		expect(source).toContain("Review & Activate");
	});

	it("uses TanStack Form and React transition pending state", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain('import { useForm } from "@tanstack/react-form"');
		expect(source).toContain("useTransition");
		expect(source).toMatch(/disabled=\{!readiness\.canActivate \|\| isPending\}/);
	});

	it("uses shared readiness checks and SCIM token copy safety text", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("getEnterpriseIdentityReadiness");
		expect(source).toContain("This token is shown once");
	});

	it("uses a mobile-safe readiness rail layout", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("grid gap-4 lg:grid-cols-[220px_1fr]");
		expect(source).toContain("min-w-0");
	});

	it("keeps default role template outside the enforcement JSON", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("defaultRoleTemplateId");
		expect(source).toContain("setDefaultRoleTemplateId");
		expect(source).not.toContain("setup.enforcement.defaultRoleTemplateId");
	});
});

describe("DomainsAndBrandingTabs source", () => {
	it("links the SSO tab to the guided setup wizard", () => {
		const source = readFileSync(tabsPath, "utf8");

		expect(source).toContain("/settings/enterprise/identity-setup");
		expect(source).toContain("Guided setup");
	});
});
