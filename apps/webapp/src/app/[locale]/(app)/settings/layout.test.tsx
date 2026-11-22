/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { type ReactElement, Suspense, use } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsMobileNav } from "@/components/settings/settings-mobile-nav";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";

// Translation acquisition/lifecycle is exercised with real Tolgee in route-boundary.test.tsx.
vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/settings/settings-breadcrumbs", () => ({
	SettingsBreadcrumbs: () => <nav aria-label="Settings breadcrumbs" />,
}));

vi.mock("@/components/settings/settings-nav", () => ({
	SettingsNav: () => <nav aria-label="Settings navigation" />,
}));

vi.mock("@/components/settings/settings-mobile-nav", () => ({
	SettingsMobileNav: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/env", () => ({
	env: { BILLING_ENABLED: "false" },
}));

vi.mock("@/lib/auth/render-context", () => ({
	getRenderSettingsAccess: vi.fn(async () => "orgAdmin"),
}));

vi.mock("@/lib/settings/capabilities.server", () => ({
	getRenderSettingsCapabilities: vi.fn(async () => ({
		canAccessClosedMonths: true,
		canManageApprovalEscalation: false,
		canManageProjects: true,
		canManageDrivingLicence: true,
		hasActiveReportShareLinks: false,
	})),
}));

const billingAccessState = vi.hoisted(() => ({
	canAccess: true,
	state: "active" as "active" | "suspended",
}));

vi.mock("../app-layout-content", () => ({
	getRenderBillingAccess: vi.fn(async () => ({ ...billingAccessState })),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(),
}));

const { default: SettingsLayout } = await import("./layout");

const pendingContent = new Promise<never>(() => {});

function PendingContent() {
	use(pendingContent);
	return <div>Settings content</div>;
}

async function layoutParts() {
	const boundary = SettingsLayout({
		params: Promise.resolve({ locale: "en" }),
		children: <PendingContent />,
	});
	expect(boundary.props.route).toBe("/settings");
	const shell = boundary.props.children;
	const layout = await shell.type(shell.props);
	const [navigationBoundary, main] = layout.props.children;
	const [headerRow, contentBoundary] = main.props.children;
	const [mobileNavigationBoundary, breadcrumbsBoundary] = headerRow
		? headerRow.props.children
		: [null, null];
	return {
		navigationBoundary,
		main,
		headerRow,
		mobileNavigationBoundary,
		breadcrumbsBoundary,
		contentBoundary,
	};
}

describe("SettingsLayout", () => {
	it("keeps navigation and breadcrumbs outside the child content boundary when billing is active", async () => {
		billingAccessState.canAccess = true;
		billingAccessState.state = "active";
		const { navigationBoundary, breadcrumbsBoundary, contentBoundary } = await layoutParts();

		expect(navigationBoundary.type).toBe(Suspense);
		expect(breadcrumbsBoundary.type).toBe(Suspense);
		expect(breadcrumbsBoundary.props.children.type.name).toBe("SettingsBreadcrumbs");
		expect(contentBoundary.type).toBe(Suspense);
		expect(contentBoundary.props.fallback.type).toBe(SettingsContentLoading);
		expect(contentBoundary.props.children.props.children.type).toBe(PendingContent);
	});

	it("shows the content fallback without hiding breadcrumbs while children wait", async () => {
		billingAccessState.canAccess = true;
		billingAccessState.state = "active";
		const { breadcrumbsBoundary, contentBoundary } = await layoutParts();

		render(
			<>
				{breadcrumbsBoundary}
				{contentBoundary}
			</>,
		);

		expect(screen.getByRole("navigation", { name: "Settings breadcrumbs" })).toBeTruthy();
		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
		expect(screen.queryByText("Settings content")).toBeNull();
	});

	it("puts the mobile settings menu beside the breadcrumbs, in its own boundary", async () => {
		billingAccessState.canAccess = true;
		billingAccessState.state = "active";
		const { headerRow, mobileNavigationBoundary } = await layoutParts();

		expect(headerRow.props.className).toContain("px-4");
		expect(headerRow.props.className).toContain("empty:hidden");
		expect(mobileNavigationBoundary.type).toBe(Suspense);
		const { container } = render(mobileNavigationBoundary.props.fallback);
		expect(container.firstElementChild?.className).toContain("md:hidden");
		expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
		expect(mobileNavigationBoundary.props.children.type.name).toBe("SettingsMobileNavigation");
	});

	it("renders the same server-computed navigation in the sidebar and the mobile drawer", async () => {
		billingAccessState.canAccess = true;
		billingAccessState.state = "active";
		const { navigationBoundary, mobileNavigationBoundary } = await layoutParts();
		const sidebar = (await navigationBoundary.props.children.type()) as ReactElement<{
			className: string;
			children: ReactElement;
		}>;
		const drawer = (await mobileNavigationBoundary.props.children.type()) as ReactElement<{
			children: ReactElement;
		}>;
		const expectedProps = {
			settingsAccess: "orgAdmin",
			billingEnabled: false,
			settingsCapabilities: {
				canAccessClosedMonths: true,
				canManageApprovalEscalation: false,
				canManageProjects: true,
				canManageDrivingLicence: true,
				hasActiveReportShareLinks: false,
			},
		};

		expect(sidebar.props.className).toContain("hidden md:block");
		expect(sidebar.props.children.type).toBe(SettingsNav);
		expect(sidebar.props.children.props).toEqual(expectedProps);
		expect(drawer.type).toBe(SettingsMobileNav);
		expect(drawer.props.children.type).toBe(SettingsNav);
		expect(drawer.props.children.props).toEqual(expectedProps);
	});

	it("omits the nested settings sidebar, mobile drawer, and breadcrumbs when billing is suspended", async () => {
		billingAccessState.canAccess = false;
		billingAccessState.state = "suspended";
		const {
			navigationBoundary,
			headerRow,
			mobileNavigationBoundary,
			breadcrumbsBoundary,
			contentBoundary,
		} = await layoutParts();

		expect(navigationBoundary).toBeNull();
		expect(headerRow).toBeNull();
		expect(mobileNavigationBoundary).toBeNull();
		expect(breadcrumbsBoundary).toBeNull();
		expect(contentBoundary.type).toBe(Suspense);
		expect(contentBoundary.props.children.props.children.type).toBe(PendingContent);
	});
});
