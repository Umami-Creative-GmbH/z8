/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseIdentitySetupResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";
import type { OrganizationBranding } from "@/lib/domain";
import { DomainsAndBrandingTabs } from "./domains-branding-tabs";
import { IdentitySetupWizard } from "./identity-setup-wizard";

const {
	activateEnterpriseIdentitySetupActionMock,
	generateEnterpriseIdentityScimTokenActionMock,
	recordEnterpriseIdentitySsoTestActionMock,
	refreshEnterpriseIdentityDomainStatusActionMock,
	refreshEnterpriseIdentityScimStatusActionMock,
	registerEnterpriseIdentitySSOProviderActionMock,
	updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderActionMock,
} = vi.hoisted(() => ({
	activateEnterpriseIdentitySetupActionMock: vi.fn(),
	generateEnterpriseIdentityScimTokenActionMock: vi.fn(),
	recordEnterpriseIdentitySsoTestActionMock: vi.fn(),
	refreshEnterpriseIdentityDomainStatusActionMock: vi.fn(),
	refreshEnterpriseIdentityScimStatusActionMock: vi.fn(),
	registerEnterpriseIdentitySSOProviderActionMock: vi.fn(),
	updateEnterpriseIdentityAccessPolicyActionMock: vi.fn(),
	updateEnterpriseIdentityProviderActionMock: vi.fn(),
}));

const germanCopy: Record<string, string> = {
	"settings.enterprise.identity.hero.eyebrow": "Unternehmensidentität",
	"settings.enterprise.identity.hero.title": "Operative Befehlscheckliste",
	"settings.enterprise.identity.step.provider": "Anbieter",
	"settings.enterprise.identity.step.domain": "Domäne",
	"settings.enterprise.identity.step.sso": "SSO-Konfiguration",
	"settings.enterprise.identity.step.ssoTest": "Testbenutzer",
	"settings.enterprise.identity.step.scim": "SCIM-Bereitstellung",
	"settings.enterprise.identity.step.accessPolicy": "Zugriffsrichtlinie",
	"settings.enterprise.identity.step.review": "Prüfen & Aktivieren",
	"settings.enterprise.identity.badge.ready": "Bereit",
	"settings.enterprise.identity.badge.now": "Jetzt",
	"settings.enterprise.identity.badge.queued": "Wartend",
	"settings.enterprise.identity.provider.title": "Anbieter",
	"settings.enterprise.identity.provider.action.save": "Anbieter speichern",
	"settings.enterprise.identity.provider.label.preset": "Anbietervorlage",
	"settings.enterprise.identity.provider.label.protocol": "Protokoll",
	"settings.enterprise.identity.provider.label.providerId": "Anbieter-ID",
	"settings.enterprise.identity.provider.label.domain": "E-Mail-Domäne",
	"settings.enterprise.identity.provider.placeholder.providerId": "z. B. acme-okta…",
	"settings.enterprise.identity.provider.placeholder.domain": "z. B. example.com…",
	"settings.enterprise.identity.domain.title": "Domäne",
	"settings.enterprise.identity.domain.status.pending": "Ausstehend",
	"settings.enterprise.identity.domain.status.verified": "Verifiziert",
	"settings.enterprise.identity.domain.action.checkStatus": "Domänenstatus prüfen",
	"settings.enterprise.identity.sso.label.issuer": "Aussteller",
	"settings.enterprise.identity.sso.label.clientId": "Client-ID",
	"settings.enterprise.identity.sso.label.clientSecret": "Client-Geheimnis",
	"settings.enterprise.identity.sso.action.register": "SSO-Anbieter registrieren",
	"settings.enterprise.identity.sso.placeholder.issuer.generic": "https://idp.beispiel.de…",
	"settings.enterprise.identity.ssoTest.title": "Testbenutzer",
	"settings.enterprise.identity.ssoTest.label.email": "Testbenutzer-E-Mail",
	"settings.enterprise.identity.ssoTest.label.failureNote": "Fehlernotiz",
	"settings.enterprise.identity.ssoTest.action.recordPass": "Erfolg erfassen",
	"settings.enterprise.identity.ssoTest.action.recordFail": "Fehler erfassen",
	"settings.enterprise.identity.ssoTest.status.passed": "Bestanden",
	"settings.enterprise.identity.review.requirement.provider": "Anbieter",
	"settings.enterprise.identity.review.requirement.ssoTest": "SSO-Test",
	"settings.enterprise.identity.review.missingRequirement":
		"{item} ist vor Aktivierung erforderlich",
	"settings.enterprise.identity.ssoTest.status.notRun": "Nicht ausgeführt",
	"settings.enterprise.identity.scim.action.generateToken": "Token generieren",
	"settings.enterprise.identity.scim.action.refreshStatus": "Status aktualisieren",
	"settings.enterprise.identity.scim.tokenShownOnce": "Dieses Token wird einmal angezeigt",
	"settings.enterprise.identity.scim.description":
		"SCIM-Verifizierung wird aktualisiert, nachdem Ihr Identitätsanbieter einen Testbenutzer oder eine Gruppenänderung sendet.",
	"settings.enterprise.identity.scim.status.none": "Noch keine Provisionierungsaktivität",
	"settings.enterprise.identity.scim.status.observed": "Provisionierungsaktivität erkannt",
	"settings.enterprise.identity.accessPolicy.defaultRoleTemplate": "Standard-Rollenvorlage",
	"settings.enterprise.identity.accessPolicy.action.save": "Zugriffsrichtlinie speichern",
	"settings.enterprise.identity.review.action.activate": "Unternehmensidentität aktivieren",
	"settings.enterprise.tab.sso": "SSO-Anbieter",
	"settings.enterprise.domains.guidedSetup.action": "Geführte Einrichtung",
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
	refreshEnterpriseIdentityDomainStatusAction: refreshEnterpriseIdentityDomainStatusActionMock,
	refreshEnterpriseIdentityScimStatusAction: refreshEnterpriseIdentityScimStatusActionMock,
	registerEnterpriseIdentitySSOProviderAction: registerEnterpriseIdentitySSOProviderActionMock,
	updateEnterpriseIdentityAccessPolicyAction: updateEnterpriseIdentityAccessPolicyActionMock,
	updateEnterpriseIdentityProviderAction: updateEnterpriseIdentityProviderActionMock,
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
	refreshEnterpriseIdentityDomainStatusActionMock.mockResolvedValue(
		configuredSetup({
			domain: {
				domain: "example.com",
				verified: true,
			},
		}),
	);
	updateEnterpriseIdentityAccessPolicyActionMock.mockResolvedValue(
		configuredSetup({ currentStep: "review" }),
	);
	activateEnterpriseIdentitySetupActionMock.mockResolvedValue(
		configuredSetup({ activatedAt: "2026-01-01T00:00:00.000Z" }),
	);
});

