/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseIdentitySetupResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";
import type { OrganizationBranding } from "@/lib/domain";
import { DomainsAndBrandingTabs } from "./domains-branding-tabs";
import { IdentitySetupWizard } from "./identity-setup-wizard";

const {
	activateEnterpriseIdentitySetupActionMock,
	generateEnterpriseIdentityScimTokenActionMock,
	recordEnterpriseIdentitySsoTestActionMock,
	refreshEnterpriseIdentityScimStatusActionMock,
	registerEnterpriseIdentitySSOProviderActionMock,
	updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderActionMock,
} = vi.hoisted(() => ({
	activateEnterpriseIdentitySetupActionMock: vi.fn(),
	generateEnterpriseIdentityScimTokenActionMock: vi.fn(),
	recordEnterpriseIdentitySsoTestActionMock: vi.fn(),
	refreshEnterpriseIdentityScimStatusActionMock: vi.fn(),
	registerEnterpriseIdentitySSOProviderActionMock: vi.fn(),
	updateEnterpriseIdentityAccessPolicyActionMock: vi.fn(),
	updateEnterpriseIdentityProviderActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("./branding-form", () => ({
	BrandingForm: () => <div>Branding form</div>,
}));

vi.mock("./domain-management", () => ({
	DomainManagement: () => <div>Domain management</div>,
}));

vi.mock("./social-oauth-management", () => ({
	SocialOAuthManagement: () => <div>Social OAuth management</div>,
}));

vi.mock("./sso-provider-management", () => ({
	SSOProviderManagement: () => <div>SSO provider management</div>,
}));

vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	activateEnterpriseIdentitySetupAction: activateEnterpriseIdentitySetupActionMock,
	generateEnterpriseIdentityScimTokenAction: generateEnterpriseIdentityScimTokenActionMock,
	recordEnterpriseIdentitySsoTestAction: recordEnterpriseIdentitySsoTestActionMock,
	refreshEnterpriseIdentityScimStatusAction: refreshEnterpriseIdentityScimStatusActionMock,
	registerEnterpriseIdentitySSOProviderAction: registerEnterpriseIdentitySSOProviderActionMock,
	updateEnterpriseIdentityAccessPolicyAction: updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderAction: updateEnterpriseIdentityProviderActionMock,
}));

const wizardPath = join(
	process.cwd(),
	"src/components/settings/enterprise/identity-setup-wizard.tsx",
);

const roleTemplate = {
	id: "role-template-1",
	organizationId: "org_123",
	name: "Employee default",
	description: "Default employee permissions",
	isGlobal: false,
	employeeRole: "employee",
};

function setupResponse(overrides: Partial<EnterpriseIdentitySetupResponse["state"]> = {}) {
	const state: EnterpriseIdentitySetupResponse["state"] = {
		organizationId: "org_123",
		currentStep: "provider",
		provider: null,
		domain: null,
		ssoTest: {
			status: "not-run",
			testEmail: null,
			providerId: null,
			checkedAt: null,
			error: null,
		},
		scim: {
			enabled: false,
			providerId: null,
			verified: false,
			lastCheckedAt: null,
			error: null,
		},
		enforcement: {
			ssoRequired: false,
			domainRestrictionEnabled: false,
			inviteRestrictionEnabled: false,
		},
		activatedAt: null,
		...overrides,
	};

	return {
		state,
		defaultRoleTemplateId: "role-template-1",
		roleTemplates: [roleTemplate],
		scimConnection: null,
	};
}

function configuredSetup(overrides: Partial<EnterpriseIdentitySetupResponse["state"]> = {}) {
	return setupResponse({
		currentStep: "review",
		provider: {
			preset: "generic",
			protocol: "oidc",
			providerId: "acme-okta",
		},
		domain: {
			domain: "example.com",
			verified: false,
		},
		...overrides,
	});
}

function renderWizard(initialSetup = setupResponse()) {
	return render(<IdentitySetupWizard initialSetup={initialSetup} organizationId="org_123" />);
}

