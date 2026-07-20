/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { queryKeys } from "@/lib/query";
import {
	EmployeeLifecycleActions,
	type EmployeeLifecycleActionsProps,
} from "./employee-lifecycle-actions";

const {
	deactivateEmployeeMock,
	onOptimisticStatusChangeMock,
	onRemovedMock,
	reactivateEmployeeMock,
	removeEmployeeAccessMock,
	toastErrorMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	deactivateEmployeeMock: vi.fn(),
	onOptimisticStatusChangeMock: vi.fn(),
	onRemovedMock: vi.fn(),
	reactivateEmployeeMock: vi.fn(),
	removeEmployeeAccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, string>) =>
			key === "settings.employees.lifecycle.actionsLabel"
				? "Employee actions for {name}".replace(
						"{name}",
						params?.name ?? "{name}",
					)
				: key === "settings.employees.lifecycle.finalOwnerDeactivateGuidance"
					? "Localized final-owner deactivation guidance"
					: key === "settings.employees.lifecycle.reinviteRequired"
						? "Localized re-invitation guidance"
						: key === "settings.employees.lifecycle.finalOwnerRemoveGuidance"
							? "Localized final-owner removal guidance"
							: fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	deactivateEmployee: deactivateEmployeeMock,
	reactivateEmployee: reactivateEmployeeMock,
	removeEmployeeAccess: removeEmployeeAccessMock,
}));

const approvedMembership = {
	id: "member-2",
	role: "member",
	status: "approved",
};

const activeTarget = {
	employeeId: "employee-2",
	userId: "user-2",
	displayName: "Alex Morgan",
	isActive: true,
	membership: approvedMembership,
};

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
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

function renderActions(
	overrides: Partial<
		React.ComponentProps<typeof EmployeeLifecycleActions>
	> = {},
) {
	return renderWithQueryClient(
		<EmployeeLifecycleActions
			organizationId="org-1"
			target={activeTarget}
			currentUserId="owner-user"
			currentMemberRole="owner"
			onOptimisticStatusChange={onOptimisticStatusChangeMock}
			onRemoved={onRemovedMock}
			{...overrides}
		/>,
	);
}

async function openActions() {
	fireEvent.click(
		screen.getByRole("button", { name: "Employee actions for Alex Morgan" }),
	);
	return screen.findByRole("menu");
}

async function openConfirmation(actionName: string) {
	const menu = await openActions();
	fireEvent.click(within(menu).getByRole("menuitem", { name: actionName }));
	return screen.findByRole("alertdialog");
}

describe("EmployeeLifecycleActions capabilities", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lets an owner deactivate an active owner and remove their access", async () => {
		renderActions({
			target: {
				...activeTarget,
				membership: { ...approvedMembership, role: "owner" },
			},
		});

		const menu = await openActions();

		expect(
			within(menu).getByRole("menuitem", { name: "Deactivate" }),
		).toBeTruthy();
		expect(
			within(menu).getByRole("menuitem", { name: "Remove access" }),
		).toBeTruthy();
	});

	it.each([
		"owner",
		"member,owner",
	])("does not let an admin change status for target owner role %s", (targetRole) => {
		const { container } = renderActions({
			currentMemberRole: "admin",
			target: {
				...activeTarget,
				membership: { ...approvedMembership, role: targetRole },
			},
		});

		expect(container.childElementCount).toBe(0);
	});

	it.each([
		"owner",
		"member,owner",
	])("lets another owner change status for target owner role %s", async (targetRole) => {
		renderActions({
			target: {
				...activeTarget,
				membership: { ...approvedMembership, role: targetRole },
			},
		});

		const menu = await openActions();
		expect(
			within(menu).getByRole("menuitem", { name: "Deactivate" }),
		).toBeTruthy();
	});

	it.each([
		["owner", true],
		["admin", false],
	] as const)("lets an inactive approved employee be reactivated by an %s with owner-only removal", async (currentMemberRole, canRemove) => {
		renderActions({
			currentMemberRole,
			target: { ...activeTarget, isActive: false },
		});

		const menu = await openActions();

		expect(
			within(menu).getByRole("menuitem", { name: "Reactivate" }),
		).toBeTruthy();
		expect(
			Boolean(within(menu).queryByRole("menuitem", { name: "Remove access" })),
		).toBe(canRemove);
	});

	it("shows no controls for an inactive employee without an approved membership", () => {
		const { container } = renderActions({
			target: { ...activeTarget, isActive: false, membership: null },
		});

		expect(container.childElementCount).toBe(0);
	});

	it.each([
		["the current user", { currentUserId: activeTarget.userId }],
		["a member actor", { currentMemberRole: "member" }],
	] as const)("shows no controls for %s", (_label, overrides) => {
		const { container } = renderActions(overrides);

		expect(container.childElementCount).toBe(0);
	});

	it.each([
		["member,owner", true],
		["member,admin", false],
	] as const)("honors compound role %s as tokenized capabilities", async (role, canRemove) => {
		renderActions({ currentMemberRole: role });

		const menu = await openActions();

		expect(
			within(menu).getByRole("menuitem", { name: "Deactivate" }),
		).toBeTruthy();
		expect(
			Boolean(within(menu).queryByRole("menuitem", { name: "Remove access" })),
		).toBe(canRemove);
	});

	it("accepts one button-compatible React element as a custom asChild trigger", async () => {
		expectTypeOf<EmployeeLifecycleActionsProps["trigger"]>().toEqualTypeOf<
			ReactElement<ComponentPropsWithRef<"button">> | undefined
		>();
		renderActions({
			trigger: <button type="button">Open lifecycle actions</button>,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Open lifecycle actions" }),
		);

		expect(
			await screen.findByRole("menuitem", { name: "Deactivate" }),
		).toBeTruthy();
	});
});

