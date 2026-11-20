/* @vitest-environment jsdom */
/* @vitest-environment-options {"url": "https://example.test/"} */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	EnterpriseIdentitySetupResponse,
	SSOProviderResponse,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import type { OrganizationBranding } from "@/lib/domain";
import { DomainsAndBrandingTabs } from "./domains-branding-tabs";
import { IdentitySetupWizard } from "./identity-setup-wizard";

const {
	activateEnterpriseIdentitySetupActionMock,
	recordEnterpriseIdentitySsoTestActionMock,
	refreshEnterpriseIdentityDomainStatusActionMock,
	registerEnterpriseIdentitySSOProviderActionMock,
	requestSSODomainVerificationActionMock,
	updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderActionMock,
	verifySSODomainActionMock,
} = vi.hoisted(() => ({
	activateEnterpriseIdentitySetupActionMock: vi.fn(),
	recordEnterpriseIdentitySsoTestActionMock: vi.fn(),
	refreshEnterpriseIdentityDomainStatusActionMock: vi.fn(),
	registerEnterpriseIdentitySSOProviderActionMock: vi.fn(),
	requestSSODomainVerificationActionMock: vi.fn(),
	updateEnterpriseIdentityAccessPolicyActionMock: vi.fn(),
	updateEnterpriseIdentityProviderActionMock: vi.fn(),
	verifySSODomainActionMock: vi.fn(),
}));

vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});

// A few catalog entries prove the wizard reads its copy through Tolgee keys.
const germanCopy: Record<string, string> = {
	"settings.enterprise.identity.provider.label.providerId": "Anbieter-ID",
	"settings.enterprise.identity.provider.placeholder.providerId": "z. B. acme-okta…",
	"settings.enterprise.identity.sso.label.issuer": "Aussteller",
	"settings.enterprise.tab.sso": "SSO-Anbieter",
};

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, defaultValue?: string, params?: Record<string, string>) => {
			const copy = germanCopy[key] ?? defaultValue ?? key;
			return params
				? Object.entries(params).reduce(
						(result, [name, value]) => result.replaceAll(`{${name}}`, value),
						copy,
					)
				: copy;
		},
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
	DomainManagement: ({ defaultUrls }: { defaultUrls: { canonical: string; alias: string } }) => (
		<div>
			<div>Domain management</div>
			<div>{defaultUrls.canonical}</div>
			<div>{defaultUrls.alias}</div>
		</div>
	),
}));

vi.mock("./social-oauth-management", () => ({
	SocialOAuthManagement: () => <div>Social OAuth management</div>,
}));

vi.mock("./sso-provider-management", () => ({
	SSOProviderManagement: () => <div>SSO provider management</div>,
}));

// The actions are mocked as plain values; the result unwrap is identity here.
vi.mock("@/components/settings/enterprise/action-data", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/settings/enterprise/action-data")>()),
	actionData: <T,>(result: Promise<T>) => result,
}));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	activateEnterpriseIdentitySetupAction: activateEnterpriseIdentitySetupActionMock,
	recordEnterpriseIdentitySsoTestAction: recordEnterpriseIdentitySsoTestActionMock,
	refreshEnterpriseIdentityDomainStatusAction: refreshEnterpriseIdentityDomainStatusActionMock,
	registerEnterpriseIdentitySSOProviderAction: registerEnterpriseIdentitySSOProviderActionMock,
	updateEnterpriseIdentityAccessPolicyAction: updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderAction: updateEnterpriseIdentityProviderActionMock,
	requestSSODomainVerificationAction: requestSSODomainVerificationActionMock,
	verifySSODomainAction: verifySSODomainActionMock,
}));

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
			policy: {
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "role-template-1",
			},
			connection: null,
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
		scimEndpoint: "https://app.example.test/api/auth/scim/v2",
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

function renderWizard(initialSetup = setupResponse(), ssoProviders: SSOProviderResponse[] = []) {
	return render(
		<IdentitySetupWizard
			callbackBaseUrl="https://acme.z8.test"
			initialSetup={initialSetup}
			organizationId="org_123"
			ssoProviders={ssoProviders}
		/>,
	);
}

function registeredProvider(overrides: Partial<SSOProviderResponse> = {}): SSOProviderResponse {
	return {
		id: "sso_1",
		issuer: "https://idp.example.com",
		domain: "example.com",
		providerId: "acme-okta",
		domainVerified: false,
		domainVerificationToken: "token-123",
		organizationId: "org_123",
		userId: null,
		createdAt: null,
		hasOidcConfig: true,
		hasSamlConfig: false,
		...overrides,
	};
}

