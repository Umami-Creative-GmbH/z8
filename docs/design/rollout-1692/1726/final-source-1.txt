// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import Page from "./page";
import { WorkBalancesView } from "./work-balances-view";

const scope = vi.hoisted(() => ({ userId: "actor", activeOrganizationId: "A" }));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => scope,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("./coverage", () => ({ loadPayrollWorkBalanceEmployees: async () => [] }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/components/settings/work-balance/opening-balance-upload-dialog", () => ({
	OpeningBalanceUploadDialog: () => <button type="button">Upload opening balances</button>,
}));

it("keeps the task heading during a pending directory read and adopts only this route", () => {
	render(Page().props.fallback);
	expect(screen.getByRole("heading", { level: 1, name: "Work balances" })).toBeTruthy();
	expect(appPageOwnsHeading("/de/payroll/work-balances")).toBe(true);
	expect(appPageOwnsHeading("/en/payroll/work-balances/employee")).toBe(false);
});

it("preserves complete employee identity, former status and destinations, hiding a mismatched server arrival", () => {
	const employees = [
		{
			id: "former",
			name: "A long former employee identity",
			employeeNumber: "A-1",
			isActive: false,
		},
	];
	const view = render(<WorkBalancesView employees={employees} userId="actor" organizationId="A" />);
	expect(
		screen
			.getByRole("link", {
				name: /A long former employee identity.*A-1.*Former employee.*Open employee balance/,
			})
			.getAttribute("href"),
	).toBe("/payroll/work-balances/former");
	expect(screen.getByRole("link", { name: "Payroll" }).getAttribute("href")).toBe("/payroll");
	expect(screen.getByRole("button", { name: "Upload opening balances" })).toBeTruthy();
	scope.activeOrganizationId = "B";
	view.rerender(<WorkBalancesView employees={employees} userId="actor" organizationId="A" />);
	expect(screen.queryByText("A long former employee identity")).toBeNull();
	scope.activeOrganizationId = "A";
	view.rerender(<WorkBalancesView employees={[]} userId="actor" organizationId="A" />);
	expect(screen.getByText("No employees are in your payroll access scope yet.")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Upload opening balances" })).toBeNull();
});
