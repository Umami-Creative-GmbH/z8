import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getRequestSessionMock,
	getCurrentSettingsAccessMock,
	getStatisticsScopeMock,
	loadOrganizationTimezoneMock,
	redirectWithLocaleMock,
} = vi.hoisted(() => ({
	getRequestSessionMock: vi.fn(),
	getCurrentSettingsAccessMock: vi.fn(),
	getStatisticsScopeMock: vi.fn(),
	loadOrganizationTimezoneMock: vi.fn(),
	redirectWithLocaleMock: vi.fn((path: string): never => {
		throw new Error(`NEXT_REDIRECT:${path}`);
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: async () => "en",
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: getRequestSessionMock,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: getCurrentSettingsAccessMock,
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: loadOrganizationTimezoneMock,
}));

vi.mock("../../settings/statistics/actions", () => ({
	getStatisticsScope: getStatisticsScopeMock,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("../analytics-heading", () => ({
	AnalyticsHeading: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
		<header>
			<h1>{title}</h1>
			{actions}
		</header>
	),
}));

vi.mock("../analytics-tabs", () => ({
	AnalyticsTabs: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
}));

vi.mock("@/components/ui/tabs", () => ({
	TabsList: ({ children }: { children: React.ReactNode }) => <div role="tablist">{children}</div>,
	TabsTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AnalyticsLayout from "../layout";

async function renderLayoutContent(children: React.ReactNode = <main>Body</main>) {
	const layout = AnalyticsLayout({
		children,
		params: Promise.resolve({ locale: "en" }),
	});
	const suspense = layout.props.children as {
		props: {
			children: {
				type: (p: { children: React.ReactNode }) => Promise<React.ReactElement>;
				props: { children: React.ReactNode };
			};
		};
	};
	const content = suspense.props.children;
	const element = await content.type(content.props);
	return renderToStaticMarkup(element);
}

describe("analytics layout unified auth and tabs (#1955)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getRequestSessionMock.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		loadOrganizationTimezoneMock.mockResolvedValue("UTC");
		getStatisticsScopeMock.mockResolvedValue({
			success: true,
			data: {
				scope: { organizationWide: true },
				fetchedAt: "2026-03-15T10:00:00.000Z",
			},
		});
	});

	it("admits an org admin without an employee record and renders the five tabs with scope and last-updated context", async () => {
		getCurrentSettingsAccessMock.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: null,
			settingsAccess: "orgAdmin",
			membershipRole: "admin",
		});

		const html = await renderLayoutContent();
		expect(html).toContain("Whole organization");
		expect(html).toContain("Last updated");
		expect(html).toContain("Body");

		const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs).toEqual([
			"/analytics",
			"/analytics/team-performance",
			"/analytics/work-hours",
			"/analytics/overtime-burn-down",
			"/analytics/vacation-trends",
		]);
		expect(html).toContain("Overview");
		expect(html).toContain("Team Performance");
		expect(html).toContain("Work Hours");
		expect(html).toContain("Overtime Burn-Down");
		expect(html).toContain("Absences &amp; Vacation");
		expect(html).not.toContain("Vacation Trends");
	});

	it("admits a manager with managed-team scope context", async () => {
		getCurrentSettingsAccessMock.mockResolvedValue({
			userId: "user-manager",
			organizationId: "org-1",
			employee: { id: "emp-manager", role: "manager" },
			settingsAccess: "scopedManager",
			membershipRole: "member",
		});
		getStatisticsScopeMock.mockResolvedValue({
			success: true,
			data: {
				scope: { organizationWide: false, teamCount: 2 },
				fetchedAt: "2026-03-15T10:00:00.000Z",
			},
		});

		const html = await renderLayoutContent();
		expect(html).toContain("Body");
		expect(html).toContain("Last updated");
		expect(html).not.toContain("Whole organization");
	});

	it("denies a plain employee with the restricted view", async () => {
		getCurrentSettingsAccessMock.mockResolvedValue({
			userId: "user-member",
			organizationId: "org-1",
			employee: { id: "emp-member", role: "employee" },
			settingsAccess: "member",
			membershipRole: "member",
		});

		const html = await renderLayoutContent();
		expect(html).toContain("Access Restricted");
		expect(html).not.toContain("Body");
		expect(getStatisticsScopeMock).not.toHaveBeenCalled();
	});

	it("redirects unauthenticated visitors to sign-in", async () => {
		getRequestSessionMock.mockResolvedValue(null);

		await expect(renderLayoutContent()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
	});
});
