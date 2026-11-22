/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingAccessResult } from "@/lib/effect/services/billing/billing-enforcement.service";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";

const state = vi.hoisted(() => ({
	pathname: "/en/billing/suspended",
	billingEnabled: "true",
	billingAccess: {
		canAccess: false,
		state: "suspended",
		reason: "subscription_required",
	} as BillingAccessResult,
	settingsAccess: "orgAdmin" as SettingsAccess | null,
	redirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT:${url}`);
	}),
	redirectWithLocale: vi.fn((url: string) => {
		throw new Error(`REDIRECT_LOCALE:${url}`);
	}),
}));

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ "x-pathname": state.pathname }),
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: state.redirectWithLocale,
}));
vi.mock("@/env", () => ({
	env: {
		get BILLING_ENABLED() {
			return state.billingEnabled;
		},
		NODE_ENV: "test",
		STORE_APP_IOS_URL: undefined,
		STORE_APP_ANDROID_URL: undefined,
	},
}));
vi.mock("@/lib/auth/render-session", () => ({
	getRenderSession: async () => ({
		user: { id: "user-1", role: "user", canCreateOrganizations: false },
		session: { activeOrganizationId: "org-1" },
	}),
}));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderApprovedMembership: async () => ({ role: "admin", status: "approved" }),
	getRenderOrganizationDisplayContext: async () => null,
	getRenderSettingsAccess: async () => state.settingsAccess,
	getRenderUserOrganizations: async () => [
		{
			id: "org-1",
			name: "Suspended Corp",
			slug: "suspended-corp",
			logo: null,
			memberRole: "admin",
			hasEmployeeRecord: true,
		},
	],
}));
vi.mock("@/lib/user-preferences/render-snapshot", () => ({
	getRenderUserPreferences: async () => ({
		locale: null,
		weekStartDay: "monday",
		timeFormat: "24h",
		timezone: "UTC",
		helpImproveProduct: false,
	}),
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			subscription: {
				findFirst: async () => null,
			},
		},
	},
}));
vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: async () => state.billingAccess,
	},
}));
vi.mock("@/lib/effect/services/billing", () => ({
	BillingEnforcementService: {},
	BillingServicesLive: {},
}));
vi.mock("@/lib/organization/creation-policy.server", () => ({
	canCreateOrganizationsForDeployment: () => false,
}));
vi.mock("@/components/posthog-provider", () => ({
	PostHogProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/notifications/push-permission-provider", () => ({
	PushPermissionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	UserPreferencesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/providers/organization-settings-provider", () => ({
	OrganizationSettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/sidebar", () => ({
	SidebarProvider: ({ children }: { children: ReactNode }) => (
		<div data-testid="app-sidebar-provider">{children}</div>
	),
	SidebarInset: ({ children }: { children: ReactNode }) => (
		<div data-testid="app-sidebar-inset">{children}</div>
	),
}));
vi.mock("@/components/server-sidebar-region", () => ({
	ServerSidebarRegion: () => <nav data-testid="main-app-sidebar" />,
}));
vi.mock("@/components/site-header", () => ({
	SiteHeader: () => <header data-testid="main-site-header" />,
}));
vi.mock("@/components/app-skip-link", () => ({
	AppSkipLink: () => <a href="#app-page-content">Skip to content</a>,
}));
vi.mock("@/components/billing/billing-recovery-header", () => ({
	BillingRecoveryHeader: ({ canAccessBilling }: { canAccessBilling: boolean }) => (
		<header
			data-testid="billing-recovery-header"
			data-can-access-billing={String(canAccessBilling)}
		/>
	),
}));
vi.mock("@/components/billing/trial-banner", () => ({ TrialBanner: () => null }));
vi.mock("@/components/offline", () => ({ OfflineBanner: () => null }));
vi.mock("@/components/organization/organization-deletion-banner", () => ({
	OrganizationDeletionBanner: () => null,
}));
vi.mock("@/components/organization-mfa/deadline-banner", () => ({
	MfaDeadlineBanner: () => null,
}));
vi.mock("@/components/position-capture/position-consent-dialog", () => ({
	PositionConsentDialogHost: () => null,
}));
vi.mock("@/components/store-app/get-the-app-banner", () => ({
	GetTheAppBanner: () => null,
}));

import { AuthenticatedAppContent } from "./app-layout-content";

beforeEach(() => {
	vi.clearAllMocks();
	state.billingEnabled = "true";
	state.billingAccess = {
		canAccess: false,
		state: "suspended",
		reason: "subscription_required",
	};
	state.settingsAccess = "orgAdmin";
});

afterEach(cleanup);

describe("AuthenticatedAppContent billing chrome", () => {
	it.each(["/en/billing/suspended", "/en/settings/billing"])(
		"renders minimal recovery chrome without the main sidebar on %s when billing is suspended",
		async (pathname) => {
			state.pathname = pathname;
			render(
				await AuthenticatedAppContent({
					params: Promise.resolve({ locale: "en" }),
					children: <main>Recovery page</main>,
				}),
			);

			expect(screen.getByTestId("billing-recovery-header")).toBeTruthy();
			expect(
				screen.getByTestId("billing-recovery-header").getAttribute("data-can-access-billing"),
			).toBe("true");
			expect(screen.queryByTestId("main-app-sidebar")).toBeNull();
			expect(screen.queryByTestId("main-site-header")).toBeNull();
			expect(screen.queryByTestId("app-sidebar-provider")).toBeNull();
			expect(screen.getByText("Recovery page")).toBeTruthy();
		},
	);

	it("marks billing navigation unavailable for non-admin members in suspended recovery chrome", async () => {
		state.pathname = "/en/billing/suspended";
		state.settingsAccess = "member";
		render(
			await AuthenticatedAppContent({
				params: Promise.resolve({ locale: "en" }),
				children: <main>Suspended notice</main>,
			}),
		);

		expect(
			screen.getByTestId("billing-recovery-header").getAttribute("data-can-access-billing"),
		).toBe("false");
	});

	it("renders the full app shell with main sidebar on /settings/billing when billing is active", async () => {
		state.pathname = "/en/settings/billing";
		state.billingAccess = { canAccess: true, state: "active" };
		render(
			await AuthenticatedAppContent({
				params: Promise.resolve({ locale: "en" }),
				children: <main>Active billing page</main>,
			}),
		);

		expect(screen.getByTestId("main-app-sidebar")).toBeTruthy();
		expect(screen.getByTestId("main-site-header")).toBeTruthy();
		expect(screen.getByTestId("app-sidebar-provider")).toBeTruthy();
		expect(screen.queryByTestId("billing-recovery-header")).toBeNull();
		expect(screen.getByText("Active billing page")).toBeTruthy();
	});
});