describe("EmployeeLifecycleActions confirmations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("explains that deactivation suspends organization access and sessions while retaining history", async () => {
		renderActions();

		const dialog = await openConfirmation("Deactivate");

		expect(within(dialog).getByText("Deactivate employee?")).toBeTruthy();
		expect(
			within(dialog).getByText(
				"This suspends access to this organization and ends sessions currently using it. Employee history is retained.",
			),
		).toBeTruthy();
	});

	it("explains that reactivation uses the existing employee record", async () => {
		renderActions({ target: { ...activeTarget, isActive: false } });

		const dialog = await openConfirmation("Reactivate");

		expect(within(dialog).getByText("Reactivate employee?")).toBeTruthy();
		expect(
			within(dialog).getByText(
				"This restores access to this organization using the existing employee record.",
			),
		).toBeTruthy();
	});

	it("describes every retained history category and calls the destructive action Remove access", async () => {
		renderActions();

		const dialog = await openConfirmation("Remove access");

		expect(
			within(dialog).getByText("Remove organization access?"),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"This removes organization membership and ends organization sessions. Time records, absences, balances, employment history, and audits are retained.",
			),
		).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: "Remove access" }),
		).toBeTruthy();
		expect(screen.queryByText("Delete employee")).toBeNull();
	});
});