function renderDomainsTabs() {
	const branding: OrganizationBranding = {
		appName: "Z8",
		logoUrl: null,
		primaryColor: "#2563eb",
		accentColor: "#0f172a",
		backgroundImageUrl: null,
	};

	return render(
		<DomainsAndBrandingTabs
			initialDomains={[]}
			initialBranding={branding}
			initialProviders={[]}
			initialSocialOAuthConfigs={[]}
			organizationId="org_123"
		/>,
	);
}

function setInput(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
	vi.clearAllMocks();
	updateEnterpriseIdentityProviderActionMock.mockResolvedValue(configuredSetup());
	registerEnterpriseIdentitySSOProviderActionMock.mockResolvedValue(
		configuredSetup({ currentStep: "ssoTest" }),
	);
	recordEnterpriseIdentitySsoTestActionMock.mockResolvedValue(
		configuredSetup({
			currentStep: "scim",
			ssoTest: {
				status: "passed",
				testEmail: "admin@example.com",
				providerId: "acme-okta",
				checkedAt: "2026-01-01T00:00:00.000Z",
				error: null,
			},
		}),
	);
	generateEnterpriseIdentityScimTokenActionMock.mockResolvedValue({
		providerId: "acme-okta",
		scimToken: "scim_token_returned_once",
		baseUrl: "/api/auth/scim/v2",
	});
	refreshEnterpriseIdentityScimStatusActionMock.mockResolvedValue({
		checkedAt: "2026-01-01T00:00:00.000Z",
		verified: true,
		error: null,
	});
	updateEnterpriseIdentityAccessPolicyActionMock.mockResolvedValue(
		configuredSetup({ currentStep: "review" }),
	);
	activateEnterpriseIdentitySetupActionMock.mockResolvedValue(
		configuredSetup({ activatedAt: "2026-01-01T00:00:00.000Z" }),
	);
});

