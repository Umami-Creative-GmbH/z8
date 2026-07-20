/* @vitest-environment jsdom */

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { queryKeys } from "@/lib/query";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";

const { pushMock, useEmployeeMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	useEmployeeMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/query/use-employee", () => ({
	useEmployee: useEmployeeMock,
}));

vi.mock("./page-sections", () => ({
	EmployeeDetailHeader: ({ actions }: { actions?: ReactNode }) => (
		<header>
			<h1>Employee details</h1>
			{actions}
		</header>
	),
	EmployeeEditFormCard: () => <div>Edit employee</div>,
	EmployeeOverviewCard: ({ employee }: { employee: EmployeeDetail }) => (
		<div>{employee.user.name}</div>
	),
}));

vi.mock("./employee-draft-actions", () => ({
	EmployeeDraftActions: () => <div>Draft actions</div>,
}));

vi.mock("@/components/organization/employee-lifecycle-actions", () => ({
	EmployeeLifecycleActions: ({
		target,
		currentUserId,
		currentMemberRole,
		onOptimisticStatusChange,
		onRemoved,
	}: {
		target: {
			employeeId: string;
			userId: string;
			isActive: boolean;
			membership: { status: string; role: string } | null;
		};
		currentUserId: string;
		currentMemberRole: string;
		onOptimisticStatusChange(employeeId: string, isActive: boolean): void;
		onRemoved(employeeId: string): void;
	}) => {
		const actorIsOwner = hasOrganizationRole(currentMemberRole, "owner");
		const actorIsAdmin = hasOrganizationRole(currentMemberRole, "admin");
		const targetIsOwner = hasOrganizationRole(target.membership?.role, "owner");
		if (
			target.userId === currentUserId ||
			target.membership?.status !== "approved" ||
			(!actorIsOwner && !actorIsAdmin) ||
			(!actorIsOwner && actorIsAdmin && targetIsOwner)
		)
			return null;

		return (
			<div>
				<button
					type="button"
					onClick={() =>
						onOptimisticStatusChange(target.employeeId, !target.isActive)
					}
				>
					{target.isActive ? "Deactivate" : "Reactivate"}
				</button>
				{actorIsOwner && (
					<button type="button" onClick={() => onRemoved(target.employeeId)}>
						Remove access
					</button>
				)}
			</div>
		);
	},
}));

vi.mock(
	"@/components/settings/custom-roles/employee-custom-roles-card",
	() => ({
		EmployeeCustomRolesCard: () => null,
	}),
);
vi.mock("@/components/settings/employee-employment-history-card", () => ({
	EmployeeEmploymentHistoryCard: () => null,
}));
vi.mock("@/components/settings/employee-skills-card", () => ({
	EmployeeSkillsCard: () => null,
}));
vi.mock("@/components/settings/manager-assignment", () => ({
	ManagerAssignment: () => null,
}));
vi.mock("@/components/settings/rate-history-card", () => ({
	RateHistoryCard: () => null,
}));
vi.mock("@/components/settings/work-balance-recalculation-card", () => ({
	WorkBalanceRecalculationCard: () => null,
}));

const approvedMembership = {
	id: "member-2",
	role: "member",
	status: "approved",
};
const realEmployee = {
	id: "employee-2",
	kind: "employee",
	organizationId: "org-1",
	userId: "user-2",
	isActive: true,
	membership: approvedMembership,
	contractType: "fixed",
	user: {
		id: "user-2",
		name: "Alex Morgan",
		email: "alex@example.com",
		image: null,
	},
	managers: [],
} as EmployeeDetail;

const draftEmployee = {
	...realEmployee,
	id: "draft-2",
	encodedId: "draft:draft-2",
	kind: "invitationDraft",
	isActive: false,
	membership: null,
	realEmployeeId: null,
	invitationStatus: "pending",
	invitation: { id: "invitation-2" },
} as EmployeeDetail;

function employeeHookResult(employee: EmployeeDetail) {
	return {
		employee,
		schedule: null,
		availableManagers: [],
		rateHistory: [],
		employmentHistory: [],
		workPolicies: [],
		isLoading: false,
		isLoadingRateHistory: false,
		hasEmployee: true,
		updateEmployee: vi.fn(),
		isUpdating: false,
		updateRate: vi.fn(),
		isUpdatingRate: false,
		createEmploymentHistory: vi.fn(),
		isCreatingEmploymentHistory: false,
		confirmEmploymentHistory: vi.fn(),
		isConfirmingEmploymentHistory: false,
		cancelEmploymentHistory: vi.fn(),
		isCancelingEmploymentHistory: false,
		requestWorkBalanceRecalculation: vi.fn(),
		isRequestingWorkBalanceRecalculation: false,
		refetch: vi.fn(),
	};
}

function resolvedParams(employeeId: string) {
	const value = { employeeId };
	return Object.assign(Promise.resolve(value), {
		status: "fulfilled",
		value,
	});
}

function renderDetail({
	employee = realEmployee,
	currentUserId = "owner-user",
	currentMemberRole = "owner",
	accessTier = "orgAdmin",
}: {
	employee?: EmployeeDetail;
	currentUserId?: string;
	currentMemberRole?: string;
	accessTier?: "orgAdmin" | "manager" | "member";
} = {}) {
	useEmployeeMock.mockImplementation(
		({ employeeId }: { employeeId: string }) => {
			const query = useQuery({
				queryKey: queryKeys.employees.detail(employeeId),
				queryFn: async () => employee,
				initialData: employee,
			});
			return employeeHookResult(query.data);
		},
	);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(queryKeys.employees.detail(employee.id), employee);

	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<EmployeeDetailPageClient
					params={resolvedParams(employee.id)}
					accessTier={accessTier}
					currentUserId={currentUserId}
					currentMemberRole={currentMemberRole}
				/>
			</QueryClientProvider>,
		),
	};
}

