import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mockState.getCurrentSettingsAccess,
}));
vi.mock("./employees-page-client", () => ({
	EmployeesPageClient: "EmployeesPageClient",
}));

const { default: EmployeesPage } = await import("./page");

describe("EmployeesPage viewer settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes the viewer's settings access to directory controls", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: { id: "employee-1", role: "manager" },
			settingsAccess: "scopedManager",
			membershipRole: "member",
		});

		const page = await EmployeesPage();

		expect(mockState.getCurrentSettingsAccess).toHaveBeenCalledTimes(1);
		expect(page.props).toMatchObject({
			organizationId: "org-1",
			currentUserId: "user-1",
			currentEmployee: { id: "employee-1", role: "manager" },
			settingsAccess: "scopedManager",
			people: undefined,
		});
		expect(page.props).not.toHaveProperty("accessTier");
	});

	it.each([
		null,
		{
			userId: "user-1",
			organizationId: "org-1",
			employee: null,
			settingsAccess: null,
			membershipRole: null,
		},
		{
			userId: "user-1",
			organizationId: "org-1",
			employee: { id: "employee-1", role: "employee" },
			settingsAccess: "member",
			membershipRole: "member",
		},
	])("denies directory access without scoped-manager settings access", async (caller) => {
		mockState.getCurrentSettingsAccess.mockResolvedValue(caller);

		await expect(EmployeesPage()).rejects.toThrow("redirect:/en/settings");
	});
});