describe("EmployeeLifecycleActions mutations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		deactivateEmployeeMock.mockResolvedValue({
			success: true,
			data: undefined,
		});
		reactivateEmployeeMock.mockResolvedValue({
			success: true,
			data: undefined,
		});
		removeEmployeeAccessMock.mockResolvedValue({
			success: true,
			data: undefined,
		});
	});

	it("keeps a committed deactivation inactive and invalidates scoped data when cleanup is pending", async () => {
		const { invalidateQueries } = renderActions();
		const dialog = await openConfirmation("Deactivate");

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		expect(onOptimisticStatusChangeMock.mock.calls).toEqual([
			["employee-2", false],
		]);
		await waitFor(() =>
			expect(deactivateEmployeeMock).toHaveBeenCalledWith("employee-2"),
		);
		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.members.organization("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("employee-2"),
			});
		});
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: queryKeys.organizations.all,
		});
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: queryKeys.invitations.list("org-1"),
		});
		expect(onOptimisticStatusChangeMock.mock.calls).toEqual([
			["employee-2", false],
		]);
	});

	it("rolls back a thrown status failure and shows a fixed toast without the raw error", async () => {
		deactivateEmployeeMock.mockRejectedValue(
			new Error("secret database detail"),
		);
		renderActions();
		const dialog = await openConfirmation("Deactivate");

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(onOptimisticStatusChangeMock.mock.calls).toEqual([
				["employee-2", false],
				["employee-2", true],
			]),
		);
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to deactivate employee",
		);
		expect(toastErrorMock).not.toHaveBeenCalledWith(
			expect.stringContaining("secret"),
		);
	});

	it("uses the same rollback path for a resolved semantic failure", async () => {
		deactivateEmployeeMock.mockResolvedValue({
			success: false,
			error: "secret authorization detail",
		});
		renderActions();
		const dialog = await openConfirmation("Deactivate");

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(onOptimisticStatusChangeMock.mock.calls).toEqual([
				["employee-2", false],
				["employee-2", true],
			]),
		);
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to deactivate employee",
		);
		expect(toastErrorMock).not.toHaveBeenCalledWith(
			expect.stringContaining("authorization"),
		);
	});

	it.each([
		[
			"deactivate",
			"Assign and activate another approved owner before deactivating this employee",
			"Localized final-owner deactivation guidance",
		],
		[
			"reactivate",
			"This employee is no longer an approved organization member. Re-invite them before reactivating.",
			"Localized re-invitation guidance",
		],
		[
			"remove",
			"Assign and activate another approved owner before removing this employee's access",
			"Localized final-owner removal guidance",
		],
	] as const)("localizes allowlisted actionable %s guidance without rendering the server message", async (action, message, localizedMessage) => {
		const actionMock =
			action === "deactivate"
				? deactivateEmployeeMock
				: action === "reactivate"
					? reactivateEmployeeMock
					: removeEmployeeAccessMock;
		actionMock.mockResolvedValue({
			success: false,
			code: "ValidationError",
			error: message,
		});
		renderActions({
			target:
				action === "reactivate"
					? { ...activeTarget, isActive: false }
					: activeTarget,
		});
		const label =
			action === "deactivate"
				? "Deactivate"
				: action === "reactivate"
					? "Reactivate"
					: "Remove access";
		const dialog = await openConfirmation(label);

		fireEvent.click(within(dialog).getByRole("button", { name: label }));

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(localizedMessage),
		);
		expect(toastErrorMock).not.toHaveBeenCalledWith(message);
	});

	it.each([
		{
			code: "ValidationError",
			error:
				"Assign and activate another approved owner before removing this employee's access; token=secret",
		},
		{
			code: "UNKNOWN_ERROR",
			error:
				"Assign and activate another approved owner before removing this employee's access",
		},
	] as const)("keeps non-allowlisted secret-bearing server failures generic", async (failure) => {
		removeEmployeeAccessMock.mockResolvedValue({ success: false, ...failure });
		renderActions();
		const dialog = await openConfirmation("Remove access");

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(
				"Failed to remove organization access",
			),
		);
		expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain("secret");
	});

	it("reactivates optimistically through the dedicated wrapper", async () => {
		renderActions({ target: { ...activeTarget, isActive: false } });
		const dialog = await openConfirmation("Reactivate");

		fireEvent.click(within(dialog).getByRole("button", { name: "Reactivate" }));

		expect(onOptimisticStatusChangeMock).toHaveBeenCalledWith(
			"employee-2",
			true,
		);
		await waitFor(() =>
			expect(reactivateEmployeeMock).toHaveBeenCalledWith("employee-2"),
		);
	});

	it("keeps the history row on removal failure and calls onRemoved only after success", async () => {
		removeEmployeeAccessMock.mockResolvedValueOnce({
			success: false,
			error: "secret removal detail",
		});
		renderActions();
		let dialog = await openConfirmation("Remove access");

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(
				"Failed to remove organization access",
			),
		);
		expect(onRemovedMock).not.toHaveBeenCalled();
		expect(onOptimisticStatusChangeMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("alertdialog", { name: "Remove organization access?" }),
		).toBe(dialog);

		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		dialog = await openConfirmation("Remove access");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(onRemovedMock).toHaveBeenCalledExactlyOnceWith("employee-2"),
		);
	});

	it("invalidates organizations after successful removal but never invitations", async () => {
		const { invalidateQueries } = renderActions();
		const dialog = await openConfirmation("Remove access");

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove access" }),
		);

		await waitFor(() =>
			expect(onRemovedMock).toHaveBeenCalledExactlyOnceWith("employee-2"),
		);
		for (const queryKey of [
			queryKeys.members.organization("org-1"),
			queryKeys.employees.organization("org-1"),
			queryKeys.employees.detail("employee-2"),
			queryKeys.organizations.all,
		]) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
		}
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: queryKeys.invitations.list("org-1"),
		});
	});

	it("prevents double submission and exposes an accessible pending label and status", async () => {
		let resolveDeactivate!: (result: {
			success: true;
			data: undefined;
		}) => void;
		deactivateEmployeeMock.mockReturnValue(
			new Promise((resolve) => {
				resolveDeactivate = resolve;
			}),
		);
		renderActions();
		const dialog = await openConfirmation("Deactivate");
		const submit = within(dialog).getByRole("button", { name: "Deactivate" });

		fireEvent.click(submit);
		fireEvent.click(submit);

		await waitFor(() => expect(deactivateEmployeeMock).toHaveBeenCalledOnce());
		expect(
			within(dialog).getByRole("button", { name: "Deactivating..." }),
		).toHaveProperty("disabled", true);
		expect(
			within(dialog).getByRole("status", { name: "Deactivating employee" }),
		).toBeTruthy();

		await act(async () => {
			resolveDeactivate({ success: true, data: undefined });
		});
	});

	it("uses the selected target when props rerender before confirmation", async () => {
		const { invalidateQueries, queryClient, rerender } = renderActions();
		const dialog = await openConfirmation("Deactivate");
		const replacementTarget = {
			...activeTarget,
			employeeId: "employee-9",
			userId: "owner-user",
			displayName: "Taylor Reed",
			membership: null,
		};

		rerender(
			<QueryClientProvider client={queryClient}>
				<EmployeeLifecycleActions
					organizationId="org-1"
					target={replacementTarget}
					currentUserId="owner-user"
					currentMemberRole="owner"
					onOptimisticStatusChange={onOptimisticStatusChangeMock}
					onRemoved={onRemovedMock}
				/>
			</QueryClientProvider>,
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(deactivateEmployeeMock).toHaveBeenCalledExactlyOnceWith(
				"employee-2",
			),
		);
		expect(onOptimisticStatusChangeMock).toHaveBeenCalledWith(
			"employee-2",
			false,
		);
		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("employee-2"),
			}),
		);
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: queryKeys.employees.detail("employee-9"),
		});
	});

	it("invalidates the selected target when props rerender during the request", async () => {
		let resolveDeactivate!: (result: {
			success: true;
			data: undefined;
		}) => void;
		deactivateEmployeeMock.mockReturnValue(
			new Promise((resolve) => {
				resolveDeactivate = resolve;
			}),
		);
		const { invalidateQueries, queryClient, rerender } = renderActions();
		const dialog = await openConfirmation("Deactivate");
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		rerender(
			<QueryClientProvider client={queryClient}>
				<EmployeeLifecycleActions
					organizationId="org-1"
					target={{
						...activeTarget,
						employeeId: "employee-9",
						userId: "user-9",
						displayName: "Taylor Reed",
					}}
					currentUserId="owner-user"
					currentMemberRole="owner"
					onOptimisticStatusChange={onOptimisticStatusChangeMock}
					onRemoved={onRemovedMock}
				/>
			</QueryClientProvider>,
		);
		await act(async () => {
			resolveDeactivate({ success: true, data: undefined });
		});

		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("employee-2"),
			}),
		);
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: queryKeys.employees.detail("employee-9"),
		});
	});

	it("rolls back the selected target when props rerender during a failed request", async () => {
		let rejectDeactivate!: (error: Error) => void;
		deactivateEmployeeMock.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectDeactivate = reject;
			}),
		);
		const { queryClient, rerender } = renderActions();
		const dialog = await openConfirmation("Deactivate");
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		rerender(
			<QueryClientProvider client={queryClient}>
				<EmployeeLifecycleActions
					organizationId="org-1"
					target={{
						...activeTarget,
						employeeId: "employee-9",
						userId: "user-9",
						displayName: "Taylor Reed",
						isActive: false,
					}}
					currentUserId="owner-user"
					currentMemberRole="owner"
					onOptimisticStatusChange={onOptimisticStatusChangeMock}
					onRemoved={onRemovedMock}
				/>
			</QueryClientProvider>,
		);
		await act(async () => {
			rejectDeactivate(new Error("network failure"));
		});

		await waitFor(() =>
			expect(onOptimisticStatusChangeMock.mock.calls).toEqual([
				["employee-2", false],
				["employee-2", true],
			]),
		);
		expect(deactivateEmployeeMock).toHaveBeenCalledExactlyOnceWith(
			"employee-2",
		);
	});
});
