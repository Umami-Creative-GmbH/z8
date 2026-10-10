import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./layout";

vi.mock("@tolgee/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tolgee/react")>()),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	checkBillingAccess: vi.fn(),
	findMember: vi.fn(),
	findSubscription: vi.fn(),
	findUserSettings: vi.fn(),
	getOrganizationSettings: vi.fn(),
	getSession: vi.fn(),
	headers: vi.fn(),
	loggerError: vi.fn(),
	protectedChildRender: vi.fn(),
	redirect: vi.fn((target: string) => {
		throw new Error(`TEST_REDIRECT:${target}`);
	}),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
	redirect: mockState.redirect,
}));

vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...predicates: unknown[]) => predicates),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("effect", () => ({
	Effect: {
		flatMap: vi.fn(() => ({ pipe: vi.fn(() => undefined) })),
		provide: vi.fn(),
	},
}));

vi.mock("@/lib/effect/runtime", () => ({
	runtime: { runPromise: vi.fn(() => mockState.checkBillingAccess()) },
}));

vi.mock("@/components/position-capture/position-consent-dialog", () => ({
	PositionConsentDialogHost: () => null,
}));

vi.mock("@/components/billing/trial-banner", () => ({
	TrialBanner: () => null,
}));

vi.mock("@/components/offline", () => ({
	OfflineBanner: () => <div data-testid="offline-banner" />,
}));

vi.mock("@/components/store-app/get-the-app-banner", () => ({
	GetTheAppBanner: ({
		storeUrls,
	}: {
		storeUrls: { ios: string | null; android: string | null };
	}) => (
		<div
			data-testid="get-the-app-banner"
			data-ios={String(storeUrls.ios)}
			data-android={String(storeUrls.android)}
		/>
	),
}));

vi.mock("@/components/notifications/push-permission-provider", () => ({
	PushPermissionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/organization/organization-deletion-banner", () => ({
	OrganizationDeletionBanner: () => null,
}));

vi.mock("@/components/posthog-provider", () => ({
	PostHogProvider: ({
		children,
		helpImproveProduct,
	}: {
		children: React.ReactNode;
		helpImproveProduct: boolean;
	}) => <div data-consent={String(helpImproveProduct)}>{children}</div>,
}));

vi.mock("@/components/providers/organization-settings-provider", () => ({
	OrganizationSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	UserPreferencesProvider: ({
		children,
		weekStartDay,
		timeFormat,
		timezone,
	}: {
		children: React.ReactNode;
		weekStartDay: string;
		timeFormat: string;
		timezone: string;
	}) => (
		<div data-week-start={weekStartDay} data-time-format={timeFormat} data-timezone={timezone}>
			{children}
		</div>
	),
}));

vi.mock("@/components/server-app-sidebar", () => ({
	ServerAppSidebar: () => <aside />,
}));

vi.mock("@/components/site-header", () => ({
	SiteHeader: () => <header />,
}));

vi.mock("@/components/ui/sidebar", () => ({
	Sidebar: ({ children }: { children: React.ReactNode }) => <aside>{children}</aside>,
	SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SidebarInset: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
	SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div />,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mockState.findMember },
			subscription: { findFirst: mockState.findSubscription },
			userSettings: { findFirst: mockState.findUserSettings },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: { organizationId: "member.organizationId", userId: "member.userId" },
}));

vi.mock("@/db/schema", () => ({
	subscription: { organizationId: "subscription.organizationId" },
	userSettings: { userId: "userSettings.userId" },
}));

vi.mock("@/env", () => ({
	env: {
		BILLING_ENABLED: "true",
		NODE_ENV: "test",
		STORE_APP_IOS_URL: "https://apps.apple.com/app/z8/id1234567890",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mockState.getSession } },
}));

vi.mock("@/lib/effect/services/billing", () => ({
	BillingEnforcementService: {},
	BillingServicesLive: {},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: mockState.loggerError }),
}));

vi.mock("@/lib/organization-settings", () => ({
	getOrganizationSettings: mockState.getOrganizationSettings,
}));

vi.mock("@/proxy", () => ({
	DOMAIN_HEADERS: { PATHNAME: "x-z8-pathname" },
}));

function ProtectedChild() {
	mockState.protectedChildRender();
	return <div>Protected child content</div>;
}

async function serverRender(pathname: string) {
	mockState.headers.mockResolvedValue(
		new Headers({
			"x-z8-pathname": pathname,
		}),
	);
	const errors: unknown[] = [];
	const stream = await renderToReadableStream(
		<AppLayout params={Promise.resolve({ locale: "en" })}>
			<ProtectedChild />
		</AppLayout>,
		{
			onError: (error) => {
				errors.push(error);
			},
		},
	);
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let html = "";

	while (true) {
		const result = await reader.read();
		if (result.done) {
			break;
		}
		html += decoder.decode(result.value, { stream: true });
	}

	return { errors, html: html + decoder.decode() };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockState.findUserSettings.mockResolvedValue({ helpImproveProduct: true });
	mockState.getSession.mockResolvedValue({
		session: { activeOrganizationId: "organization-1" },
		user: { id: "user-1" },
	});
	mockState.getOrganizationSettings.mockResolvedValue({});
	mockState.findMember.mockResolvedValue({ role: "owner" });
	mockState.findSubscription.mockResolvedValue(null);
	mockState.checkBillingAccess.mockResolvedValue({
		canAccess: true,
		state: "active",
	});
});

