import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./layout";

const mockState = vi.hoisted(() => ({
	checkBillingAccess: vi.fn(),
	findMember: vi.fn(),
	findSubscription: vi.fn(),
	findUserSettings: vi.fn(),
	getOrganizationSettings: vi.fn(),
	getSession: vi.fn(),
	getUserLocaleRaw: vi.fn(),
	getUserTimeFormat: vi.fn(),
	getUserTimezone: vi.fn(),
	getUserWeekStartDay: vi.fn(),
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

vi.mock("next/navigation", () => ({
	redirect: mockState.redirect,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...predicates: unknown[]) => predicates),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("effect", () => ({
	Effect: {
		flatMap: vi.fn(() => ({ pipe: vi.fn(() => undefined) })),
		provide: vi.fn(),
		runPromise: vi.fn(() => mockState.checkBillingAccess()),
	},
}));

vi.mock("@/components/billing/trial-banner", () => ({
	TrialBanner: () => null,
}));

vi.mock("@/components/notifications/push-permission-provider", () => ({
	PushPermissionProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/components/organization/organization-deletion-banner", () => ({
	OrganizationDeletionBanner: () => null,
}));

vi.mock("@/components/posthog-provider", () => ({
	PostHogProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/components/providers/organization-settings-provider", () => ({
	OrganizationSettingsProvider: ({
		children,
	}: {
		children: React.ReactNode;
	}) => <>{children}</>,
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	UserPreferencesProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/components/server-app-sidebar", () => ({
	ServerAppSidebar: () => <aside />,
}));

vi.mock("@/components/site-header", () => ({
	SiteHeader: () => <header />,
}));

vi.mock("@/components/ui/sidebar", () => ({
	Sidebar: ({ children }: { children: React.ReactNode }) => (
		<aside>{children}</aside>
	),
	SidebarContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SidebarFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SidebarHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SidebarInset: ({ children }: { children: React.ReactNode }) => (
		<main>{children}</main>
	),
	SidebarProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
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
	env: { BILLING_ENABLED: "true", NODE_ENV: "test" },
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mockState.getSession } },
}));

vi.mock("@/lib/bot-platform/i18n", () => ({
	getUserLocaleRaw: mockState.getUserLocaleRaw,
}));

vi.mock("@/lib/effect/services/billing/billing-enforcement.service", () => ({
	BillingEnforcementService: {},
	BillingEnforcementServiceLive: {},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: mockState.loggerError }),
}));

vi.mock("@/lib/organization-settings", () => ({
	getOrganizationSettings: mockState.getOrganizationSettings,
}));

vi.mock("@/lib/user-preferences/time-format-server", () => ({
	getUserTimeFormat: mockState.getUserTimeFormat,
}));

vi.mock("@/lib/user-preferences/timezone-server", () => ({
	getUserTimezone: mockState.getUserTimezone,
}));

vi.mock("@/lib/user-preferences/week-start-server", () => ({
	getUserWeekStartDay: mockState.getUserWeekStartDay,
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
	mockState.getUserLocaleRaw.mockResolvedValue(null);
	mockState.getUserWeekStartDay.mockResolvedValue(1);
	mockState.getUserTimeFormat.mockResolvedValue("24h");
	mockState.getUserTimezone.mockResolvedValue("UTC");
	mockState.findUserSettings.mockResolvedValue({ helpImproveProduct: true });
	mockState.getOrganizationSettings.mockResolvedValue({});
	mockState.findMember.mockResolvedValue({ role: "owner" });
	mockState.findSubscription.mockResolvedValue(null);
	mockState.checkBillingAccess.mockResolvedValue({
		canAccess: true,
		state: "active",
	});
});

describe("authenticated app layout gates", () => {
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
		expect(mockState.getUserLocaleRaw).not.toHaveBeenCalled();
		expect(mockState.getUserWeekStartDay).not.toHaveBeenCalled();
		expect(mockState.getUserTimeFormat).not.toHaveBeenCalled();
		expect(mockState.getUserTimezone).not.toHaveBeenCalled();
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
		mockState.checkBillingAccess.mockRejectedValue(
			new Error("billing unavailable"),
		);

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
});
