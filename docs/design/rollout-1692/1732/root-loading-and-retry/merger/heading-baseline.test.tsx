/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { SiteHeader } from "./baseline-site-header";
import Page from "./baseline-page";


const pathname = "/en/personnel-files/payslip-batches";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	usePathname: () => pathname,
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


vi.mock('@/tolgee/server',()=>({getTranslate:async()=> (_key:string,fallback:string)=>fallback}));
vi.mock('@/lib/personnel-file/current-access',()=>({loadCurrentPersonnelFileAccess:async()=>({status:'unauthenticated'})}));

it('MERGE1732 preserves exactly one safe heading while the actual route admission fallback is pending',()=>{
 const fallback=Page({params:Promise.resolve({locale:'en'})}).props.fallback;
 render(<><SiteHeader/><main>{fallback}</main></>);
 const headings=screen.queryAllByRole('heading',{level:1}).map(n=>n.textContent);
 console.log('MERGE1732 fallback headings',JSON.stringify(headings));
 expect(headings).toHaveLength(1);
});
