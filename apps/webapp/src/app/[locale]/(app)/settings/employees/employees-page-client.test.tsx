/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import { EmployeesPageClient } from "./employees-page-client";

const { useEmployeesMock } = vi.hoisted(() => ({
	useEmployeesMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			params?: Record<string, string | number>,
		) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) =>
				params?.[key] === undefined ? match : String(params[key]),
			),
	}),
}));

vi.mock("@/lib/query", () => ({
	queryKeys: {
		employees: { organization: () => ["employees"] },
		invitations: { list: () => ["invitations"] },
		members: { list: () => ["members"] },
	},
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

vi.mock("@/lib/query/use-employees", () => ({
	useEmployees: useEmployeesMock,
}));

vi.mock("./columns", () => ({
	createEmployeeColumns: () => [
		{
			id: "employeeName",
			header: "Employee",
			cell: ({
				row,
			}: {
				row: { original: Pick<EmployeeDirectoryRow, "user"> };
			}) => row.original.user.name,
		},
	],
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => null,
}));
vi.mock("@/components/organization/invite-code-management", () => ({
	InviteCodeManagement: () => null,
}));
vi.mock("@/components/organization/invite-member-dialog", () => ({
	InviteMemberDialog: () => null,
}));
vi.mock("@/components/organization/members-table", () => ({
	MembersTable: () => null,
}));
vi.mock("@/components/organization/pending-members-card", () => ({
	PendingMembersCard: () => null,
}));

const source = readFileSync(
	join(
		process.cwd(),
		"src/app/[locale]/(app)/settings/employees/employees-page-client.tsx",
	),
	"utf8",
);

const employee = {
	id: "employee-1",
	kind: "employee",
	user: {
		id: "user-1",
		name: "Ada Employee",
		email: "ada@example.com",
	},
} as EmployeeDirectoryRow;

beforeEach(() => {
	useEmployeesMock.mockImplementation(() => {
		const [pagination, setPagination] = useState({
			pageIndex: 0,
			pageSize: 1,
		});

		return {
			employees: [employee],
			total: 2,
			isLoading: false,
			isFetching: false,
			hasEmployee: true,
			role: "all",
			status: "all",
			setSearch: vi.fn(),
			setRole: vi.fn(),
			setStatus: vi.fn(),
			pagination,
			setPagination,
			pageCount: 2,
			refresh: vi.fn(),
		};
	});
});

function renderEmployeeDirectory() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<EmployeesPageClient
				accessTier="member"
				organizationId="org-1"
				currentUserId="user-1"
				currentMemberRole="member"
			/>
		</QueryClientProvider>,
	);
}

describe("EmployeesPageClient people-management tabs", () => {
	it("renders an employee row and controls server pagination through the native table", () => {
		renderEmployeeDirectory();

		expect(screen.getByRole("cell", { name: "Ada Employee" })).toBeTruthy();
		expect(screen.getByText("Page 1 of 2")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Next" }));

		expect(screen.getByText("Page 2 of 2")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("keeps the employee directory as a focused child component", () => {
		expect(source).toContain("function EmployeeDirectoryTab");
		expect(source).toContain("<EmployeeDirectoryTab");
	});

	it("renders org-admin people tabs on the employees page", () => {
		expect(source).toContain('Tabs defaultValue="employees"');
		expect(source).toContain('TabsTrigger value="employees"');
		expect(source).toContain('TabsTrigger value="members"');
		expect(source).toContain('TabsTrigger value="invitations"');
		expect(source).toContain('TabsTrigger value="invite-codes"');
		expect(source).toContain("<MembersTable");
		expect(source).toContain("<PendingMembersCard");
		expect(source).toContain("<InviteCodeManagement");
		expect(source).toContain("<InviteMemberDialog");
		expect(source).toContain('defaultTab="invitations"');
	});

	it("does not send invite actions back to organization settings", () => {
		expect(source).not.toContain('href="/settings/organizations"');
		expect(source).not.toContain("href='/settings/organizations'");
	});

	it("passes actor identity and role to the employee directory", () => {
		expect(source).toContain("currentUserId={props.currentUserId}");
		expect(source).toContain("currentMemberRole={props.currentMemberRole}");
	});

	it("updates exact cached rows without deleting historical employees", () => {
		expect(source).toContain("row.id === employeeId");
		expect(source).toContain("updateCachedEmployee(employeeId, { isActive })");
		expect(source).toContain("membership: null");
		expect(source).toContain("setQueriesData<PaginatedEmployeeResponse>");
		expect(source).not.toContain(
			"employees.filter((row) => row.id !== employeeId)",
		);
	});

	it("uses the native TanStack Table v9 employee feature boundary", () => {
		expect(source).toContain("useTable({");
		expect(source).toContain("features: employeeTableFeatures");
		expect(source).toContain("table.state.pagination.pageIndex");
		expect(source).not.toContain("useCompilerSafeReactTable");
		expect(source).not.toContain("getCoreRowModel");
	});
});
