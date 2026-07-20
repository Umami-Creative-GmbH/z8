/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query";
import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils";
import { MembersTable } from "./members-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			values?: Record<string, unknown>,
		) => defaultValue?.replace("{count}", String(values?.count ?? "")) ?? _key,
	}),
}));

const {
	cancelInvitationMock,
	deactivateEmployeeMock,
	reactivateEmployeeMock,
	removeEmployeeAccessMock,
	routerRefreshMock,
	resendInvitationMock,
	sendInvitationMock,
	toastErrorMock,
	updateMemberRoleMock,
} = vi.hoisted(() => ({
	cancelInvitationMock: vi.fn(),
	deactivateEmployeeMock: vi.fn(),
	reactivateEmployeeMock: vi.fn(),
	removeEmployeeAccessMock: vi.fn(),
	routerRefreshMock: vi.fn(),
	resendInvitationMock: vi.fn(),
	sendInvitationMock: vi.fn(),
	toastErrorMock: vi.fn(),
	updateMemberRoleMock: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	cancelInvitation: cancelInvitationMock,
	resendInvitation: resendInvitationMock,
	sendInvitation: sendInvitationMock,
	updateMemberRole: updateMemberRoleMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	deactivateEmployee: deactivateEmployeeMock,
	reactivateEmployee: reactivateEmployeeMock,
	removeEmployeeAccess: removeEmployeeAccessMock,
}));

vi.mock("./edit-invitation-target-team-dialog", () => ({
	EditInvitationTargetTeamDialog: () => null,
}));

vi.mock("@/lib/query", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/query")>("@/lib/query");

	return {
		...actual,
		useEmployeeClockStatuses: () => ({
			getStatus: () => "unknown",
		}),
	};
});

const componentSource = () =>
	readFileSync(
		join(process.cwd(), "src/components/organization/members-table.tsx"),
		"utf8",
	);

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

	return {
		...render(
			<QueryClientProvider client={queryClient}>
				{children}
			</QueryClientProvider>,
		),
		invalidateQueries,
		queryClient,
	};
}

const member = {
	member: {
		id: "member-1",
		role: "member",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		organizationId: "org-1",
		teamId: null,
		userId: "user-1",
		status: "approved",
	},
	user: {
		id: "user-1",
		name: "Active Alice",
		email: "alice@example.com",
		emailVerified: true,
		image: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	},
	employee: {
		id: "employee-1",
		isActive: true,
	},
};

const invitation = {
	id: "invitation-1",
	organizationId: "org-1",
	email: "pending@example.com",
	role: "member",
	status: "pending",
	expiresAt: new Date("2027-01-01T00:00:00.000Z"),
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	inviterId: "user-1",
	user: member.user,
	targetTeamId: null,
	targetTeam: null,
};

const secondInvitation = {
	...invitation,
	id: "invitation-2",
	email: "second@example.com",
};

const thirdInvitation = {
	...invitation,
	id: "invitation-3",
	email: "third@example.com",
};

function renderMembersTable(
	defaultTab?: "members" | "invitations",
	invitations = [invitation],
) {
	return renderWithQueryClient(
		<MembersTable
			organizationId="org-1"
			members={[member as never]}
			invitations={invitations as never[]}
			defaultTab={defaultTab}
			currentMemberRole="admin"
			currentUserId="user-1"
		/>,
	);
}

