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
import type { DeactivationPreview } from "@/lib/employee-lifecycle/deactivation/types";
import { queryKeys } from "@/lib/query";
import { emptyDeactivationPreview } from "./testing/deactivation-preview.test.fixture";
import {
	EmployeeLifecycleActions,
	type EmployeeLifecycleActionsProps,
} from "./employee-lifecycle-actions";

const {
	deactivateEmployeeMock,
	getReactivationChecklistMock,
	onOptimisticStatusChangeMock,
	onRemovedMock,
	previewEmployeeDeactivationMock,
	reactivateEmployeeMock,
	removeEmployeeAccessMock,
	routerPushMock,
	toastErrorMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	deactivateEmployeeMock: vi.fn(),
	getReactivationChecklistMock: vi.fn(),
	routerPushMock: vi.fn(),
	onOptimisticStatusChangeMock: vi.fn(),
	onRemovedMock: vi.fn(),
	previewEmployeeDeactivationMock: vi.fn(),
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
							: key === "settings.employees.lifecycle.deactivationPreview.title"
								? `Deactivate ${params?.name}?`
								: fallback,
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-reactivation.actions", () => ({
	getReactivationChecklistAction: getReactivationChecklistMock,
	dismissReactivationChecklistAction: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	deactivateEmployee: deactivateEmployeeMock,
	previewEmployeeDeactivation: previewEmployeeDeactivationMock,
	reactivateEmployee: reactivateEmployeeMock,
	removeEmployeeAccess: removeEmployeeAccessMock,
}));

const REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANNA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const previewPlan = emptyDeactivationPreview;

/** A plan in which one report needs a new manager; `pick` is the one the preview was asked with. */
function planWithReport(pick: string | null): DeactivationPreview {
	return previewPlan({
		managerLinks: {
			reportsNeedingReplacement: [
				{
					employeeId: REPORT,
					name: "Rita Report",
					wasPrimary: true,
					replacementEmployeeId: pick,
					refusal: pick ? null : "replacement_missing",
				},
			],
			reportsKeepingAnotherManager: [],
			formerReports: [],
			ownManagerLinks: [],
			replacementOptions: [{ employeeId: ANNA, name: "Anna Admin" }],
		},
		refusals: pick ? [] : ["replacement_missing"],
	});
}

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
			// The confirmed status flow remains the path while the gate is closed.
			offboardingReleased={false}
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

/** Opens Deactivate's preview dialog (#1440) and waits until its preview is loaded. */
async function openDeactivation() {
	const menu = await openActions();
	fireEvent.click(within(menu).getByRole("menuitem", { name: "Deactivate" }));
	const dialog = await screen.findByRole("dialog");
	await waitFor(() =>
		expect(
			within(dialog).getByRole("button", { name: "Deactivate" }).hasAttribute("disabled"),
		).toBe(false),
	);
	return dialog;
}

const deactivationCall = (employeeId: string, replacementManagers = {}) => ({
	employeeId,
	requestId: expect.any(String),
	replacementManagers,
});

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

describe("EmployeeLifecycleActions after offboarding release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		["Deactivate", activeTarget],
		["Reactivate", { ...activeTarget, isActive: false }],
	])("links %s to the departure flow on the detail page instead of changing status", async (label, target) => {
		renderActions({ target, offboardingReleased: true });

		const menu = await openActions();
		const item = within(menu).getByRole("menuitem", { name: label });

		expect(item.getAttribute("href")).toBe("/settings/employees/employee-2#offboarding");
		fireEvent.click(item);
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(deactivateEmployeeMock).not.toHaveBeenCalled();
		expect(reactivateEmployeeMock).not.toHaveBeenCalled();
	});

	it("keeps owner-only access removal as its own confirmed action", async () => {
		renderActions({ offboardingReleased: true });

		const dialog = await openConfirmation("Remove access");

		expect(within(dialog).getByText("Remove organization access?")).toBeTruthy();
	});
});