const verifiedDomain = { domain: "example.com", verified: true };
const passedTest = {
	status: "passed" as const,
	testEmail: "admin@example.com",
	providerId: "acme-okta",
	checkedAt: "2026-01-01T00:00:00.000Z",
	error: null,
};

function stepNav() {
	return within(screen.getByRole("navigation", { name: "Setup steps" }));
}

function openStep(name: RegExp) {
	fireEvent.click(stepNav().getByRole("button", { name }));
}

function stepHeading(name: string) {
	return screen.getByRole("heading", { level: 3, name });
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
			organizationId="org_123"
			defaultUrls={{
				canonical: "https://acme.ui.z8-time.app",
				alias: "https://org_123.ui.z8-time.app",
			}}
		/>,
	);
}

function setInput(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/enterprise/domains");
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
	refreshEnterpriseIdentityDomainStatusActionMock.mockResolvedValue(
		configuredSetup({ currentStep: "ssoTest", domain: verifiedDomain }),
	);
	requestSSODomainVerificationActionMock.mockResolvedValue({
		domainVerificationToken: "token-new",
	});
	verifySSODomainActionMock.mockResolvedValue({ verified: true });
	updateEnterpriseIdentityAccessPolicyActionMock.mockResolvedValue(
		configuredSetup({ currentStep: "review" }),
	);
	activateEnterpriseIdentitySetupActionMock.mockResolvedValue(
		configuredSetup({ activatedAt: "2026-01-01T00:00:00.000Z" }),
	);
});