describe("MembersTable invitation target teams", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resendInvitationMock.mockResolvedValue({ success: true });
		deactivateEmployeeMock.mockResolvedValue({ success: true });
		reactivateEmployeeMock.mockResolvedValue({ success: true });
		removeEmployeeAccessMock.mockResolvedValue({ success: true });
	});

	it("opens active members by default and pending invitations when requested", () => {
		const { unmount } = renderMembersTable();

		expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
			"Active Members",
		);
		expect(screen.getByRole("tabpanel").textContent).toContain("Active Alice");
		unmount();

		renderMembersTable("invitations");

		expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
			"Pending Invitations",
		);
		expect(
			within(screen.getByRole("tabpanel")).getByText("pending@example.com"),
		).toBeTruthy();
	});

	it("keeps role updates member-ID correct while lifecycle removal uses the employee action", async () => {
		updateMemberRoleMock.mockResolvedValue({ success: true });
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never]}
				invitations={[]}
				currentMemberRole="owner"
				currentUserId="owner-user"
			/>,
		);
		const row = screen.getByText("Active Alice").closest("tr");
		if (!row) throw new Error("Member row not found");

		fireEvent.click(within(row).getByRole("combobox"));
		fireEvent.click(await screen.findByRole("option", { name: "Admin" }));
		await waitFor(() =>
			expect(updateMemberRoleMock).toHaveBeenCalledWith("org-1", "member-1", {
				role: "admin",
			}),
		);
		await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledOnce());

		fireEvent.click(
			within(row).getByRole("button", { name: "Actions for Active Alice" }),
		);
		fireEvent.click(await screen.findByText("Remove access"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(removeEmployeeAccessMock).toHaveBeenCalledWith("employee-1"),
		);
		await waitFor(() => expect(screen.queryByText("Active Alice")).toBeNull());
		expect(routerRefreshMock).toHaveBeenCalledOnce();
	});

	it.each(["pending", "rejected"])(
		"does not show the role selector for a %s target membership",
		(status) => {
			renderWithQueryClient(
				<MembersTable
					organizationId="org-1"
					members={[
						{
							...member,
							member: { ...member.member, status },
						} as never,
					]}
					invitations={[]}
					currentMemberRole="owner"
					currentUserId="owner-user"
				/>,
			);

			const row = screen.getByText("Active Alice").closest("tr");
			if (!row) throw new Error("Member row not found");
			expect(within(row).queryByRole("combobox")).toBeNull();
			expect(within(row).getByText("member")).toBeTruthy();
		},
	);

	it("lets the shared component roll back semantic status failures for the exact employee", async () => {
		let resolveRole!: (result: { success: false; error: string }) => void;
		let resolveStatus!: (result: { success: false; error: string }) => void;
		updateMemberRoleMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRole = resolve;
			}),
		);
		deactivateEmployeeMock.mockReturnValue(
			new Promise((resolve) => {
				resolveStatus = resolve;
			}),
		);
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never]}
				invitations={[]}
				currentMemberRole="owner"
				currentUserId="owner-user"
			/>,
		);

		const row = screen.getByText("Active Alice").closest("tr");
		if (!row) throw new Error("Member row not found");
		const initialRow = row;
		fireEvent.click(within(initialRow).getByRole("combobox"));
		fireEvent.click(await screen.findByRole("option", { name: "Admin" }));
		await waitFor(() =>
			expect(within(initialRow).getByRole("combobox").textContent).toContain(
				"Admin",
			),
		);
		await act(async () => {
			resolveRole({ success: false, error: "Role failed" });
		});
		await waitFor(() =>
			expect(within(initialRow).getByRole("combobox").textContent).toContain(
				"Member",
			),
		);

		fireEvent.click(
			within(initialRow).getByRole("button", {
				name: "Actions for Active Alice",
			}),
		);
		fireEvent.click(await screen.findByText("Deactivate"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
		await waitFor(() =>
			expect(within(initialRow).getByText("Inactive")).toBeTruthy(),
		);
		await act(async () => {
			resolveStatus({ success: false, error: "Status failed" });
		});
		await waitFor(() =>
			expect(within(initialRow).getByText("Active")).toBeTruthy(),
		);
		expect(deactivateEmployeeMock).toHaveBeenCalledExactlyOnceWith(
			"employee-1",
		);
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to deactivate employee",
		);
		expect(routerRefreshMock).not.toHaveBeenCalled();
	});

	it("updates only the selected local employee and invalidates shared lifecycle caches", async () => {
		const secondMember = {
			...member,
			member: { ...member.member, id: "member-2", userId: "user-2" },
			user: {
				...member.user,
				id: "user-2",
				name: "Active Bob",
				email: "bob@example.com",
			},
			employee: { id: "employee-2", isActive: true },
		};
		const { invalidateQueries } = renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never, secondMember as never]}
				invitations={[]}
				currentMemberRole="admin"
				currentUserId="admin-user"
			/>,
		);
		const row = screen.getByText("Active Alice").closest("tr");
		if (!row) throw new Error("Member row not found");

		fireEvent.click(
			within(row).getByRole("button", { name: "Actions for Active Alice" }),
		);
		fireEvent.click(await screen.findByText("Deactivate"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(deactivateEmployeeMock).toHaveBeenCalledWith("employee-1"),
		);
		expect(within(row).getByText("Inactive")).toBeTruthy();
		const secondRow = screen.getByText("Active Bob").closest("tr");
		if (!secondRow) throw new Error("Second member row not found");
		expect(within(secondRow).getByText("Active")).toBeTruthy();
		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.members.organization("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("employee-1"),
			});
		});
	});

	it("removes the membership row only after shared removal succeeds", async () => {
		let resolveRemoval!: (result: { success: true }) => void;
		removeEmployeeAccessMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRemoval = resolve;
			}),
		);
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never]}
				invitations={[]}
				currentMemberRole="owner"
				currentUserId="owner-user"
			/>,
		);
		const row = screen.getByText("Active Alice").closest("tr");
		if (!row) throw new Error("Member row not found");
		fireEvent.click(
			within(row).getByRole("button", { name: "Actions for Active Alice" }),
		);
		fireEvent.click(await screen.findByText("Remove access"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(removeEmployeeAccessMock).toHaveBeenCalledOnce(),
		);
		expect(screen.getByText("Active Alice")).toBeTruthy();
		await act(async () => resolveRemoval({ success: true }));
		await waitFor(() => expect(screen.queryByText("Active Alice")).toBeNull());
	});

	it("keeps the membership row when shared removal fails", async () => {
		removeEmployeeAccessMock.mockResolvedValue({
			success: false,
			error: "internal removal detail",
		});
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never]}
				invitations={[]}
				currentMemberRole="owner"
				currentUserId="owner-user"
			/>,
		);
		const row = screen.getByText("Active Alice").closest("tr");
		if (!row) throw new Error("Member row not found");
		fireEvent.click(
			within(row).getByRole("button", { name: "Actions for Active Alice" }),
		);
		fireEvent.click(await screen.findByText("Remove access"));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(
				"Failed to remove organization access",
			),
		);
		expect(screen.getByText("Active Alice")).toBeTruthy();
		expect(routerRefreshMock).not.toHaveBeenCalled();
	});

	it.each([
		["admin", true, false],
		["owner", true, true],
		["member,admin", true, false],
		["member,owner", true, true],
		["member", false, false],
	] as const)("passes tokenized %s capabilities through shared controls", async (currentMemberRole, canChangeStatus, canRemove) => {
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[member as never]}
				invitations={[]}
				currentMemberRole={currentMemberRole}
				currentUserId="actor-user"
			/>,
		);

		const trigger = screen.queryByRole("button", {
			name: "Actions for Active Alice",
		});
		expect(Boolean(trigger)).toBe(canChangeStatus || canRemove);
		if (!trigger) return;
		fireEvent.click(trigger);
		const menu = await screen.findByRole("menu");
		expect(
			Boolean(within(menu).queryByRole("menuitem", { name: "Deactivate" })),
		).toBe(canChangeStatus);
		expect(
			Boolean(within(menu).queryByRole("menuitem", { name: "Remove access" })),
		).toBe(canRemove);
	});

	it("hides shared lifecycle controls for the current user", () => {
		renderMembersTable();

		expect(
			screen.queryByRole("button", { name: "Actions for Active Alice" }),
		).toBeNull();
	});

	it("labels inactive member actions Reactivate and Remove access", async () => {
		renderWithQueryClient(
			<MembersTable
				organizationId="org-1"
				members={[
					{
						...member,
						employee: { ...member.employee, isActive: false },
					} as never,
				]}
				invitations={[]}
				currentMemberRole="owner"
				currentUserId="owner-user"
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Actions for Active Alice" }),
		);
		const menu = await screen.findByRole("menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Reactivate" }),
		).toBeTruthy();
		expect(
			within(menu).getByRole("menuitem", { name: "Remove access" }),
		).toBeTruthy();
		expect(
			within(menu).queryByRole("menuitem", { name: "Activate" }),
		).toBeNull();
	});

	it("passes exact member and employee row metadata to shared lifecycle actions", () => {
		const file = componentSource();

		expect(file).toContain("<EmployeeLifecycleActions");
		expect(file).toContain("employeeId: employee.id");
		expect(file).toContain("userId: row.original.user.id");
		expect(file).toContain("displayName: row.original.user.name");
		expect(file).toContain("isActive: employee.isActive");
		expect(file).toContain("id: row.original.member.id");
		expect(file).toContain("role: row.original.member.role");
		expect(file).toContain("status: row.original.member.status");
		expect(file).toContain("currentUserId={currentUserId}");
		expect(file).toContain("currentMemberRole={currentMemberRole}");
		expect(file).not.toContain("Remove from Organization");
		expect(file).not.toContain('"Activate"');
	});

	it("has no obsolete organization lifecycle imports or calls", () => {
		const file = componentSource();

		expect(file).not.toContain("removeMemberMutation");
		expect(file).not.toContain("toggleStatusMutation");
		expect(file).not.toContain("removeMember(");
		expect(file).not.toContain("toggleEmployeeStatus(");
	});

	it("allows callers to open pending invitations by default", () => {
		const file = componentSource();

		expect(file).toContain('defaultTab = "members"');
		expect(file).toContain('defaultTab?: "members" | "invitations"');
		expect(file).toContain("<Tabs defaultValue={defaultTab}");
	});

	it("guards cancellation dispatch while another cancellation is pending", () => {
		expect(componentSource()).toContain(
			"if (cancelInvitationMutation.isPending) return;",
		);
	});

	it("resolves local target team updates from the submitted id", () => {
		const update = resolveInvitationTargetTeamUpdate("team-a", [
			{ id: "team-a", name: "Submitted Team" },
			{ id: "team-b", name: "Later Selected Team" },
		]);

		expect(update).toEqual({
			targetTeamId: "team-a",
			targetTeam: { id: "team-a", name: "Submitted Team" },
		});
	});

	it("shows pending invitation target teams and exposes the edit action", () => {
		const file = componentSource();

		expect(file).toContain(
			'import { EditInvitationTargetTeamDialog } from "./edit-invitation-target-team-dialog"',
		);
		expect(file).toContain('accessorKey: "targetTeam"');
		expect(file).toContain('organization.members.targetTeam", "Target Team"');
		expect(file).toContain('organization.members.noTargetTeam", "No team"');
		expect(file).toContain(
			'organization.members.editTargetTeam", "Edit target team"',
		);
		expect(file).toContain("<EditInvitationTargetTeamDialog");
	});

	it("uses the atomic resend action without canceling or sending a new invitation directly", async () => {
		const file = componentSource();

		expect(file).toContain("resendInvitation(organizationId, invitation.id)");
		expect(file).not.toContain("await cancelInvitation(invitation.id)");
		expect(file).not.toContain("return sendInvitation({");

		renderMembersTable("invitations");
		const invitationRow = screen.getByText("pending@example.com").closest("tr");
		if (!invitationRow) throw new Error("Invitation row not found");
		fireEvent.click(within(invitationRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Resend"));

		await waitFor(() => {
			expect(resendInvitationMock).toHaveBeenCalledWith(
				"org-1",
				"invitation-1",
			);
		});
		expect(cancelInvitationMock).not.toHaveBeenCalled();
		expect(sendInvitationMock).not.toHaveBeenCalled();
	});

	it("invalidates invitations and employees after resend succeeds", async () => {
		const { invalidateQueries } = renderMembersTable("invitations");
		const invitationRow = screen.getByText("pending@example.com").closest("tr");
		if (!invitationRow) throw new Error("Invitation row not found");
		fireEvent.click(within(invitationRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Resend"));

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.invitations.list("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
		});
		expect(routerRefreshMock).toHaveBeenCalledOnce();
		expect(screen.queryByText("pending@example.com")).toBeNull();
	});

	it("blocks a second resend while showing loading only for the pending invitation", async () => {
		let resolveResend!: (result: { success: true }) => void;
		resendInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveResend = resolve;
			}),
		);
		renderMembersTable("invitations", [invitation, secondInvitation]);
		const firstRow = screen.getByText("pending@example.com").closest("tr");
		if (!firstRow) throw new Error("First invitation row not found");
		const firstAction = within(firstRow).getByRole("button");

		fireEvent.click(firstAction);
		fireEvent.click(await screen.findByText("Resend"));

		await waitFor(() => expect(resendInvitationMock).toHaveBeenCalledOnce());
		const pendingFirstRow = screen
			.getByText("pending@example.com")
			.closest("tr");
		const pendingSecondRow = screen
			.getByText("second@example.com")
			.closest("tr");
		if (!pendingFirstRow || !pendingSecondRow)
			throw new Error("Pending invitation rows not found");
		const pendingFirstAction = within(pendingFirstRow).getByRole("button");
		const pendingSecondAction = within(pendingSecondRow).getByRole("button");
		expect(pendingFirstAction).toHaveProperty("disabled", true);
		expect(pendingFirstAction.querySelector(".animate-spin")).not.toBeNull();
		expect(pendingSecondAction).toHaveProperty("disabled", true);
		expect(pendingSecondAction.querySelector(".animate-spin")).toBeNull();

		fireEvent.click(pendingSecondAction);
		expect(screen.queryByRole("menuitem", { name: "Resend" })).toBeNull();
		expect(resendInvitationMock).toHaveBeenCalledOnce();
		expect(pendingFirstAction).toHaveProperty("disabled", true);

		await act(async () => {
			resolveResend({ success: true });
		});
	});

	it("keeps the invitation visible and reports a resolved resend failure", async () => {
		let resolveResend!: (result: { success: false; error: string }) => void;
		resendInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveResend = resolve;
			}),
		);
		const { invalidateQueries } = renderMembersTable("invitations");
		const invitationRow = screen.getByText("pending@example.com").closest("tr");
		if (!invitationRow) throw new Error("Invitation row not found");
		fireEvent.click(within(invitationRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Resend"));

		await waitFor(() => expect(resendInvitationMock).toHaveBeenCalledOnce());
		expect(screen.getByText("pending@example.com")).toBeTruthy();

		await act(async () => {
			resolveResend({ success: false, error: "Could not resend" });
		});

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith("Could not resend"),
		);
		const settledInvitationRow = screen
			.getByText("pending@example.com")
			.closest("tr");
		if (!settledInvitationRow)
			throw new Error("Settled invitation row not found");
		const settledAction = within(settledInvitationRow).getByRole("button");
		expect(settledAction).toHaveProperty("disabled", false);
		expect(settledAction.querySelector(".animate-spin")).toBeNull();
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("restores an optimistically removed invitation after cancellation resolves as failure", async () => {
		let resolveCancel!: (result: { success: false; error: string }) => void;
		cancelInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveCancel = resolve;
			}),
		);
		renderMembersTable("invitations");
		const invitationRow = screen.getByText("pending@example.com").closest("tr");
		if (!invitationRow) throw new Error("Invitation row not found");
		fireEvent.click(within(invitationRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Cancel"));

		await waitFor(() =>
			expect(screen.queryByText("pending@example.com")).toBeNull(),
		);

		await act(async () => {
			resolveCancel({ success: false, error: "Could not cancel" });
		});

		await waitFor(() =>
			expect(screen.getByText("pending@example.com")).toBeTruthy(),
		);
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to cancel invitation");
		expect(toastErrorMock).not.toHaveBeenCalledWith("Could not cancel");
		const restoredInvitationRow = screen
			.getByText("pending@example.com")
			.closest("tr");
		if (!restoredInvitationRow)
			throw new Error("Restored invitation row not found");
		const restoredAction = within(restoredInvitationRow).getByRole("button");
		expect(restoredAction).toHaveProperty("disabled", false);
		expect(restoredAction.querySelector(".animate-spin")).toBeNull();
	});

	it("blocks a second cancellation while the first cancellation is pending", async () => {
		let resolveCancel!: (result: { success: true }) => void;
		cancelInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveCancel = resolve;
			}),
		);
		renderMembersTable("invitations", [invitation, secondInvitation]);
		const firstRow = screen.getByText("pending@example.com").closest("tr");
		if (!firstRow) throw new Error("First invitation row not found");
		fireEvent.click(within(firstRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Cancel"));

		await waitFor(() => expect(cancelInvitationMock).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(screen.queryByText("pending@example.com")).toBeNull(),
		);
		const remainingRow = screen.getByText("second@example.com").closest("tr");
		if (!remainingRow) throw new Error("Remaining invitation row not found");
		const remainingAction = within(remainingRow).getByRole("button");
		expect(remainingAction).toHaveProperty("disabled", true);
		expect(remainingAction.querySelector(".animate-spin")).toBeNull();

		fireEvent.click(remainingAction);
		expect(screen.queryByRole("menuitem", { name: "Cancel" })).toBeNull();
		expect(cancelInvitationMock).toHaveBeenCalledOnce();

		await act(async () => {
			resolveCancel({ success: true });
		});
	});

	it("restores only the failed cancellation at its original position", async () => {
		let resolveSecondCancel!: (result: {
			success: false;
			error: string;
		}) => void;
		cancelInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSecondCancel = resolve;
			}),
		);
		const { queryClient, rerender } = renderMembersTable("invitations", [
			invitation,
			secondInvitation,
			thirdInvitation,
		]);
		const secondRow = screen.getByText("second@example.com").closest("tr");
		if (!secondRow) throw new Error("Second invitation row not found");
		fireEvent.click(within(secondRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Cancel"));
		await waitFor(() =>
			expect(screen.queryByText("second@example.com")).toBeNull(),
		);

		rerender(
			<QueryClientProvider client={queryClient}>
				<MembersTable
					organizationId="org-1"
					members={[member as never]}
					invitations={[invitation as never]}
					defaultTab="invitations"
					currentMemberRole="admin"
					currentUserId="user-1"
				/>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.queryByText("third@example.com")).toBeNull(),
		);

		await act(async () => {
			resolveSecondCancel({ success: false, error: "Could not cancel second" });
		});

		await waitFor(() =>
			expect(screen.getByText("second@example.com")).toBeTruthy(),
		);
		expect(screen.queryByText("third@example.com")).toBeNull();
		const emails = screen
			.getAllByRole("row")
			.map((row) => row.textContent)
			.filter((text) => text?.includes("@example.com"));
		expect(emails).toEqual([
			expect.stringContaining("pending@example.com"),
			expect.stringContaining("second@example.com"),
		]);
	});

	it("invalidates invitations and employees after cancellation succeeds", async () => {
		cancelInvitationMock.mockResolvedValue({ success: true });
		const { invalidateQueries } = renderMembersTable("invitations");
		const invitationRow = screen.getByText("pending@example.com").closest("tr");
		if (!invitationRow) throw new Error("Invitation row not found");
		fireEvent.click(within(invitationRow).getByRole("button"));
		fireEvent.click(await screen.findByText("Cancel"));

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.invitations.list("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
		});
		expect(routerRefreshMock).toHaveBeenCalledOnce();
	});

	it("replaces local state when refreshed server props arrive", async () => {
		const queryClient = new QueryClient();
		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<MembersTable
					organizationId="org-1"
					members={[member as never]}
					invitations={[]}
					currentMemberRole="admin"
					currentUserId="admin-user"
				/>
			</QueryClientProvider>,
		);

		rerender(
			<QueryClientProvider client={queryClient}>
				<MembersTable
					organizationId="org-1"
					members={[
						{
							...member,
							user: { ...member.user, name: "Refreshed Alice" },
						} as never,
					]}
					invitations={[]}
					currentMemberRole="admin"
					currentUserId="admin-user"
				/>
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Refreshed Alice")).toBeTruthy();
		expect(screen.queryByText("Active Alice")).toBeNull();
	});

	it("labels icon-only action triggers and restores focus when a menu closes", async () => {
		renderMembersTable("invitations");
		const invitationTrigger = screen.getByRole("button", {
			name: "Actions for invitation to pending@example.com",
		});

		fireEvent.click(invitationTrigger);
		fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
		await waitFor(() => expect(document.activeElement).toBe(invitationTrigger));
	});

	it("updates the local pending invitation target team after editing", () => {
		const table = componentSource();
		const dialog = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/edit-invitation-target-team-dialog.tsx",
			),
			"utf8",
		);

		expect(dialog).toContain("onUpdated:");
		expect(dialog).toContain(
			'import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils"',
		);
		expect(dialog).toContain("mutationFn: ({ targetTeamId }");
		expect(dialog).toContain("onSuccess: (result, variables)");
		expect(dialog).toContain(
			"const update = resolveInvitationTargetTeamUpdate(variables.targetTeamId, teams)",
		);
		expect(dialog).toContain("onUpdated(update)");
		expect(dialog).toContain("disabled={updateMutation.isPending}");
		expect(dialog).toContain(
			"updateMutation.mutate({ targetTeamId: submittedTargetTeamId })",
		);
		expect(table).toContain("handleInvitationTargetTeamUpdated");
		expect(table).toContain("setInvitations((currentInvitations) =>");
		expect(table).toContain("invitation.id === invitationId");
		expect(table).toContain("targetTeamId: update.targetTeamId");
		expect(table).toContain("targetTeam: update.targetTeam");
		expect(table).toContain("onUpdated={handleInvitationTargetTeamUpdated}");
	});

	it("keeps people-management components off the organization settings page", () => {
		const pageSource = readFileSync(
			join(
				process.cwd(),
				"src/app/[locale]/(app)/settings/organizations/page.tsx",
			),
			"utf8",
		);
		const tabSource = readFileSync(
			join(process.cwd(), "src/components/organization/organization-tab.tsx"),
			"utf8",
		);
		const clientSource = readFileSync(
			join(
				process.cwd(),
				"src/components/organization/organizations-page-client.tsx",
			),
			"utf8",
		);

		expect(pageSource).not.toContain("type InvitationWithInviter");
		expect(pageSource).not.toContain("type MemberWithUserAndEmployee");
		expect(pageSource).not.toContain("db.query.invitation.findMany");
		expect(pageSource).not.toContain("db.query.member.findFirst");
		expect(pageSource).not.toContain(".from(authSchema.member)");
		expect(tabSource).not.toContain("InviteCodeManagement");
		expect(tabSource).not.toContain("PendingMembersCard");
		expect(tabSource).not.toContain("MembersTable");
		expect(tabSource).not.toContain("InviteMemberDialog");
		expect(clientSource).not.toContain("members:");
		expect(clientSource).not.toContain("invitations:");
	});
});
