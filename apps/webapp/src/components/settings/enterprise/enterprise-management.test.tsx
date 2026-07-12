/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomDomainSummary } from "./custom-domain-summary";
import { DomainManagement } from "./domain-management";
import { SSOProviderManagement } from "./sso-provider-management";
import { SsoProviderListCard } from "./sso-provider-list-card";

const { deleteDomainActionMock, deleteSSOProviderActionMock } = vi.hoisted(() => ({
	deleteDomainActionMock: vi.fn(),
	deleteSSOProviderActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback?: string, params?: Record<string, string>) =>
			(params
				? Object.entries(params).reduce(
						(result, [name, value]) => result.replaceAll(`{${name}}`, value),
						fallback ?? key,
					)
				: fallback) ?? key,
	}),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	deleteDomainAction: deleteDomainActionMock,
	deleteSSOProviderAction: deleteSSOProviderActionMock,
	regenerateVerificationTokenAction: vi.fn(),
	requestSSODomainVerificationAction: vi.fn(),
	storeTurnstileSecretAction: vi.fn(),
	updateDomainAuthConfigAction: vi.fn(),
	verifyDomainAction: vi.fn(),
	verifySSODomainAction: vi.fn(),
}));

vi.mock("./domain-add-dialog", () => ({ DomainAddDialog: () => null }));
vi.mock("./domain-auth-config-dialog", () => ({ DomainAuthConfigDialog: () => null }));
vi.mock("./domain-verification-dialog", () => ({ DomainVerificationDialog: () => null }));
vi.mock("./sso-provider-dialog", () => ({ SSOProviderDialog: () => null }));

const domain = {
	id: "domain_123",
	domain: "login.acme.test",
	domainVerified: false,
	isPrimary: true,
	verificationToken: "domain-token",
	verificationTokenExpiresAt: null,
	authConfig: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: ["google"],
		ssoEnabled: true,
		passkeyEnabled: false,
	},
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const provider = {
	id: "provider_123",
	issuer: "https://acme.okta.test",
	domain: "acme.test",
	providerId: "acme-okta",
	domainVerified: false,
	domainVerificationToken: "provider-token",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("enterprise management visual surfaces", () => {
	it("renders domain auth configuration without exposing its token", () => {
		render(
			<CustomDomainSummary
				domain={domain}
				onAdd={vi.fn()}
				onConfigure={vi.fn()}
				onDelete={vi.fn()}
				onVerify={vi.fn()}
			/>,
		);

		expect(screen.getByText("login.acme.test")).toBeTruthy();
		expect(screen.queryByText("domain-token")).toBeNull();
		expect(screen.getByText("Email/Password")).toBeTruthy();
	});

	it("keeps provider identifiers paired with their verification tokens", () => {
		render(
			<SsoProviderListCard
				busyProviderId={null}
				providers={[provider]}
				tokenByProviderId={{ [provider.providerId]: "new-provider-token" }}
				onDelete={vi.fn()}
				onRequestVerificationToken={vi.fn()}
				onVerifyDomain={vi.fn()}
			/>,
		);

		expect(screen.getByText("new-provider-token")).toBeTruthy();
		expect(screen.queryByText("provider-token")).toBeNull();
	});
});

describe("enterprise management deletion", () => {
	it("confirms domain deletion before removing the domain from local state", async () => {
		deleteDomainActionMock.mockResolvedValue(undefined);
		render(
			<DomainManagement
				defaultUrls={{ canonical: "https://acme.z8.test" }}
				initialDomains={[domain]}
				organizationId="org_123"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete custom domain login.acme.test" }));
		expect(screen.getByText('Are you sure you want to delete "login.acme.test"? This action cannot be undone. Users will no longer be able to sign in via this custom domain.')).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(deleteDomainActionMock).toHaveBeenCalledWith("domain_123"));
		await waitFor(() => expect(screen.queryByText("login.acme.test")).toBeNull());
	});

	it("confirms provider deletion before removing the provider and its token locally", async () => {
		deleteSSOProviderActionMock.mockResolvedValue(undefined);
		render(<SSOProviderManagement initialProviders={[provider]} />);

		fireEvent.click(screen.getByRole("button", { name: "Delete SSO provider acme-okta" }));
		expect(screen.getByText("Are you sure you want to delete this SSO provider? Users will no longer be able to sign in using this identity provider.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(deleteSSOProviderActionMock).toHaveBeenCalledWith("provider_123"));
		await waitFor(() => expect(screen.queryByText("acme.test")).toBeNull());
	});
});
