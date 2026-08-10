import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	activeOrganizationIdForTimezone: undefined as string | undefined,
	employeeFindFirst: vi.fn(),
	getAuthContext: vi.fn(),
	getSession: vi.fn(),
	headers: vi.fn(),
	organizationFindFirst: vi.fn(),
	redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mockState.headers }));
vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mockState.getSession } },
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mockState.employeeFindFirst },
			organization: { findFirst: mockState.organizationFindFirst },
		},
	},
}));
vi.mock("@/components/scheduling/scheduler/shift-scheduler", () => ({
	ShiftScheduler: "ShiftScheduler",
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: "Skeleton" }));
vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

const { default: SchedulingPage } = await import("./page");

describe("SchedulingPageContent organization scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.activeOrganizationIdForTimezone = undefined;
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-multi-org" },
			session: { activeOrganizationId: "org-b" },
			employee: {
				id: "employee-b",
				organizationId: "org-b",
				role: "employee",
				teamId: null,
			},
		});
		mockState.getSession.mockResolvedValue({
			user: { id: "user-multi-org" },
		});
		mockState.employeeFindFirst.mockResolvedValue({
			id: "employee-a",
			organizationId: "org-a",
			role: "manager",
		});
		mockState.organizationFindFirst.mockImplementation(
			async ({ where }: { where: unknown }) => {
				if (typeof where === "function") {
					where(
						{ id: "organization.id" },
						{
							eq: (_column: unknown, value: string) => {
								mockState.activeOrganizationIdForTimezone = value;
								return true;
							},
						},
					);
				}
				return { timezone: "America/New_York" };
			},
		);
	});

	it("uses the active approved employee instead of the first user employee", async () => {
		const suspenseShell = SchedulingPage();
		const SchedulingPageContent = suspenseShell.props.children.type;
		const page = await SchedulingPageContent();
		const scheduler = page.props.children.props.children[1];

		expect(scheduler.type).toBe("ShiftScheduler");
		expect(scheduler.props).toMatchObject({
			organizationId: "org-b",
			organizationTimezone: "America/New_York",
			employeeId: "employee-b",
			isManager: false,
		});
		expect(mockState.activeOrganizationIdForTimezone).toBe("org-b");
		expect(mockState.getAuthContext).toHaveBeenCalledOnce();
		expect(mockState.getSession).not.toHaveBeenCalled();
		expect(mockState.headers).not.toHaveBeenCalled();
		expect(mockState.employeeFindFirst).not.toHaveBeenCalled();
	});
});