describe("EmployeeLifecycleActions confirmations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		previewEmployeeDeactivationMock.mockResolvedValue({ success: true, data: previewPlan() });
	});

	it("previews what deactivation changes before confirming (#1440)", async () => {
		renderActions();

		const dialog = await openDeactivation();

		expect(within(dialog).getByText("Deactivate Alex Morgan?")).toBeTruthy();
		expect(previewEmployeeDeactivationMock).toHaveBeenCalledWith({
			employeeId: "employee-2",
			replacementManagers: {},
		});
		expect(within(dialog).getByText(/Personnel file retention starts/)).toBeTruthy();
		expect(screen.queryByRole("alertdialog")).toBeNull();
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
		previewEmployeeDeactivationMock.mockResolvedValue({ success: true, data: previewPlan() });
	});

	it("keeps a committed deactivation inactive and invalidates scoped data when cleanup is pending", async () => {
		const { invalidateQueries } = renderActions();
		const dialog = await openDeactivation();

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(onOptimisticStatusChangeMock.mock.calls).toEqual([["employee-2", false]]),
		);
		await waitFor(() =>
			expect(deactivateEmployeeMock).toHaveBeenCalledWith(deactivationCall("employee-2")),
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

	it("leaves the row unchanged on a thrown failure and shows a fixed message in the dialog without the raw error", async () => {
		deactivateEmployeeMock.mockRejectedValue(
			new Error("secret database detail"),
		);
		renderActions();
		const dialog = await openDeactivation();

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"Failed to deactivate employee",
		);
		expect(dialog.textContent).not.toContain("secret");
		expect(toastErrorMock).not.toHaveBeenCalled();
		// A deactivation changes the row only once confirmed (#1440).
		expect(onOptimisticStatusChangeMock).not.toHaveBeenCalled();
	});

	it("leaves the row unchanged on a resolved semantic failure", async () => {
		deactivateEmployeeMock.mockResolvedValue({
			success: false,
			error: "secret authorization detail",
		});
		renderActions();
		const dialog = await openDeactivation();

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"Failed to deactivate employee",
		);
		expect(dialog.textContent).not.toContain("authorization");
		expect(onOptimisticStatusChangeMock).not.toHaveBeenCalled();
	});

	it("localizes the final-owner deactivation guidance in the dialog without rendering the server message", async () => {
		deactivateEmployeeMock.mockResolvedValue({
			success: false,
			code: "ValidationError",
			error: "Assign and activate another approved owner before deactivating this employee",
		});
		renderActions();
		const dialog = await openDeactivation();

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"Localized final-owner deactivation guidance",
		);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("asks the preview again with each new pick and confirms with the picks", async () => {
		previewEmployeeDeactivationMock.mockImplementation(
			async (input: { replacementManagers: Record<string, string> }) => ({
				success: true,
				data: planWithReport(input.replacementManagers[REPORT] ?? null),
			}),
		);
		renderActions();
		const dialog = await openDeactivation();

		fireEvent.click(within(dialog).getByRole("combobox", { name: /New manager for/ }));
		fireEvent.click(await screen.findByRole("option", { name: "Anna Admin" }));

		await waitFor(() =>
			expect(previewEmployeeDeactivationMock).toHaveBeenLastCalledWith({
				employeeId: "employee-2",
				replacementManagers: { [REPORT]: ANNA },
			}),
		);
		await waitFor(() =>
			expect(
				within(dialog).getByRole("button", { name: "Deactivate" }).hasAttribute("disabled"),
			).toBe(false),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() =>
			expect(deactivateEmployeeMock).toHaveBeenCalledWith(
				deactivationCall("employee-2", { [REPORT]: ANNA }),
			),
		);
	});

	it("retries an unchanged submission with the same request ID and shows a refused pick in the dialog", async () => {
		deactivateEmployeeMock.mockResolvedValue({
			success: false,
			code: "ValidationError",
			error: "Choose a current admin or manager as the new manager of Rita Report.",
			refusal: "replacement_required",
		});
		renderActions();
		const dialog = await openDeactivation();
		const previews = previewEmployeeDeactivationMock.mock.calls.length;

		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
		expect((await within(dialog).findByRole("alert")).textContent).toMatch(
			/still needs an eligible new manager/,
		);
		// The refusal refreshes the preview, so the dialog shows the current picks' problems.
		await waitFor(() =>
			expect(previewEmployeeDeactivationMock.mock.calls.length).toBeGreaterThan(previews),
		);
		await waitFor(() =>
			expect(
				within(dialog).getByRole("button", { name: "Deactivate" }).hasAttribute("disabled"),
			).toBe(false),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

		await waitFor(() => expect(deactivateEmployeeMock).toHaveBeenCalledTimes(2));
		const [first, second] = deactivateEmployeeMock.mock.calls.map(([input]) => input);
		expect(second.requestId).toBe(first.requestId);
	});

	it.each([
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
		const actionMock = action === "reactivate" ? reactivateEmployeeMock : removeEmployeeAccessMock;
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
		const label = action === "reactivate" ? "Reactivate" : "Remove access";
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

	it("shows what the deactivation ended right after reactivating, each linked to where it is granted again", async () => {
		reactivateEmployeeMock.mockResolvedValueOnce({ success: true, data: undefined });
		getReactivationChecklistMock.mockResolvedValueOnce({
			success: true,
			data: {
				deactivationId: "deactivation-1",
				employeeId: "employee-2",
				deactivatedAt: "2026-10-24T08:00:00Z",
				reactivatedAt: "2026-10-26T07:30:00Z",
				timeZone: "Europe/Berlin",
				items: [
					{
						group: "managers",
						kind: "report_moved",
						employeeId: REPORT,
						name: "Rita Report",
						newManagerName: "Anna Admin",
						href: `/settings/employees/${REPORT}`,
					},
					{
						group: "grants",
						kind: "grant",
						grant: "payroll_access",
						href: "/settings/payroll-access",
					},
					{
						group: "teams",
						kind: "team",
						id: "team-1",
						name: "Floor team",
						href: "/settings/teams/team-1",
					},
				],
			},
		});
		renderActions({ target: { ...activeTarget, isActive: false } });
		const confirmation = await openConfirmation("Reactivate");

		fireEvent.click(within(confirmation).getByRole("button", { name: "Reactivate" }));

		const checklist = await screen.findByRole("dialog", {
			name: "{name} is reactivated: what to grant again",
		});
		expect(getReactivationChecklistMock).toHaveBeenCalledWith("employee-2");
		expect(
			within(checklist)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href")),
		).toEqual([
			`/settings/employees/${REPORT}`,
			"/settings/payroll-access",
			"/settings/teams/team-1",
		]);
		expect(within(checklist).getByRole("region", { name: "Held grants" }).textContent).toContain(
			"Payroll access",
		);
		expect(toastSuccessMock).toHaveBeenCalledWith("Employee reactivated", undefined);

		fireEvent.click(within(checklist).getByRole("button", { name: "Done" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("only confirms a reactivation that has nothing to grant again", async () => {
		reactivateEmployeeMock.mockResolvedValueOnce({ success: true, data: undefined });
		getReactivationChecklistMock.mockResolvedValueOnce({ success: true, data: null });
		renderActions({ target: { ...activeTarget, isActive: false } });
		const confirmation = await openConfirmation("Reactivate");

		fireEvent.click(within(confirmation).getByRole("button", { name: "Reactivate" }));

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith("Employee reactivated", undefined),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("says when the checklist could not be loaded and links to it on the employee page", async () => {
		reactivateEmployeeMock.mockResolvedValueOnce({ success: true, data: undefined });
		getReactivationChecklistMock.mockResolvedValueOnce({
			success: false,
			error: "Database unavailable",
			code: "DatabaseError",
		});
		renderActions({ target: { ...activeTarget, isActive: false } });
		const confirmation = await openConfirmation("Reactivate");

		fireEvent.click(within(confirmation).getByRole("button", { name: "Reactivate" }));

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith("Employee reactivated", {
				description: "The checklist of what to grant again could not be loaded.",
				action: { label: "What to grant again", onClick: expect.any(Function) },
			}),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		const [, options] = toastSuccessMock.mock.calls.at(-1) ?? [];
		options.action.onClick();
		expect(routerPushMock).toHaveBeenCalledWith(
			"/settings/employees/employee-2#reactivation-checklist",
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
		const dialog = await openDeactivation();
		const submit = within(dialog).getByRole("button", { name: "Deactivate" });

		fireEvent.click(submit);
		fireEvent.click(submit);

		await waitFor(() => expect(deactivateEmployeeMock).toHaveBeenCalledOnce());
		expect(
			within(dialog).getByRole("button", { name: "Deactivating..." }),
		).toHaveProperty("disabled", true);

		await act(async () => {
			resolveDeactivate({ success: true, data: undefined });
		});
	});

	it("uses the selected target when props rerender before confirmation", async () => {
		const { invalidateQueries, queryClient, rerender } = renderActions();
		const dialog = await openDeactivation();
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
			expect(deactivateEmployeeMock).toHaveBeenCalledExactlyOnceWith(deactivationCall("employee-2")),
		);
		await waitFor(() =>
			expect(onOptimisticStatusChangeMock).toHaveBeenCalledWith("employee-2", false),
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
		const dialog = await openDeactivation();
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
		expect(onOptimisticStatusChangeMock.mock.calls).toEqual([["employee-2", false]]);
	});

	it("never changes a row when props rerender during a failed request", async () => {
		let rejectDeactivate!: (error: Error) => void;
		deactivateEmployeeMock.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectDeactivate = reject;
			}),
		);
		const { queryClient, rerender } = renderActions();
		const dialog = await openDeactivation();
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

		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"Failed to deactivate employee",
		);
		expect(onOptimisticStatusChangeMock).not.toHaveBeenCalled();
		expect(deactivateEmployeeMock).toHaveBeenCalledExactlyOnceWith(deactivationCall("employee-2"));
	});
});
