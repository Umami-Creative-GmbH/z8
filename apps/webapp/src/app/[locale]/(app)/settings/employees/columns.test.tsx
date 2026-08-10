/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeWithRelations } from "./actions";
import { createEmployeeColumns } from "./columns";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import type { EmployeeTableFeatures } from "./employee-table-features";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({
		name,
		clockStatus,
	}: {
		name?: string | null;
		clockStatus?: "clocked-in" | "clocked-out" | "unknown";
	}) => (
		<span
			data-avatar-name={name ?? ""}
			data-clock-status={clockStatus ?? "unknown"}
		/>
	),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("./actions", async (importOriginal) => ({
	...(await importOriginal<typeof import("./actions")>()),
	deactivateEmployee: vi.fn(),
	reactivateEmployee: vi.fn(),
	removeEmployeeAccess: vi.fn(),
}));

const defaultColumnOptions = {
	organizationId: "org_1",
	currentUserId: "owner-user",
	currentMemberRole: "owner",
	onOptimisticStatusChange: vi.fn(),
	onRemoved: vi.fn(),
};

function getColumns(overrides: Partial<typeof defaultColumnOptions> = {}) {
	return createEmployeeColumns({ ...defaultColumnOptions, ...overrides });
}

function renderEmployeeCell(employee: EmployeeDirectoryRow) {
	const columns = getColumns();
	const employeeColumn = columns[0] as ColumnDef<
		EmployeeTableFeatures,
		EmployeeDirectoryRow
	>;
	const cell = employeeColumn.cell;

	if (typeof cell !== "function")
		throw new Error("Employee cell is not renderable");

	render(
		cell({ row: { original: employee } } as Parameters<
			typeof cell
		>[0]) as React.ReactElement,
	);
}

function renderActionsCell(
	employee: EmployeeDirectoryRow,
	overrides: Partial<typeof defaultColumnOptions> = {},
) {
	const columns = getColumns(overrides);
	const actionsColumn = columns.find((column) => column.id === "actions");
	const cell = actionsColumn?.cell;
	if (typeof cell !== "function")
		throw new Error("Actions cell is not renderable");

	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			{
				cell({ row: { original: employee } } as Parameters<
					typeof cell
				>[0]) as React.ReactElement
			}
		</QueryClientProvider>,
	);
}

function createEmployee(
	overrides: Partial<EmployeeWithRelations> = {},
): EmployeeWithRelations {
	return {
		id: "emp_1",
		userId: "user_1",
		organizationId: "org_1",
		firstName: "Structured",
		lastName: "Name",
		pronouns: null,
		position: null,
		role: "employee",
		isActive: true,
		kind: "employee",
		membership: { id: "member-1", role: "member", status: "approved" },
		teamId: null,
		contractType: "fixed",
		gender: null,
		employeeNumber: null,
		phone: null,
		emergencyContact: null,
		startDate: null,
		endDate: null,
		createdAt: new Date("2024-01-01T00:00:00Z"),
		updatedAt: new Date("2024-01-01T00:00:00Z"),
		user: {
			id: "user_1",
			name: "Directory Name",
			email: "directory@example.com",
			image: null,
		} as EmployeeWithRelations["user"],
		team: null,
		...overrides,
	} as EmployeeWithRelations;
}

function createDraft(
	overrides: Partial<EmployeeDirectoryRow> = {},
): EmployeeDirectoryRow {
	const createdAt = new Date("2024-01-01T00:00:00Z");
	return {
		id: "draft-1",
		encodedId: "draft:draft-1",
		invitationId: "invite-1",
		organizationId: "org_1",
		teamId: null,
		role: "manager",
		firstName: "Invited",
		lastName: "Manager",
		position: "Ops Lead",
		employeeNumber: "D-1",
		gender: null,
		pronouns: null,
		birthday: null,
		startDate: null,
		endDate: null,
		contractType: "fixed",
		currentHourlyRate: null,
		updatedBy: null,
		createdAt,
		updatedAt: createdAt,
		kind: "invitationDraft",
		userId: "draft-1",
		invitation: {
			id: "invite-1",
			organizationId: "org_1",
			email: "invited@example.com",
			role: "member",
			status: "pending",
			expiresAt: createdAt,
			createdAt,
			inviterId: "admin-1",
			canCreateOrganizations: false,
			targetTeamId: null,
		},
		team: null,
		user: {
			id: "draft-1",
			name: "Invited Manager",
			email: "invited@example.com",
			emailVerified: false,
			image: null,
			createdAt,
			updatedAt: createdAt,
			role: null,
			banned: null,
			banReason: null,
			banExpires: null,
			twoFactorEnabled: null,
			firstName: "Invited",
			lastName: "Manager",
			canCreateOrganizations: null,
			invitedVia: null,
			pendingInviteCode: null,
			canUseWebapp: true,
			canUseDesktop: true,
			canUseMobile: true,
		},
		isActive: false,
		invitationStatus: "pending",
		realEmployeeId: null,
		...overrides,
	} as EmployeeDirectoryRow;
}

