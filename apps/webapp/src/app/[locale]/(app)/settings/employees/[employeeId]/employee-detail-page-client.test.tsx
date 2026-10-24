/* @vitest-environment jsdom */

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { EmployeeReadSnapshot } from "@/lib/organization/employee-read-types";
import { queryKeys } from "@/lib/query";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";
import type { EmployeeDetailFormApi } from "./page-utils";

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
	EmployeeEditFormCard: ({ form }: { form: EmployeeDetailFormApi }) => (
		<div>
			Edit employee
			<form.Field name="firstName">
				{(field) => (
					<input
						aria-label="First name"
						value={field.state.value}
						onChange={(event) => field.handleChange(event.target.value)}
					/>
				)}
			</form.Field>
		</div>
	),
	EmployeeOverviewCard: ({ employee }: { employee: EmployeeDetail }) => (
		<div>{employee.user.name}</div>
	),
}));

vi.mock("@/components/settings/employee-offboarding/employee-offboarding-section", () => ({
	EmployeeOffboardingSection: ({ employeeId }: { employeeId: string }) => (
		<section aria-label="Employment and departure">{employeeId}</section>
	),
	}),
);

vi.mock(
	"@/components/settings/personal-data-export/employee-personal-data-export-card",
	() => ({
		EmployeePersonalDataExportCard: ({
			isOwnRecord,
		}: {
			isOwnRecord: boolean;
		}) => (
			<section aria-label="Personal data export">
				{isOwnRecord ? "own record" : "colleague"}
			</section>
		),
	}),
);

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
const employmentHistoryCardProps = vi.hoisted(() => ({
	last: null as null | Record<string, unknown>,
}));
vi.mock("@/components/settings/employee-employment-history-card", () => ({
	EmployeeEmploymentHistoryCard: (
		props: { notice?: ReactNode } & Record<string, unknown>,
	) => {
		employmentHistoryCardProps.last = props;
		return <>{props.notice}</>;
	},
}));
vi.mock(
	"@/components/settings/employee-employment-history/wage-history-merge-note",
	() => ({
		WageHistoryMergeNote: ({ employeeId }: { employeeId: string }) => (
			<p>Merge note for {employeeId}</p>
		),
	}),
);
vi.mock("@/components/settings/employee-skills-card", () => ({
	EmployeeSkillsCard: () => null,
}));
vi.mock("@/components/settings/manager-assignment", () => ({
	ManagerAssignment: () => null,
}));
vi.mock("@/components/settings/work-balance-recalculation-card", () => ({
	WorkBalanceRecalculationCard: () => null,
}));
vi.mock("@/components/settings/work-balance/employee-work-balance-section", () => ({
	EmployeeWorkBalanceSection: () => null,
	}),
);
vi.mock("@/components/personnel-file/personnel-file-panel", () => ({
	PersonnelFilePanel: ({
		capability,
	}: {
		capability: { employeeId: string };
	}) => (
		<section aria-label="Personnel file panel">{capability.employeeId}</section>
	),
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
		employmentHistory: [],
		workPolicies: [],
		isLoading: false,
		hasEmployee: true,
		updateEmployee: vi.fn(),
		isUpdating: false,
		changeWage: vi.fn(),
		isChangingWage: false,
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
	personnelFile = null,
}: {
	employee?: EmployeeDetail;
	currentUserId?: string;
	currentMemberRole?: string;
	accessTier?: "orgAdmin" | "manager" | "member";
	personnelFile?: { employeeId: string; categories: []; today: string } | null;
} = {}) {
	const snapshot = {
		scope: { userId: currentUserId, organizationId: employee.organizationId },
		data: employee,
		updatedAt: Date.now(),
	};
	useEmployeeMock.mockImplementation(
		({ employeeId }: { employeeId: string }) => {
			const query = useQuery({
				queryKey: queryKeys.employees.detailFor(
					currentUserId,
					employee.organizationId,
					employeeId,
				),
				queryFn: async () => snapshot,
				initialData: snapshot,
				staleTime: Number.POSITIVE_INFINITY,
			});
			return employeeHookResult(query.data.data);
		},
	);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(
		queryKeys.employees.detailFor(
			currentUserId,
			employee.organizationId,
			employee.id,
		),
		snapshot,
	);

	return {
		queryClient,
		setEmployee: (updated: EmployeeDetail) =>
			queryClient.setQueryData(
				queryKeys.employees.detailFor(
					currentUserId,
					employee.organizationId,
					employee.id,
				),
				{ ...snapshot, data: updated, updatedAt: Date.now() },
			),
		...render(
			<QueryClientProvider client={queryClient}>
				<EmployeeDetailPageClient
					params={resolvedParams(employee.id)}
					accessTier={accessTier}
					currentUserId={currentUserId}
					currentMemberRole={currentMemberRole}
					personnelFile={personnelFile}
				/>
			</QueryClientProvider>,
		),
	};
}

describe("employee detail wage history merge note (#1176)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows the note on the terms card to org admins", async () => {
		renderDetail({ accessTier: "orgAdmin" });
		expect(await screen.findByText("Merge note for employee-2")).toBeTruthy();
	});

	it("shows no note to managers", async () => {
		renderDetail({ accessTier: "manager", currentMemberRole: "member" });
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByText(/Merge note/)).toBeNull();
	});
});