describe("IdentitySetupWizard behavior", () => {
	it("renders all seven steps and accessible controls", () => {
		renderWizard();

		expect(screen.getAllByText("Provider").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Domain").length).toBeGreaterThan(0);
		expect(screen.getAllByText("SSO Configuration").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
		expect(screen.getAllByText("SCIM Provisioning").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Access Policy").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Review & Activate").length).toBeGreaterThan(0);

		expect(screen.getByLabelText("Provider preset")).toBeTruthy();
		expect(screen.getByLabelText("Protocol")).toBeTruthy();
		expect(screen.getByLabelText("Provider ID")).toBeTruthy();
		expect(screen.getByLabelText("Email domain")).toBeTruthy();
		expect(screen.getByLabelText("Issuer")).toBeTruthy();
		expect(screen.getByLabelText("Client ID")).toBeTruthy();
		expect(screen.getByLabelText("Client secret")).toBeTruthy();
		expect(screen.getByLabelText("Test user email")).toBeTruthy();
		expect(screen.getByLabelText("Failure note")).toBeTruthy();
		expect(screen.getByLabelText("Default role template")).toBeTruthy();
	});

	it("saves provider setup with the expected payload", async () => {
		renderWizard();

		setInput("Provider ID", "acme-okta");
		setInput("Email domain", "example.com");
		fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

		await waitFor(() => {
			expect(updateEnterpriseIdentityProviderActionMock).toHaveBeenCalledWith({
				preset: "generic",
				protocol: "oidc",
				providerId: "acme-okta",
				domain: "example.com",
				currentStep: "domain",
			});
		});
	});

	it("registers OIDC SSO with provider, domain, issuer, and client credentials", async () => {
		renderWizard(configuredSetup());

		setInput("Issuer", "https://idp.example.com");
		setInput("Client ID", "client_123");
		setInput("Client secret", "secret_123");
		fireEvent.click(screen.getByRole("button", { name: "Register SSO provider" }));

		await waitFor(() => {
			expect(registerEnterpriseIdentitySSOProviderActionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					protocol: "oidc",
					providerId: "acme-okta",
					domain: "example.com",
					issuer: "https://idp.example.com",
					clientId: "client_123",
					clientSecret: "secret_123",
				}),
			);
		});
	});

	it("records a passed live SSO test", async () => {
		renderWizard(configuredSetup());

		setInput("Test user email", "admin@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Record pass" }));

		await waitFor(() => {
			expect(recordEnterpriseIdentitySsoTestActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
				testEmail: "admin@example.com",
				status: "passed",
				error: null,
			});
		});
	});

	it("shows the SCIM token only after token generation returns it", async () => {
		renderWizard(configuredSetup());

		expect(screen.queryByText("scim_token_returned_once")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Generate token" }));

		await waitFor(() => {
			expect(generateEnterpriseIdentityScimTokenActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
				defaultRoleTemplateId: "role-template-1",
			});
		});

		expect(screen.getByText("This token is shown once")).toBeTruthy();
		expect(screen.getByText("scim_token_returned_once")).toBeTruthy();
	});

	it("keeps SCIM status pending until provisioning activity is observed", async () => {
		renderWizard(
			configuredSetup({
				scim: {
					enabled: true,
					providerId: "acme-okta",
					verified: false,
					lastCheckedAt: null,
					error: null,
				},
			}),
		);

		expect(
			screen.getByText(
				"SCIM verification updates after your identity provider sends a test user or group change.",
			),
		).toBeTruthy();
		expect(screen.getByText("No provisioning activity yet")).toBeTruthy();
		expect(screen.queryByText("Provisioning activity observed")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

		await waitFor(() => {
			expect(refreshEnterpriseIdentityScimStatusActionMock).toHaveBeenCalled();
		});

		expect(screen.getByText("Provisioning activity observed")).toBeTruthy();
		expect(screen.queryByText("No provisioning activity yet")).toBeNull();
	});

	it("saves access policy with top-level defaultRoleTemplateId", async () => {
		renderWizard(configuredSetup());

		fireEvent.click(screen.getByRole("button", { name: "Save access policy" }));

		await waitFor(() => {
			expect(updateEnterpriseIdentityAccessPolicyActionMock).toHaveBeenCalledWith({
				ssoRequired: false,
				domainRestrictionEnabled: false,
				inviteRestrictionEnabled: false,
				defaultRoleTemplateId: "role-template-1",
			});
		});

		const payload = updateEnterpriseIdentityAccessPolicyActionMock.mock.calls[0][0];
		expect(payload.enforcement).toBeUndefined();
	});

	it("guards activation until readiness checks pass", () => {
		const { rerender } = render(
			<IdentitySetupWizard initialSetup={configuredSetup()} organizationId="org_123" />,
		);

		expect(
			screen.getByRole("button", { name: "Activate enterprise identity" }).hasAttribute("disabled"),
		).toBe(true);

		rerender(
			<IdentitySetupWizard
				key="ready"
				initialSetup={configuredSetup({
					domain: {
						domain: "example.com",
						verified: true,
					},
					ssoTest: {
						status: "passed",
						testEmail: "admin@example.com",
						providerId: "acme-okta",
						checkedAt: "2026-01-01T00:00:00.000Z",
						error: null,
					},
				})}
				organizationId="org_123"
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Activate enterprise identity" }).hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("DomainsAndBrandingTabs behavior", () => {
	it("renders a usable guided setup link in the SSO tab", () => {
		renderDomainsTabs();

		const ssoTab = screen.getByRole("tab", { name: "SSO Providers" });
		fireEvent.pointerDown(ssoTab, { button: 0, ctrlKey: false });
		fireEvent.keyDown(ssoTab, { key: "Enter" });
		fireEvent.click(ssoTab);

		expect(screen.getByRole("link", { name: /guided setup/i }).getAttribute("href")).toBe(
			"/settings/enterprise/identity-setup",
		);
	});
});

describe("IdentitySetupWizard source supplements", () => {
	it("keeps default role template outside the enforcement JSON", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("defaultRoleTemplateId");
		expect(source).toContain("setDefaultRoleTemplateId");
		expect(source).not.toContain("setup.enforcement.defaultRoleTemplateId");
	});

	it("explains that SCIM verification depends on IdP provisioning activity", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain(
			"SCIM verification updates after your identity provider sends a test user or group change.",
		);
		expect(source).toContain("No provisioning activity yet");
		expect(source).toContain("Provisioning activity observed");
	});
});
