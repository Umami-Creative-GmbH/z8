/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const readyData: PayrollReadinessResult = {
	status: "ready",
	period: {
		start: "2026-03-01",
		end: "2026-03-31",
		label: "01 Mar 2026 - 31 Mar 2026",
	},
	summary: {
		blockerCount: 0,
		warningCount: 0,
		affectedEmployeeCount: 0,
		configuredExportTargetCount: 2,
	},
	groups: [
		{
			id: "time",
			title: "Time",
			status: "pass",
			checks: [
				{
					id: "pending-approvals",
					group: "time",
					title: "Pending approvals",
					description: "All approval requests are resolved.",
					status: "pass",
					severity: "info",
					required: true,
					count: 0,
					affectedEmployees: [],
				},
			],
		},
	],
};

describe("PayrollReadinessDashboard", () => {
	it("renders a ready summary with Ready for payroll and period label", async () => {
		const { PayrollReadinessDashboard } = await import("./payroll-readiness-dashboard");

		render(<PayrollReadinessDashboard t={t} data={readyData} />);

		expect(screen.getByText("Ready for payroll")).toBeTruthy();
		expect(screen.getByText("01 Mar 2026 - 31 Mar 2026")).toBeTruthy();
		expect(screen.getByText("Blockers")).toBeTruthy();
		expect(screen.getByText("Warnings")).toBeTruthy();
		expect(screen.getByText("Configured export targets")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Pending approvals", level: 2 })).toBeTruthy();
	});

	it("renders a payroll export link", async () => {
		const { PayrollReadinessDashboard } = await import("./payroll-readiness-dashboard");

		render(<PayrollReadinessDashboard t={t} data={readyData} />);

		const payrollExportLink = screen.getByRole("link", { name: "Open payroll export" });
		expect(payrollExportLink.getAttribute("href")).toBe("/settings/payroll-export");
	});

	it("renders blocked summary and affected employee row with name and employee number", async () => {
		const { PayrollReadinessDashboard } = await import("./payroll-readiness-dashboard");
		const affectedEmployees: PayrollReadinessResult["groups"][number]["checks"][number]["affectedEmployees"] =
			[
				{
					id: "employee-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					employeeNumber: "E-1001",
				},
			];
		const blockedData: PayrollReadinessResult = {
			...readyData,
			status: "blocked",
			summary: {
				...readyData.summary,
				blockerCount: 1,
				affectedEmployeeCount: 1,
			},
			groups: [
				{
					id: "time",
					title: "Time",
					status: "fail",
					checks: [
						{
							id: "pending-approvals",
							group: "time",
							title: "Pending approvals",
							description:
								"All time and absence approval requests must be resolved before payroll export.",
							status: "fail",
							severity: "blocker",
							required: true,
							count: 1,
							actionHref: "/approvals/inbox",
							affectedEmployees,
						},
					],
				},
			],
		};

		render(<PayrollReadinessDashboard t={t} data={blockedData} />);

		expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
		const row = screen.getByRole("row", { name: /Ada Lovelace.*E-1001/ });
		expect(within(row).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(row).getByText("E-1001")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Review approval inbox" }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});
});