describe("employee detail personnel file tab (#865)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows no tabs without a personnel file capability", async () => {
		renderDetail();
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Personnel file" })).toBeNull();
	});

	it("offers the personnel file as a tab when the server grants it", async () => {
		renderDetail({
			personnelFile: {
				employeeId: "employee-2",
				categories: [],
				today: "2026-10-09",
			},
		});
		const tab = await screen.findByRole("tab", { name: "Personnel file" });
		expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();

		act(() => {
			fireEvent.mouseDown(tab);
			fireEvent.click(tab);
		});

		expect(
			await screen.findByRole("region", { name: "Personnel file panel" }),
		).toBeTruthy();
	});
});

describe("employee detail Change wage (#1177)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		employmentHistoryCardProps.last = null;
	});

	const hourlyToday = {
		...realEmployee,
		contractTypeToday: "hourly",
	} as EmployeeDetail;

	it("offers Change wage to an org admin while today's terms are hourly", async () => {
		renderDetail({ employee: hourlyToday });
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();

		expect(employmentHistoryCardProps.last?.changeWage).toEqual({
			onSubmit: expect.any(Function),
			isPending: false,
		});
	});

	it("offers no Change wage to a scoped manager", async () => {
		renderDetail({
			employee: hourlyToday,
			accessTier: "manager",
			currentMemberRole: "member",
		});
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();

		expect(employmentHistoryCardProps.last).not.toBeNull();
		expect(employmentHistoryCardProps.last?.changeWage).toBeUndefined();
	});

	it("offers no Change wage while today's terms are fixed", async () => {
		renderDetail({
			employee: {
				...realEmployee,
				contractTypeToday: "fixed",
			} as EmployeeDetail,
		});
		expect(await screen.findByText("Alex Morgan")).toBeTruthy();

		expect(employmentHistoryCardProps.last?.changeWage).toBeUndefined();
	});
});

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
		},
	);

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

	it.each(["owner", "member,owner"])(
		"hides lifecycle controls from admins for target owner role %s",
		async (targetRole) => {
		renderDetail({
			currentMemberRole: "admin",
			employee: {
				...realEmployee,
				membership: { ...approvedMembership, role: targetRole },
			} as EmployeeDetail,
		});

		expect(await screen.findByText("Alex Morgan")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
		},
	);

	it.each(["owner", "member,owner"])(
		"shows lifecycle controls to another owner for target owner role %s",
		async (targetRole) => {
		renderDetail({
			employee: {
				...realEmployee,
				membership: { ...approvedMembership, role: targetRole },
			} as EmployeeDetail,
		});

		expect(
			await screen.findByRole("button", { name: "Deactivate" }),
		).toBeTruthy();
		},
	);

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
		},
	);

	it.each(["orgAdmin", "manager"] as const)("shows the departure section to %s viewers of a real employee", async (accessTier) => {
		renderDetail({ accessTier });

		expect(
			await screen.findByRole("region", { name: "Employment and departure" }),
		).toBeTruthy();
		},
	);

	it("offers the admin export to org admins only, marked on their own record (#1166)", async () => {
		const { unmount } = renderDetail({ accessTier: "orgAdmin" });
		expect(
			(await screen.findByRole("region", { name: "Personal data export" })).textContent,
		).toBe("colleague");
		unmount();

		const own = renderDetail({
			accessTier: "orgAdmin",
			currentUserId: "user-2",
		});
		expect(
			(await screen.findByRole("region", { name: "Personal data export" })).textContent,
		).toBe("own record");
		own.unmount();

		renderDetail({ accessTier: "manager" });
		await screen.findByRole("region", { name: "Employment and departure" });
		expect(
			screen.queryByRole("region", { name: "Personal data export" }),
		).toBeNull();
	});

	it("never offers departure controls on an invitation draft", async () => {
		renderDetail({ employee: draftEmployee });

		expect(await screen.findByText("Draft actions")).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Employment and departure" }),
		).toBeNull();
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
			queryClient.getQueryData<EmployeeReadSnapshot<"detail">>(
				queryKeys.employees.detailFor("owner-user", "org-1", "employee-2"),
			)?.data.isActive,
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
			queryClient.getQueryData<EmployeeReadSnapshot<"detail">>(
				queryKeys.employees.detailFor("owner-user", "org-1", "employee-2"),
			)?.data,
		).toMatchObject({
			id: "employee-2",
			isActive: false,
			membership: null,
		});
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("renders restored membership from authoritative query data after local removal", async () => {
		const { setEmployee } = renderDetail();
		fireEvent.click(
			await screen.findByRole("button", { name: "Remove access" }),
		);
		expect(
			await screen.findByText(
				"This employee no longer has organization membership. Send a new invitation to restore access.",
			),
		).toBeTruthy();

		await act(async () => {
			setEmployee({
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
		const { setEmployee } = renderDetail();
		fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
		expect(
			await screen.findByRole("button", { name: "Reactivate" }),
		).toBeTruthy();

		await act(async () => {
			setEmployee({
				...realEmployee,
				isActive: true,
			});
		});

		expect(
			await screen.findByRole("button", { name: "Deactivate" }),
		).toBeTruthy();
	});
});

describe("employee detail drafts during refresh", () => {
	beforeEach(() => vi.clearAllMocks());
	it("keeps typed fields when fresh server data arrives", async () => {
		const employee = {
			...realEmployee,
			user: { ...realEmployee.user, firstName: "Alex" },
		} as EmployeeDetail;
		const { setEmployee } = renderDetail({ employee });
		const input = await screen.findByRole("textbox", { name: "First name" });
		await act(async () =>
			fireEvent.change(input, { target: { value: "Unsaved Alex" } }),
		);
		await act(async () =>
			setEmployee({
				...employee,
				user: { ...employee.user, firstName: "Server Alex" },
			}),
		);
		expect((input as HTMLInputElement).value).toBe("Unsaved Alex");
	});
	it("updates untouched fields when fresh server data arrives", async () => {
		const employee = {
			...realEmployee,
			user: { ...realEmployee.user, firstName: "Alex" },
		} as EmployeeDetail;
		const { setEmployee } = renderDetail({ employee });
		const input = await screen.findByRole("textbox", { name: "First name" });
		await act(async () =>
			setEmployee({
				...employee,
				user: { ...employee.user, firstName: "Server Alex" },
			}),
		);
		await waitFor(() => expect((input as HTMLInputElement).value).toBe("Server Alex"));
	});
});