describe("authenticated app layout gates", () => {
	it("redirects a supported saved locale before checking billing", async () => {
		mockState.findUserSettings.mockResolvedValue({ locale: "de" });
		const { errors } = await serverRender("/en/time-tracking");
		expect(mockState.redirect).toHaveBeenCalledWith("/de/time-tracking");
		expect(errors).toEqual([
			expect.objectContaining({ message: "TEST_REDIRECT:/de/time-tracking" }),
		]);
		expect(mockState.checkBillingAccess).not.toHaveBeenCalled();
		expect(mockState.getOrganizationSettings).toHaveBeenCalledWith("organization-1", "user-1");
	});

	it.each([null, "", "invalid", "en"])("does not redirect saved locale %j", async (locale) => {
		mockState.findUserSettings.mockResolvedValue({ locale });
		const { errors } = await serverRender("/en/time-tracking");
		expect(errors).toEqual([]);
		expect(mockState.redirect).not.toHaveBeenCalled();
		expect(mockState.checkBillingAccess).toHaveBeenCalledOnce();
		expect(mockState.findUserSettings).toHaveBeenCalledOnce();
	});

	it("passes exact saved preferences and explicit false consent to providers", async () => {
		mockState.findUserSettings.mockResolvedValue({
			locale: "en",
			weekStartDay: "monday",
			timeFormat: "12h",
			timezone: "Europe/Berlin",
			helpImproveProduct: false,
		});
		const { errors, html } = await serverRender("/en/time-tracking");
		expect(errors).toEqual([]);
		expect(html).toContain('data-consent="false"');
		expect(html).toContain('data-week-start="monday"');
		expect(html).toContain('data-time-format="12h"');
		expect(html).toContain('data-timezone="Europe/Berlin"');
		expect(mockState.findUserSettings).toHaveBeenCalledOnce();
	});

	it("keeps preference defaults and loads organization settings without an active organization", async () => {
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: null },
		});
		mockState.findUserSettings.mockResolvedValue(undefined);
		const { errors, html } = await serverRender("/en/time-tracking");
		expect(errors).toEqual([]);
		expect(html).toContain('data-consent="true"');
		expect(html).toContain('data-week-start="sunday"');
		expect(html).toContain('data-time-format="24h"');
		expect(html).toContain('data-timezone="UTC"');
		expect(mockState.getOrganizationSettings).toHaveBeenCalledWith(null, "user-1");
		expect(mockState.checkBillingAccess).not.toHaveBeenCalled();
	});

	it("does not invoke protected children or downstream loaders for an invalid session", async () => {
		mockState.getSession.mockResolvedValue(null);

		const { errors } = await serverRender("/en/settings/profile");

		expect(mockState.redirect).toHaveBeenCalledWith(
			"/api/auth/session-expired?locale=en&callbackUrl=%2Fen%2Fsettings%2Fprofile",
		);
		expect(errors).toEqual([
			expect.objectContaining({
				message:
					"TEST_REDIRECT:/api/auth/session-expired?locale=en&callbackUrl=%2Fen%2Fsettings%2Fprofile",
			}),
		]);
		expect(mockState.protectedChildRender).not.toHaveBeenCalled();
		expect(mockState.findUserSettings).not.toHaveBeenCalled();
		expect(mockState.getOrganizationSettings).not.toHaveBeenCalled();
		expect(mockState.checkBillingAccess).not.toHaveBeenCalled();
		expect(mockState.findMember).not.toHaveBeenCalled();
		expect(mockState.findSubscription).not.toHaveBeenCalled();
	});

	it("does not invoke protected children when billing fails closed outside recovery routes", async () => {
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "organization-1" },
			user: { id: "user-1" },
		});
		mockState.checkBillingAccess.mockRejectedValue(new Error("billing unavailable"));

		const { errors } = await serverRender("/en/settings/profile");

		expect(mockState.loggerError).toHaveBeenCalled();
		expect(mockState.redirect).toHaveBeenCalledWith("/en/billing/suspended");
		expect(errors).toEqual([
			expect.objectContaining({
				message: "TEST_REDIRECT:/en/billing/suspended",
			}),
		]);
		expect(mockState.protectedChildRender).not.toHaveBeenCalled();
	});

	it("renders protected children after all authorization gates succeed", async () => {
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "organization-1" },
			user: { id: "user-1" },
		});

		const { errors, html } = await serverRender("/en/settings/profile");

		expect(errors).toEqual([]);
		expect(mockState.redirect).not.toHaveBeenCalled();
		expect(mockState.protectedChildRender).toHaveBeenCalledTimes(1);
		expect(html).toContain("Protected child content");
	});

	it("places the offline banner in flow below the header, not over it", async () => {
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "organization-1" },
			user: { id: "user-1" },
		});

		const { html } = await serverRender("/en/time-tracking");

		const header = html.indexOf("<header");
		const banner = html.indexOf('data-testid="offline-banner"');
		expect(header).toBeGreaterThan(-1);
		expect(banner).toBeGreaterThan(header);
		expect(html.indexOf("Protected child content")).toBeGreaterThan(banner);
	});

	it("passes the configured store listings to the get-the-app banner", async () => {
		const { html } = await serverRender("/en/time-tracking");

		expect(html).toContain('data-testid="get-the-app-banner"');
		expect(html).toContain('data-ios="https://apps.apple.com/app/z8/id1234567890"');
		expect(html).toContain('data-android="null"');
	});
});