describe("employee directory columns", () => {
	it("preserves the user name when pronouns are absent", () => {
		renderEmployeeCell(createEmployee());

		expect(screen.getByText("Directory Name")).toBeTruthy();
		expect(screen.queryByText("Structured Name")).toBeNull();
		expect(
			screen.getByText("", { selector: '[data-avatar-name="Directory Name"]' }),
		).toBeTruthy();
	});

	it("appends pronouns to the user name when present", () => {
		renderEmployeeCell(createEmployee({ pronouns: "they/them" }));

		const displayName = screen.getByText("Directory Name (they/them)");
		expect(displayName).toBeTruthy();
		expect(displayName.className).toContain("truncate");
		expect(displayName.parentElement?.className).toContain("min-w-0");
		expect(
			screen.getByText("", {
				selector: '[data-avatar-name="Directory Name (they/them)"]',
			}),
		).toBeTruthy();
	});

	it("passes clock status to the directory avatar", () => {
		renderEmployeeCell(
			createEmployee({
				clockStatus: "clocked-in",
			} as Partial<EmployeeWithRelations>),
		);

		expect(
			screen.getByText("", { selector: '[data-clock-status="clocked-in"]' }),
		).toBeTruthy();
	});

	it("links draft rows with encoded draft ids", () => {
		const columns = getColumns();
		const actionsColumn = columns.find((column) => column.id === "actions");
		const cell = actionsColumn?.cell;
		if (typeof cell !== "function")
			throw new Error("Actions cell is not renderable");

		render(
			cell({
				row: { original: createDraft({ encodedId: "draft:draft-1" }) },
			} as Parameters<typeof cell>[0]) as React.ReactElement,
		);

		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"/settings/employees/draft:draft-1",
		);
	});

	it("renders invitation drafts with draft status and draft detail link", () => {
		renderEmployeeCell(createDraft());
		expect(screen.getByText("Invited Manager")).toBeTruthy();
		expect(screen.getByText("invited@example.com")).toBeTruthy();

		const columns = getColumns();
		const statusColumn = columns.find(
			(column) =>
				column.id === "status" ||
				("accessorKey" in column && column.accessorKey === "isActive"),
		);
		const statusCell = statusColumn?.cell;
		if (typeof statusCell !== "function")
			throw new Error("Status cell is not renderable");
		render(
			statusCell({ row: { original: createDraft() } } as Parameters<
				typeof statusCell
			>[0]) as React.ReactElement,
		);
		expect(screen.getByText("Draft")).toBeTruthy();
		expect(screen.getByText("pending")).toBeTruthy();

		const actionsColumn = columns.find((column) => column.id === "actions");
		const actionsCell = actionsColumn?.cell;
		if (typeof actionsCell !== "function")
			throw new Error("Actions cell is not renderable");
		render(
			actionsCell({ row: { original: createDraft() } } as Parameters<
				typeof actionsCell
			>[0]) as React.ReactElement,
		);
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"/settings/employees/draft:draft-1",
		);
	});

	it.each([
		[true, "Deactivate"],
		[false, "Reactivate"],
	] as const)("renders owner lifecycle controls for a real employee with active=%s", async (isActive, action) => {
		renderActionsCell(createEmployee({ isActive }));

		fireEvent.click(
			screen.getByRole("button", {
				name: "Employee actions for Directory Name",
			}),
		);
		const menu = await screen.findByRole("menu");

		expect(within(menu).getByRole("menuitem", { name: action })).toBeTruthy();
		expect(
			within(menu).getByRole("menuitem", { name: "Remove access" }),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "View Details" })).toBeTruthy();
	});

	it("renders no lifecycle controls for a manager actor", () => {
		renderActionsCell(createEmployee(), { currentMemberRole: "member" });

		expect(
			screen.queryByRole("button", { name: /Employee actions for/ }),
		).toBeNull();
		expect(screen.getByRole("link", { name: "View Details" })).toBeTruthy();
	});

	it.each([
		"owner",
		"member,owner",
	])("hides lifecycle controls from admins for target owner role %s", (targetRole) => {
		renderActionsCell(
			createEmployee({
				membership: {
					id: "member-1",
					role: targetRole,
					status: "approved",
				},
			}),
			{ currentMemberRole: "admin" },
		);

		expect(
			screen.queryByRole("button", { name: /Employee actions for/ }),
		).toBeNull();
	});

	it.each([
		"owner",
		"member,owner",
	])("shows lifecycle controls to another owner for target owner role %s", async (targetRole) => {
		renderActionsCell(
			createEmployee({
				membership: {
					id: "member-1",
					role: targetRole,
					status: "approved",
				},
			}),
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Employee actions for Directory Name",
			}),
		);
		expect(
			await screen.findByRole("menuitem", { name: "Deactivate" }),
		).toBeTruthy();
	});

	it("keeps draft actions limited to draft status and View Details", () => {
		const draft = createDraft();
		renderActionsCell(draft);

		expect(
			screen.queryByRole("button", { name: /Employee actions for/ }),
		).toBeNull();
		expect(screen.getByRole("link", { name: "View Details" })).toBeTruthy();
	});

	it("passes employee ids through lifecycle callbacks", async () => {
		const onOptimisticStatusChange = vi.fn();
		const onRemoved = vi.fn();
		renderActionsCell(createEmployee(), {
			onOptimisticStatusChange,
			onRemoved,
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Employee actions for Directory Name",
			}),
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Deactivate" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

		expect(onOptimisticStatusChange).toHaveBeenCalledWith("emp_1", false);
	});

	it("offers draft as an employee status filter", () => {
		const source = readFileSync(
			"src/app/[locale]/(app)/settings/employees/employees-page-client.tsx",
			"utf8",
		);
		expect(source).toContain('<SelectItem value="draft">');
		expect(source).toContain("settings.employees.directory.statuses.draft");
	});
});
