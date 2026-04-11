/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ExportOperationsCockpitData } from "@/lib/export-operations/get-export-operations-cockpit";

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert", () => ({
	Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/table", () => ({
	Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
	TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
	TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
	TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
	TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
	TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}));

const t = (_key: string, defaultValue?: string) => defaultValue ?? _key;

const dashboardData: ExportOperationsCockpitData = {
	summary: {
		activeSchedules: 3,
		failedRunsLast7Days: 2,
		lastPayrollExportAt: new Date("2026-04-10T08:30:00.000Z"),
		lastAuditPackageAt: new Date("2026-04-09T16:45:00.000Z"),
	},
	alerts: [
		{
			id: "alert-payroll",
			source: "payroll",
			severity: "error",
			title: "Payroll export failed",
			description: "April payroll export could not be delivered.",
			occurredAt: new Date("2026-04-10T09:00:00.000Z"),
			href: "/settings/payroll-export",
		},
	],
	upcomingRuns: [
		{
			id: "run-1",
			source: "scheduled",
			name: "Weekly payroll export",
			scheduledFor: new Date("2026-04-12T06:00:00.000Z"),
			href: "/settings/scheduled-exports",
		},
	],
	recentActivity: [
		{
			id: "activity-audit",
			source: "audit",
			status: "completed",
			title: "Audit pack generated",
			description: "Quarterly audit package is ready to download.",
			occurredAt: new Date("2026-04-08T11:15:00.000Z"),
			href: "/settings/audit-export",
		},
	],
	errors: {
		summary: null,
		alerts: null,
		upcomingRuns: null,
		recentActivity: null,
	},
} as ExportOperationsCockpitData;

describe("ExportOperationsDashboard", () => {
	it("renders summary cards, alerts, upcoming runs, and recent activity with deep links", async () => {
		const { ExportOperationsDashboard } = await import("./export-operations-dashboard");

		render(<ExportOperationsDashboard t={t} data={dashboardData} />);

		expect(screen.getByText("Active schedules")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByText("Failed runs (7 days)")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("Last payroll export")).toBeTruthy();
		expect(screen.getByText("Last audit pack")).toBeTruthy();

		const alertsSection = screen.getByRole("heading", { name: "Alerts" }).closest("section");
		expect(alertsSection).toBeTruthy();
		expect(within(alertsSection as HTMLElement).getByText("Payroll export failed")).toBeTruthy();
		expect(
			within(alertsSection as HTMLElement)
				.getByRole("link", { name: "Open payroll export settings" })
				.getAttribute("href"),
		).toBe("/settings/payroll-export");

		const upcomingRunsSection = screen.getByRole("heading", { name: "Upcoming runs" }).closest("section");
		expect(upcomingRunsSection).toBeTruthy();
		expect(within(upcomingRunsSection as HTMLElement).getByText("Weekly payroll export")).toBeTruthy();
		expect(
			within(upcomingRunsSection as HTMLElement)
				.getByRole("link", {
					name: "Open scheduled export settings",
				})
				.getAttribute("href"),
		).toBe("/settings/scheduled-exports");

		const recentActivitySection = screen.getByRole("heading", { name: "Recent activity" }).closest("section");
		expect(recentActivitySection).toBeTruthy();
		expect(within(recentActivitySection as HTMLElement).getByText("Audit pack generated")).toBeTruthy();
		expect(
			within(recentActivitySection as HTMLElement)
				.getByRole("link", {
					name: "Open audit export settings",
				})
				.getAttribute("href"),
		).toBe("/settings/audit-export");
	});

	it("renders scoped section errors without hiding the rest of the cockpit", async () => {
		const { ExportOperationsDashboard } = await import("./export-operations-dashboard");

		render(
			<ExportOperationsDashboard
				t={t}
				data={{
					...dashboardData,
					alerts: [],
					upcomingRuns: [],
					recentActivity: [],
					errors: {
						summary: "Counts are based on the export data that could be loaded.",
						alerts: "Some alerts may be incomplete while export data is unavailable.",
						upcomingRuns: "Scheduled export data is temporarily unavailable.",
						recentActivity: "Some activity data is temporarily unavailable.",
					},
				}}
			/>,
		);

		expect(screen.getByText("Counts are based on the export data that could be loaded.")).toBeTruthy();
		expect(screen.getByText("Some alerts may be incomplete while export data is unavailable.")).toBeTruthy();
		expect(screen.getByText("Scheduled export data is temporarily unavailable.")).toBeTruthy();
		expect(screen.getByText("Some activity data is temporarily unavailable.")).toBeTruthy();

		expect(screen.getByText("No alerts right now")).toBeTruthy();
		expect(screen.getByText("No upcoming runs")).toBeTruthy();
		expect(screen.getByText("No recent export activity")).toBeTruthy();
		expect(screen.getByText("Active schedules")).toBeTruthy();
		expect(screen.getByText("Failed runs (7 days)")).toBeTruthy();
	});
});