describe("employee detail lifecycle integration", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		[realEmployee, "owner", "Deactivate", true],
		[{ ...realEmployee, isActive: false }, "admin", "Reactivate", false],
		[realEmployee, "member,owner", "Deactivate", true],
		[realEmployee, "member,admin", "Deactivate", false],
	] as const)("renders authorized controls with tokenized role %s", async (employee, role, statusAction, canRemove) => {
		renderDetail({
			employee: employee as EmployeeDetail,
			currentMemberRole: role,
		});

		expect(
			await screen.findByRole("button", { name: statusAction }),
		).toBeTruthy();
		expect(
			Boolean(screen.queryByRole("button", { name: "Remove access" })),
		).toBe(canRemove);
	});

	it("renders no lifecycle controls for self or manager actors", async () => {
		const { rerender, queryClient } = renderDetail({ currentUserId: "user-2" });
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();

		rerender(
			<QueryClientProvider client={queryClient}>
				<EmployeeDetailPageClient
					params={resolvedParams("employee-2")}
					accessTier="manager"
					currentUserId="manager-user"
					currentMemberRole="member"
				/>
			</QueryClientProvider>,
		);
		expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
	});

	it.each([
		"owner",
		"member,owner",
	])("hides lifecycle controls from admins for target owner role %s", async (targetRole) => {
		renderDetail({
			currentMemberRole: "admin",
			employee: {
				...realEmployee,
				membership: { ...approvedMembership, role: targetRole },
			} as EmployeeDetail,
		});

		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
	});

	it.each([
		"owner",
		"member,owner",
	])("shows lifecycle controls to another owner for target owner role %s", async (targetRole) => {
		renderDetail({
			employee: {
				...realEmployee,
				membership: { ...approvedMembership, role: targetRole },
			} as EmployeeDetail,
		});

		expect(
			await screen.findByRole("button", { name: "Deactivate" }),
		).toBeTruthy();
	});

	it("keeps draft actions without employee lifecycle controls", async () => {
		renderDetail({ employee: draftEmployee });

		expect(await screen.findByText("Draft actions")).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: /Deactivate|Reactivate|Remove access/,
			}),
		).toBeNull();
	});

	it.each([
		["manager", "admin"],
		["member", "owner"],
		["orgAdmin", "member"],
	] as const)("hides draft actions for access tier %s with membership role %s", async (accessTier, currentMemberRole) => {
		renderDetail({ employee: draftEmployee, accessTier, currentMemberRole });

		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByText("Draft actions")).toBeNull();
	});

	it("shows reinvitation guidance when inactive history has no membership", async () => {
		renderDetail({
			employee: {
				...realEmployee,
				isActive: false,
				membership: null,
			} as EmployeeDetail,
		});

		expect(
			await screen.findByText(
				"This employee no longer has organization membership. Send a new invitation to restore access.",
			),
		).toBeTruthy();
	});

	it("updates local and query detail status optimistically", async () => {
		const { queryClient } = renderDetail();
		fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

		expect(
			await screen.findByRole("button", { name: "Reactivate" }),
		).toBeTruthy();
		expect(
			queryClient.getQueryData<EmployeeDetail>(
				queryKeys.employees.detail("employee-2"),
			)?.isActive,
		).toBe(false);
	});

	it("keeps historical detail after removal and clears membership without redirecting", async () => {
		const { queryClient } = renderDetail();
		fireEvent.click(
			await screen.findByRole("button", { name: "Remove access" }),
		);

		expect(screen.getByText("Alex Morgan")).toBeTruthy();
		expect(
			await screen.findByText(
				"This employee no longer has organization membership. Send a new invitation to restore access.",
			),
		).toBeTruthy();
		expect(
			queryClient.getQueryData<EmployeeDetail>(
				queryKeys.employees.detail("employee-2"),
			),
		).toMatchObject({
			id: "employee-2",
			isActive: false,
			membership: null,
		});
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("renders restored membership from authoritative query data after local removal", async () => {
		const { queryClient } = renderDetail();
		fireEvent.click(
			await screen.findByRole("button", { name: "Remove access" }),
		);
		expect(
			await screen.findByText(
				"This employee no longer has organization membership. Send a new invitation to restore access.",
			),
		).toBeTruthy();

		await act(async () => {
			queryClient.setQueryData(queryKeys.employees.detail("employee-2"), {
				...realEmployee,
				isActive: true,
				membership: { ...approvedMembership, id: "member-restored" },
			});
		});

		expect(
			await screen.findByRole("button", { name: "Deactivate" }),
		).toBeTruthy();
		expect(screen.queryByText(/Invite this person again/)).toBeNull();
	});

	it("renders an external status refresh after a local optimistic change", async () => {
		const { queryClient } = renderDetail();
		fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
		expect(
			await screen.findByRole("button", { name: "Reactivate" }),
		).toBeTruthy();

		await act(async () => {
			queryClient.setQueryData(queryKeys.employees.detail("employee-2"), {
				...realEmployee,
				isActive: true,
			});
		});

		expect(
			await screen.findByRole("button", { name: "Deactivate" }),
		).toBeTruthy();
	});
});
