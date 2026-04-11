import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	MobileApiError: class MobileApiError extends Error {
		constructor(
			readonly status: number,
			message: string,
		) {
			super(message);
		}
	},
	requireMobileSessionContext: vi.fn(),
	requireMobileEmployee: vi.fn(),
	cancelAbsenceRequestForEmployee: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	cancelAbsenceRequestForEmployee: mockState.cancelAbsenceRequestForEmployee,
}));

const { POST } = await import("./route");

describe("POST /api/mobile/absences/[absenceId]/cancel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			activeOrganizationId: "org-1",
			memberships: [{ organizationId: "org-1" }],
		});
		mockState.requireMobileEmployee.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
		});
	});

	it("returns 400 when the absence is not pending", async () => {
		mockState.cancelAbsenceRequestForEmployee.mockResolvedValue({
			success: false,
			error: "Only pending absence requests can be cancelled",
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/absences/absence-1/cancel", {
				method: "POST",
			}),
			{ params: Promise.resolve({ absenceId: "absence-1" }) },
		);

		expect(response.status).toBe(400);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.cancelAbsenceRequestForEmployee).toHaveBeenCalledWith("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});
		expect(await response.json()).toEqual({
			error: "Only pending absence requests can be cancelled",
		});
	});

	it("returns 400 when the absence belongs to a different organization", async () => {
		mockState.cancelAbsenceRequestForEmployee.mockResolvedValue({
			success: false,
			error: "Absence not found in the active organization",
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/absences/absence-2/cancel", {
				method: "POST",
			}),
			{ params: Promise.resolve({ absenceId: "absence-2" }) },
		);

		expect(response.status).toBe(400);
		expect(mockState.cancelAbsenceRequestForEmployee).toHaveBeenCalledWith("absence-2", {
			id: "emp-1",
			organizationId: "org-1",
		});
		expect(await response.json()).toEqual({
			error: "Absence not found in the active organization",
		});
	});
});
