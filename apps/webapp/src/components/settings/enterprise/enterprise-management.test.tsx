/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionFailureError } from "./action-data";
import { CustomDomainSummary } from "./custom-domain-summary";
import { DomainManagement } from "./domain-management";
import { SsoProviderListCard } from "./sso-provider-list-card";
import { SocialOAuthManagement } from "./social-oauth-management";
import { SSOProviderManagement } from "./sso-provider-management";

const { deleteDomainActionMock, deleteSSOProviderActionMock, deleteSocialOAuthConfigActionMock } =
	vi.hoisted(() => ({
		deleteDomainActionMock: vi.fn(),
		deleteSSOProviderActionMock: vi.fn(),
		deleteSocialOAuthConfigActionMock: vi.fn(),
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

// The actions are mocked as plain values; the result unwrap is identity here.
vi.mock("@/components/settings/enterprise/action-data", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/settings/enterprise/action-data")>()),
	actionData: <T,>(result: Promise<T>) => result,
}));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	deleteDomainAction: deleteDomainActionMock,
	deleteSSOProviderAction: deleteSSOProviderActionMock,
	deleteSocialOAuthConfigAction: deleteSocialOAuthConfigActionMock,
	regenerateVerificationTokenAction: vi.fn(),
	requestSSODomainVerificationAction: vi.fn(),
	storeTurnstileSecretAction: vi.fn(),
	updateDomainAuthConfigAction: vi.fn(),
	updatePlatformAuthConfigAction: vi.fn(),
	verifyDomainAction: vi.fn(),
	verifySSODomainAction: vi.fn(),
}));

vi.mock("./domain-add-dialog", () => ({ DomainAddDialog: () => null }));
vi.mock("./domain-auth-config-dialog", () => ({
	DomainAuthConfigDialog: () => null,
}));
vi.mock("./domain-verification-dialog", () => ({
	DomainVerificationDialog: () => null,
}));
vi.mock("./sso-provider-dialog", () => ({ SSOProviderDialog: () => null }));
vi.mock("./social-oauth-dialog", () => ({ SocialOAuthDialog: () => null }));

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

const platformAuth = {
	config: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: true,
		passkeyEnabled: true,
		registrationEnabled: true,
	},
	ssoProviderAvailable: true,
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

	it("shows the DNS record name and copies the record parts", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		render(
			<SsoProviderListCard
				busyProviderId={null}
				providers={[provider]}
				tokenByProviderId={{}}
				onDelete={vi.fn()}
				onRequestVerificationToken={vi.fn()}
				onVerifyDomain={vi.fn()}
			/>,
		);

		expect(screen.getByText("_z8-auth--acme-okta")).toBeTruthy();
		expect(screen.getByText("_z8-auth--acme-okta.acme.test")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Copy record name" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("_z8-auth--acme-okta"));
		fireEvent.click(screen.getByRole("button", { name: "Copy TXT token" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("provider-token"));
	});
});

