// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/[locale]/(app)/personnel-files/payslip-batches/page";
import { SiteHeader } from "@/components/site-header";
import { PayslipBatchesScope } from "./payslip-batches-scope";

const boundary = vi.hoisted(() => ({
	refetch: vi.fn(),
	organization: {
		userId: "actor-a",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null as string | null,
	},
}));

vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => ({ ...boundary.organization, refetch: boundary.refetch }),
}));

beforeEach(() => {
	vi.clearAllMocks();
	boundary.organization = {
		userId: "actor-a",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null,
	};
});

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/personnel-file/current-access", () => ({
	loadCurrentPersonnelFileAccess: async () => ({ status: "unauthenticated" }),
}));
vi.mock("@/navigation", () => ({
	usePathname: () => "/en/personnel-files/payslip-batches",
}));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
	useUserTimezone: () => "Europe/Berlin",
}));
vi.mock("@/components/header-refresh-button", () => ({
	HeaderRefreshButton: ({ children }: { children?: ReactNode }) => (
		<button type="button">{children ?? "Refresh data"}</button>
	),
}));
vi.mock("@/components/header-timezone-control", () => ({
	HeaderTimezoneControl: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Timezone</button>,
}));
vi.mock("@/components/notifications", () => ({
	NotificationBell: () => <button type="button">Notifications</button>,
}));
vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Toggle theme</button>,
}));
vi.mock("@/components/time-tracking/time-clock-popover", () => ({
	TimeClockPopover: () => <button type="button">Clock In</button>,
}));
vi.mock("@/components/ui/sidebar", () => ({
	SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}));
vi.mock("@/components/dashboard/dashboard-header-customize", () => ({
	DashboardHeaderCustomize: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Customize dashboard</button>,
}));

it("keeps one safe main heading during the actual route admission fallback", () => {
	const fallback = Page({ params: Promise.resolve({ locale: "en" }) }).props.fallback;
	render(
		<>
			<SiteHeader />
			<main>{fallback}</main>
		</>,
	);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(screen.getByRole("heading", { level: 1, name: "Payslip batches" })).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: /Pay period year/ })).toBeNull();
	expect(screen.queryByRole("button", { name: "Start batch" })).toBeNull();
});

it.each(["loading", "error", "organization", "account"] as const)(
	"keeps a safe title and hides stale records while %s prevents scope confirmation",
	(state) => {
		boundary.organization = {
			...boundary.organization,
			...(state === "loading"
				? { isLoading: true }
				: state === "error"
					? { error: "Read failed" }
					: state === "organization"
						? { activeOrganizationId: "org-b" }
						: { userId: "actor-b" }),
		};
		render(
			<>
				<SiteHeader />
				<main>
					<PayslipBatchesScope userId="actor-a" organizationId="org-a">
						<p>Previous batch evidence</p>
						<button type="button">Start batch</button>
					</PayslipBatchesScope>
				</main>
			</>,
		);
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByRole("heading", { level: 1, name: "Payslip batches" })).toBeTruthy();
		expect(screen.queryByText("Previous batch evidence")).toBeNull();
		expect(screen.queryByRole("button", { name: "Start batch" })).toBeNull();
		if (state === "error") {
			expect(screen.getByRole("alert")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			expect(boundary.refetch).toHaveBeenCalledTimes(1);
		}
	},
);
