// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/[locale]/(app)/personnel-files/payslip-batches/[batchId]/page";
import { SiteHeader } from "@/components/site-header";


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
	usePathname: () => "/en/personnel-files/payslip-batches/9f6c3b8f-f024-48f1-a15d-58a1e9c5c08d",
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


it("renders one safe h1 from the actual detail Page fallback alongside SiteHeader", () => {
  const fallback = Page({ params: Promise.resolve({ batchId: "9f6c3b8f-f024-48f1-a15d-58a1e9c5c08d" }) }).props.fallback;
  render(<><SiteHeader /><main>{fallback}</main></>);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Payslip batch" })).toBeTruthy();
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByLabelText("Payslip files")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save payslips" })).toBeNull();
});