describe("enterprise management deletion", () => {
	it("confirms domain deletion before removing the domain from local state", async () => {
		deleteDomainActionMock.mockResolvedValue(undefined);
		render(
			<DomainManagement
				defaultUrls={{ canonical: "https://acme.z8.test" }}
				initialDomains={[domain]}
				initialPlatformAuth={platformAuth}
				organizationId="org_123"
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Delete custom domain login.acme.test",
			}),
		);
		expect(
			screen.getByText(
				'Are you sure you want to delete "login.acme.test"? This action cannot be undone. Users will no longer be able to sign in via this custom domain.',
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete domain" }));

		await waitFor(() =>
			expect(deleteDomainActionMock).toHaveBeenCalledWith({ domainId: "domain_123" }),
		);
		await waitFor(() => expect(screen.queryByText("login.acme.test")).toBeNull());
	});

	it("confirms provider deletion before removing the provider and its token locally", async () => {
		deleteSSOProviderActionMock.mockResolvedValue(undefined);
		render(
			<SSOProviderManagement
				initialProviders={[provider]}
				callbackBaseUrl="https://acme.z8.test"
			/>,
		);
		expect(screen.getByText("https://acme.z8.test/api/auth/sso/callback")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Delete SSO provider acme-okta" }));
		expect(
			screen.getByText(
				"Are you sure you want to delete this SSO provider? Users will no longer be able to sign in using this identity provider.",
			),
		).toBeTruthy();
		expect(
			screen.getByRole("alertdialog", { name: "Delete SSO provider acme-okta?" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));

		await waitFor(() =>
			expect(deleteSSOProviderActionMock).toHaveBeenCalledWith({ providerId: "provider_123" }),
		);
		await waitFor(() => expect(screen.queryByText("acme.test")).toBeNull());
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const refusal = () => new ActionFailureError({ error: "Refused", code: "AuthorizationError" });

const socialConfig = {
	id: "social_123",
	provider: "google",
	clientId: "google-client",
	isActive: true,
} as unknown as Parameters<typeof SocialOAuthManagement>[0]["initialConfigs"][number];

const removals = [
	{
		record: "custom domain",
		mock: deleteDomainActionMock,
		mount: () =>
			render(
				<DomainManagement
					defaultUrls={{ canonical: "https://acme.z8.test" }}
					initialDomains={[domain]}
					initialPlatformAuth={platformAuth}
					organizationId="org_123"
				/>,
			),
		open: "Delete custom domain login.acme.test",
		confirm: "Delete domain",
		dialog: "Delete Domain",
		failure: "You do not have access to this setting.",
		removed: () => screen.queryByText("login.acme.test"),
	},
	{
		record: "SSO provider",
		mock: deleteSSOProviderActionMock,
		mount: () =>
			render(
				<SSOProviderManagement
					initialProviders={[provider]}
					callbackBaseUrl="https://acme.z8.test"
				/>,
			),
		open: "Delete SSO provider acme-okta",
		confirm: "Delete provider",
		dialog: "Delete SSO provider acme-okta?",
		failure: "You do not have access to this setting.",
		removed: () => screen.queryByText("acme.test"),
	},
	{
		record: "social sign-in",
		mock: deleteSocialOAuthConfigActionMock,
		mount: () =>
			render(
				<SocialOAuthManagement
					initialConfigs={[socialConfig]}
					callbackBaseUrl="https://acme.z8.test"
				/>,
			),
		open: "Remove Google sign-in",
		confirm: "Remove",
		dialog: "Remove Google sign-in?",
		failure: "You do not have access to this setting.",
		removed: () => screen.queryByText("google-client"),
	},
];

describe.each(removals)("$record removal confirmation", (removal) => {
	it("stays open while pending, ignores duplicate presses and closes on success", async () => {
		const pending = deferred<undefined>();
		removal.mock.mockReset().mockReturnValue(pending.promise);
		removal.mount();
		fireEvent.click(screen.getByRole("button", { name: removal.open }));
		const confirm = screen.getByRole("button", { name: removal.confirm, exact: true });
		act(() => {
			fireEvent.click(confirm);
			fireEvent.click(confirm);
		});
		await waitFor(() => expect(removal.mock).toHaveBeenCalledTimes(1));

		const dialog = screen.getByRole("alertdialog", { name: removal.dialog });
		expect(dialog.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(screen.getByRole("alertdialog", { name: removal.dialog })).toBeTruthy();

		await act(async () => pending.resolve(undefined));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(removal.removed()).toBeNull());
	});

	it("keeps the dialog open with an inline error when the removal fails", async () => {
		removal.mock.mockReset().mockRejectedValue(refusal());
		removal.mount();
		fireEvent.click(screen.getByRole("button", { name: removal.open }));
		fireEvent.click(screen.getByRole("button", { name: removal.confirm, exact: true }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe(removal.failure);
		expect(screen.getByRole("alertdialog", { name: removal.dialog })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false);
		expect(
			screen.getByRole("button", { name: removal.confirm, exact: true }).hasAttribute("disabled"),
		).toBe(false);
	});
});
