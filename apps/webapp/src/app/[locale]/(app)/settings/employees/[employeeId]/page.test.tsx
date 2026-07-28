import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentApprovedMembership: vi.fn(),
	getCurrentSettingsRouteContext: vi.fn(),
	getEmployee: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
}));
vi.mock("../current-approved-membership", () => ({
	getCurrentApprovedMembership: mockState.getCurrentApprovedMembership,
}));
vi.mock("../actions", () => ({ getEmployee: mockState.getEmployee }));
vi.mock("./employee-detail-page-client", () => ({
	EmployeeDetailPageClient: "EmployeeDetailPageClient",
}));

const { default: EmployeeDetailPage } = await import("./page");

describe("EmployeeDetailPage actor membership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "orgAdmin",
		});
		mockState.getEmployee.mockResolvedValue({
			success: true,
			data: { id: "employee-1" },
		});
	});

	it("passes the approved membership role to detail controls", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue({ role: "owner" });

		const page = await EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});

		expect(mockState.getCurrentApprovedMembership).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
		});
		expect(page.props).toMatchObject({
			currentUserId: "user-1",
			currentMemberRole: "owner",
		});
	});

	it("denies detail access when no approved membership exists", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue(null);

		await expect(
			EmployeeDetailPage({
				params: Promise.resolve({ employeeId: "employee-1" }),
			}),
		).rejects.toThrow("redirect:/settings");
		expect(mockState.getEmployee).not.toHaveBeenCalled();
	});
});