describe("IdentitySetupWizard behavior", () => {
	it("opens on the first unfinished step and lists every step with its status", () => {
		renderWizard();

		expect(
			screen.getByRole("heading", { level: 2, name: "Set up enterprise sign-in" }),
		).toBeTruthy();
		expect(screen.getByText("0 of 5 required steps done")).toBeTruthy();
		expect(screen.getByText("Not active yet")).toBeTruthy();
		expect(screen.getByText("Step 1 of 7")).toBeTruthy();
		expect(stepHeading("Choose your identity provider")).toBeTruthy();
		expect(screen.getByText("Before you begin")).toBeTruthy();

		const steps = stepNav().getAllByRole("button");
		expect(steps.map((step) => step.getAttribute("aria-label"))).toEqual([
			"Identity provider, In progress",
			"Connect, To do",
			"Verify domain, To do",
			"Test sign-in, To do",
			"Sync users, Optional",
			"Access rules, Optional",
			"Activate, To do",
		]);
		expect(steps[0].getAttribute("aria-current")).toBe("step");

		// Only the active step renders its form; the copy comes from the catalog.
		expect(screen.getByLabelText("Anbieter-ID")).toBeTruthy();
		expect(screen.getByPlaceholderText("z. B. acme-okta…")).toBeTruthy();
		expect(screen.getByLabelText("Work email domain")).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Generic SAML/OIDC" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "OpenID Connect (recommended)" })).toBeTruthy();
		expect(screen.queryByLabelText("Aussteller")).toBeNull();
		expect(screen.queryByText(/org_123/)).toBeNull();
	});

	it("reports every required step done once the setup is activated", () => {
		renderWizard(
			configuredSetup({
				domain: verifiedDomain,
				ssoTest: passedTest,
				activatedAt: "2026-01-01T00:00:00.000Z",
			}),
		);
		expect(screen.getByText("5 of 5 required steps done")).toBeTruthy();
		expect(screen.getByText("Activated")).toBeTruthy();
		expect(screen.queryByText("Not active yet")).toBeNull();
		expect(stepHeading("Review and activate")).toBeTruthy();
	});

	it("saves the provider and moves on to connecting it", async () => {
		updateEnterpriseIdentityProviderActionMock.mockResolvedValue(
			configuredSetup({ currentStep: "sso" }),
		);
		renderWizard();

		setInput("Anbieter-ID", "acme-okta");
		setInput("Work email domain", "Example.com");
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

		await waitFor(() => {
			expect(updateEnterpriseIdentityProviderActionMock).toHaveBeenCalledWith({
				preset: "generic",
				protocol: "oidc",
				providerId: "acme-okta",
				domain: "example.com",
				currentStep: "sso",
			});
		});
		expect(stepHeading("Connect your identity provider to Z8")).toBeTruthy();
		expect(document.activeElement).toBe(stepHeading("Connect your identity provider to Z8"));
	});

	it("explains an invalid provider ID before saving", async () => {
		renderWizard();

		setInput("Anbieter-ID", "Acme Okta");
		setInput("Work email domain", "example.com");
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

		expect(
			await screen.findByText(
				"Use only lowercase letters, numbers and hyphens, without a hyphen at the start or end.",
			),
		).toBeTruthy();
		expect(updateEnterpriseIdentityProviderActionMock).not.toHaveBeenCalled();
	});

	it("offers only the protocols the chosen provider supports", () => {
		renderWizard();

		fireEvent.click(screen.getByRole("radio", { name: "Google Workspace" }));

		expect(screen.getByText("Google Workspace connects with OpenID Connect (OIDC).")).toBeTruthy();
		expect(screen.queryByRole("radio", { name: "SAML 2.0" })).toBeNull();
	});

	it("sends an administrator back to the step a locked step depends on", () => {
		renderWizard();

		openStep(/^Connect,/);
		expect(stepHeading("Connect your identity provider to Z8")).toBeTruthy();
		expect(screen.queryByLabelText("Aussteller")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Go to Identity provider" }));

		expect(stepHeading("Choose your identity provider")).toBeTruthy();
	});

	it("registers OIDC SSO with provider, domain, issuer, and client credentials", async () => {
		renderWizard(configuredSetup({ currentStep: "sso" }));

		expect(stepHeading("Connect your identity provider to Z8")).toBeTruthy();
		setInput("Aussteller", "https://idp.example.com");
		setInput("Client ID", "client_123");
		setInput("Client secret", "secret_123");
		fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

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
		expect(stepHeading("Verify that you own example.com")).toBeTruthy();
	});

	it("requires the connection details before registering", async () => {
		renderWizard(configuredSetup({ currentStep: "sso" }));

		fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

		expect(await screen.findByText("Enter the issuer URL from your provider.")).toBeTruthy();
		expect(registerEnterpriseIdentitySSOProviderActionMock).not.toHaveBeenCalled();
	});

	it("shows the mounted browser origin in the encoded SAML ACS URL", async () => {
		renderWizard(
			configuredSetup({
				currentStep: "sso",
				provider: { preset: "generic", protocol: "saml", providerId: "acme/okta" },
			}),
		);

		expect(
			await screen.findByText("https://example.test/api/auth/sso/saml2/sp/acs/acme%2Fokta"),
		).toBeTruthy();
		expect(screen.getByLabelText("SAML metadata")).toBeTruthy();
		expect(screen.queryByText("/api/auth/sso/callback")).toBeNull();
	});

	it("shares the Entra guide and derives the issuer using the organization's callback", async () => {
		renderWizard(
			configuredSetup({
				currentStep: "sso",
				provider: { preset: "microsoft-entra", protocol: "oidc", providerId: "acme-entra" },
			}),
		);
		expect(stepHeading("Connect Microsoft Entra ID to Z8")).toBeTruthy();
		expect(screen.getByText("Set up Microsoft Entra ID")).toBeTruthy();
		expect(screen.getByText("https://acme.z8.test/api/auth/sso/callback")).toBeTruthy();
		expect(screen.queryByText("https://example.test/api/auth/sso/callback")).toBeNull();
		setInput("Directory (tenant) ID", "11111111-2222-3333-4444-555555555555");
		expect(screen.getByLabelText("Aussteller")).toHaveProperty(
			"value",
			"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
		);
		setInput("Client ID", "entra-client");
		setInput("Client secret", "entra-secret");
		fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));
		await waitFor(() =>
			expect(registerEnterpriseIdentitySSOProviderActionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					providerId: "acme-entra",
					issuer: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
					clientId: "entra-client",
					clientSecret: "entra-secret",
				}),
			),
		);
	});

	it("shows the DNS record for a connected provider and verifies the domain", async () => {
		renderWizard(configuredSetup({ currentStep: "ssoTest" }), [registeredProvider()]);

		expect(stepHeading("Verify that you own example.com")).toBeTruthy();
		expect(screen.getByText("Not verified yet")).toBeTruthy();
		expect(screen.getByText("_z8-auth--acme-okta")).toBeTruthy();
		expect(screen.getByText("token-123")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Verify domain" }));

		await waitFor(() => {
			expect(verifySSODomainActionMock).toHaveBeenCalledWith({ providerId: "acme-okta" });
			expect(refreshEnterpriseIdentityDomainStatusActionMock).toHaveBeenCalled();
		});
		expect(stepHeading("Test sign-in with a real account")).toBeTruthy();
	});

	it("creates a DNS record when the connection has none yet", async () => {
		renderWizard(configuredSetup({ currentStep: "ssoTest" }), [
			registeredProvider({ domainVerificationToken: null }),
		]);

		fireEvent.click(screen.getByRole("button", { name: "Create DNS record" }));

		await waitFor(() =>
			expect(requestSSODomainVerificationActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
			}),
		);
		expect(await screen.findByText("token-new")).toBeTruthy();
	});

	it("records an administrator-reported successful sign-in", async () => {
		recordEnterpriseIdentitySsoTestActionMock.mockResolvedValue(
			configuredSetup({ currentStep: "scim", domain: verifiedDomain, ssoTest: passedTest }),
		);
		renderWizard(configuredSetup({ currentStep: "ssoTest", domain: verifiedDomain }));

		expect(stepHeading("Test sign-in with a real account")).toBeTruthy();
		expect(screen.getByText(/the result is saved as you report it/)).toBeTruthy();
		setInput("Email used for the test", "admin@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Sign-in worked" }));

		await waitFor(() => {
			expect(recordEnterpriseIdentitySsoTestActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
				testEmail: "admin@example.com",
				status: "passed",
				error: null,
			});
		});
		expect(stepHeading("Sync users automatically")).toBeTruthy();
	});

	it("restores SCIM controls with a role choice before the connection exists", () => {
		renderWizard(configuredSetup({ currentStep: "scim" }));

		openStep(/^Sync users,/);
		expect(screen.getByLabelText("Role for people created by your provider")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create SCIM connection" })).toBeTruthy();
		expect(screen.getByText("https://app.example.test/api/auth/scim/v2")).toBeTruthy();
		expect(screen.queryByText("scim_token_returned_once")).toBeNull();
	});

	it("saves access policy with top-level defaultRoleTemplateId", async () => {
		renderWizard(configuredSetup());

		openStep(/^Access rules,/);
		fireEvent.click(screen.getByRole("checkbox", { name: "Require SSO" }));
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

		await waitFor(() => {
			expect(updateEnterpriseIdentityAccessPolicyActionMock).toHaveBeenCalledWith({
				ssoRequired: true,
				domainRestrictionEnabled: false,
				inviteRestrictionEnabled: false,
				defaultRoleTemplateId: "role-template-1",
			});
		});

		const payload = updateEnterpriseIdentityAccessPolicyActionMock.mock.calls[0][0];
		expect(payload.enforcement).toBeUndefined();
		expect(stepHeading("Review and activate")).toBeTruthy();
	});

	it("guards activation until readiness checks pass", () => {
		const { rerender } = renderWizard(configuredSetup());

		openStep(/^Activate,/);
		expect(screen.getByText(/Finish the steps marked/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open step: Verify domain" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Activate enterprise identity" }).hasAttribute("disabled"),
		).toBe(true);

		rerender(
			<IdentitySetupWizard
				callbackBaseUrl="https://acme.z8.test"
				key="ready"
				initialSetup={configuredSetup({ domain: verifiedDomain, ssoTest: passedTest })}
				organizationId="org_123"
			/>,
		);

		expect(stepHeading("Review and activate")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Activate enterprise identity" }).hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("DomainsAndBrandingTabs behavior", () => {
	it("renders generated platform URLs before custom domain setup", () => {
		renderDomainsTabs();

		expect(screen.getByText("https://acme.ui.z8-time.app")).toBeTruthy();
		expect(screen.getByText("https://org_123.ui.z8-time.app")).toBeTruthy();
	});

	it("offers only domain and branding tabs and preserves the selected view in the URL", async () => {
		renderDomainsTabs();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Custom Domain",
			"Branding",
		]);
		expect(screen.queryByRole("tab", { name: "SSO-Anbieter" })).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
		await waitFor(() => expect(screen.getByRole("tabpanel").textContent).toBe("Branding form"));
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("branding");
	});
	it("supports a direct link to the branding tab", () => {
		window.history.replaceState(null, "", "/en/settings/enterprise/domains?tab=branding");
		renderDomainsTabs();
		expect(screen.getByRole("tabpanel").textContent).toBe("Branding form");
		expect(screen.queryByText("Domain management")).toBeNull();
	});
});
