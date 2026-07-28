import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentApprovedMembership: vi.fn(),
	getCurrentSettingsRouteContext: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
}));
vi.mock("./current-approved-membership", () => ({
	getCurrentApprovedMembership: mockState.getCurrentApprovedMembership,
}));
vi.mock("./employees-page-client", () => ({
	EmployeesPageClient: "EmployeesPageClient",
}));

const { default: EmployeesPage } = await import("./page");

describe("EmployeesPage actor membership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "manager",
		});
	});

	it("passes the approved membership role to directory controls", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue({ role: "admin" });

		const page = await EmployeesPage();

		expect(mockState.getCurrentApprovedMembership).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
		});
		expect(page.props).toMatchObject({
			currentUserId: "user-1",
			currentMemberRole: "admin",
		});
	});

	it("denies directory access when no approved membership exists", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue(null);

		await expect(EmployeesPage()).rejects.toThrow("redirect:/settings");
	});
});
