// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import Page from "./page";

const mocks = vi.hoisted(() => ({ coverage: vi.fn(), auth: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("../coverage", () => ({ loadPayrollWorkBalanceEmployees: mocks.coverage }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw Error("NOT_FOUND");
	},
}));
vi.mock("@/components/payroll/employee-balance-workspace", () => ({
	EmployeeBalanceWorkspace: ({
		employee,
		organizationId,
		userId,
	}: {
		employee: { name: string };
		organizationId: string;
		userId: string;
	}) => (
		<div>
			{employee.name} · {organizationId} · {userId}
		</div>
	),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("keeps a safe task heading while the actual employee route is waiting for admission", () => {
	render(Page({ params: Promise.resolve({ employeeId: "employee" }) }).props.fallback);
	expect(screen.getByRole("heading", { level: 1, name: "Work balance" })).toBeTruthy();
	expect(screen.getByRole("status", { name: "Loading the work balance" })).toBeTruthy();
	expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(1);
});

async function content(employeeId: string) {
	const page = Page({ params: Promise.resolve({ employeeId }) });
	const child = page.props.children;
	return child.type(child.props);
}
it("hands the covered former identity and authenticated scope to the assembled workspace", async () => {
	const id = "109be870-c930-4e3a-b4b4-e35f2c0d8353";
	mocks.coverage.mockResolvedValue([
		{ id, name: "Covered former person", isActive: false, employeeNumber: null },
	]);
	mocks.auth.mockResolvedValue({
		user: { id: "holder" },
		session: { activeOrganizationId: "org" },
	});
	render(<Suspense>{await content(id)}</Suspense>);
	expect(screen.getByText("Covered former person · org · holder")).toBeTruthy();
	expect(mocks.coverage).toHaveBeenCalledWith(id);
});
it("keeps uncovered and foreign target arrivals not-found", async () => {
	mocks.coverage.mockResolvedValue([]);
	mocks.auth.mockResolvedValue({
		user: { id: "holder" },
		session: { activeOrganizationId: "org" },
	});
	await expect(content("109be870-c930-4e3a-b4b4-e35f2c0d8353")).rejects.toThrow("NOT_FOUND");
	await expect(content("malformed")).rejects.toThrow("NOT_FOUND");
	expect(mocks.coverage).toHaveBeenCalledTimes(1);
});
it("opts only the selected payroll route into page-heading ownership", () => {
	expect(appPageOwnsHeading("/de/payroll/work-balances/employee")).toBe(true);
	expect(appPageOwnsHeading("/de/payroll/work-balances/employee/other")).toBe(false);
	expect(appPageOwnsHeading("/en/payroll")).toBe(true);
});