describe("IdentitySetupWizard behavior", () => {
	it("renders all seven steps and accessible controls", () => {
		renderWizard(setupResponse({ currentStep: "domain" }));

		expect(screen.getByText("Unternehmensidentität")).toBeTruthy();
		expect(screen.getByText("Operative Befehlscheckliste")).toBeTruthy();
		expect(screen.queryByText("Enterprise identity")).toBeNull();
		expect(screen.queryByText("Operational command checklist")).toBeNull();
		expect(screen.getAllByText("Anbieter").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Domäne").length).toBeGreaterThan(0);
		expect(screen.getAllByText("SSO-Konfiguration").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Testbenutzer").length).toBeGreaterThan(0);
		expect(screen.getAllByText("SCIM-Bereitstellung").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Zugriffsrichtlinie").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Prüfen & Aktivieren").length).toBeGreaterThan(0);

		expect(screen.getAllByText("Bereit").length).toBeGreaterThan(0);
		expect(screen.getByText("Jetzt")).toBeTruthy();
		expect(screen.getAllByText("Wartend").length).toBeGreaterThan(0);
		expect(screen.getByLabelText("Anbietervorlage")).toBeTruthy();
		expect(screen.getByPlaceholderText("z. B. acme-okta…")).toBeTruthy();
		expect(screen.getByPlaceholderText("z. B. example.com…")).toBeTruthy();
		expect(screen.queryByPlaceholderText("e.g. acme-okta…")).toBeNull();
		expect(screen.queryByPlaceholderText("e.g. example.com…")).toBeNull();
		expect(screen.getByLabelText("Protokoll")).toBeTruthy();
		expect(screen.getByLabelText("Anbieter-ID")).toBeTruthy();
		expect(screen.getByLabelText("E-Mail-Domäne")).toBeTruthy();
		expect(screen.getByLabelText("Aussteller")).toBeTruthy();
		expect(screen.getByPlaceholderText("https://idp.beispiel.de…")).toBeTruthy();
		expect(screen.queryByPlaceholderText("https://idp.example.com…")).toBeNull();
		expect(screen.getByLabelText("Client-ID")).toBeTruthy();
		expect(screen.getByLabelText("Client-Geheimnis")).toBeTruthy();
		expect(screen.getByLabelText("Testbenutzer-E-Mail")).toBeTruthy();
		expect(screen.getByLabelText("Fehlernotiz")).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Require SSO" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Restrict to verified domain" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Restrict invites" })).toBeTruthy();
		expect(screen.getByLabelText("Standard-Rollenvorlage")).toBeTruthy();
		expect(screen.getByText("Nicht ausgeführt")).toBeTruthy();
		expect(screen.queryByText("not-run")).toBeNull();
		expect(screen.getByText("Anbieter ist vor Aktivierung erforderlich")).toBeTruthy();
		expect(screen.getByText("SSO-Test ist vor Aktivierung erforderlich")).toBeTruthy();
		expect(screen.queryByText("provider is required before activation")).toBeNull();
		expect(screen.queryByText("ssoTest is required before activation")).toBeNull();
	});

	it("saves provider setup with the expected payload", async () => {
		renderWizard();

		setInput("Anbieter-ID", "acme-okta");
		setInput("E-Mail-Domäne", "example.com");
		fireEvent.click(screen.getByRole("button", { name: "Anbieter speichern" }));

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

		setInput("Aussteller", "https://idp.example.com");
		setInput("Client-ID", "client_123");
		setInput("Client-Geheimnis", "secret_123");
		fireEvent.click(screen.getByRole("button", { name: "SSO-Anbieter registrieren" }));

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

		setInput("Testbenutzer-E-Mail", "admin@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Erfolg erfassen" }));

		await waitFor(() => {
			expect(recordEnterpriseIdentitySsoTestActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
				testEmail: "admin@example.com",
				status: "passed",
				error: null,
			});
		});
	});

	it("refreshes domain verification from the Domain card", async () => {
		renderWizard(configuredSetup());

		expect(screen.getByText("Ausstehend")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Domänenstatus prüfen" }));

		await waitFor(() => {
			expect(refreshEnterpriseIdentityDomainStatusActionMock).toHaveBeenCalled();
		});

		expect(screen.getByText("Verifiziert")).toBeTruthy();
	});

	it("shows the SCIM token only after token generation returns it", async () => {
		renderWizard(configuredSetup());

		expect(screen.queryByText("scim_token_returned_once")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Token generieren" }));

		await waitFor(() => {
			expect(generateEnterpriseIdentityScimTokenActionMock).toHaveBeenCalledWith({
				providerId: "acme-okta",
				defaultRoleTemplateId: "role-template-1",
			});
		});

		expect(screen.getByText("Dieses Token wird einmal angezeigt")).toBeTruthy();
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
				"SCIM-Verifizierung wird aktualisiert, nachdem Ihr Identitätsanbieter einen Testbenutzer oder eine Gruppenänderung sendet.",
			),
		).toBeTruthy();
		expect(screen.getByText("Noch keine Provisionierungsaktivität")).toBeTruthy();
		expect(screen.queryByText("Provisionierungsaktivität erkannt")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Status aktualisieren" }));

		await waitFor(() => {
			expect(refreshEnterpriseIdentityScimStatusActionMock).toHaveBeenCalled();
		});

		expect(screen.getByText("Provisionierungsaktivität erkannt")).toBeTruthy();
		expect(screen.queryByText("Noch keine Provisionierungsaktivität")).toBeNull();
	});

	it("saves access policy with top-level defaultRoleTemplateId", async () => {
		renderWizard(configuredSetup());

		fireEvent.click(screen.getByRole("button", { name: "Zugriffsrichtlinie speichern" }));

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
			screen
				.getByRole("button", { name: "Unternehmensidentität aktivieren" })
				.hasAttribute("disabled"),
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
			screen
				.getByRole("button", { name: "Unternehmensidentität aktivieren" })
				.hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("DomainsAndBrandingTabs behavior", () => {
	it("renders a usable guided setup link in the SSO tab", () => {
		renderDomainsTabs();

		const ssoTab = screen.getByRole("tab", { name: "SSO-Anbieter" });
		fireEvent.pointerDown(ssoTab, { button: 0, ctrlKey: false });
		fireEvent.keyDown(ssoTab, { key: "Enter" });
		fireEvent.click(ssoTab);

		expect(screen.getByRole("link", { name: "Geführte Einrichtung" }).getAttribute("href")).toBe(
			"/settings/enterprise/identity-setup",
		);
	});
});
