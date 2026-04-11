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
	getAbsenceCategories: vi.fn(),
	getAbsenceEntries: vi.fn(),
	getVacationBalance: vi.fn(),
	requestAbsenceForEmployee: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	getAbsenceCategories: mockState.getAbsenceCategories,
	getAbsenceEntries: mockState.getAbsenceEntries,
	getVacationBalance: mockState.getVacationBalance,
	requestAbsenceForEmployee: mockState.requestAbsenceForEmployee,
}));

const { GET, POST } = await import("./route");

describe("/api/mobile/absences", () => {
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

	it("returns categories and the current employee's absences with vacation balance", async () => {
		mockState.getAbsenceCategories.mockResolvedValue([
			{
				id: "11111111-1111-1111-1111-111111111111",
				name: "Vacation",
				type: "vacation",
				description: null,
				color: "#22c55e",
				requiresApproval: true,
				countsAgainstVacation: true,
			},
		]);
		mockState.getAbsenceEntries.mockResolvedValue([
			{
				id: "absence-1",
				employeeId: "emp-1",
				startDate: "2026-04-12",
				endDate: "2026-04-12",
				startPeriod: "full_day",
				endPeriod: "full_day",
				status: "pending",
				notes: null,
				category: {
					id: "11111111-1111-1111-1111-111111111111",
					name: "Vacation",
					type: "vacation",
					color: "#22c55e",
					countsAgainstVacation: true,
				},
				approvedBy: null,
				approvedAt: null,
				rejectionReason: null,
				createdAt: "2026-04-01T08:00:00.000Z",
			},
		]);
		mockState.getVacationBalance.mockResolvedValue({
			year: 2026,
			totalDays: 25,
			usedDays: 5,
			pendingDays: 2,
			remainingDays: 18,
			carryoverDays: 0,
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/absences"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.getAbsenceCategories).toHaveBeenCalledWith("org-1");
		expect(mockState.getAbsenceEntries).toHaveBeenCalledWith("emp-1", "2025-01-01", "2027-12-31");
		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-1", 2026);
		expect(await response.json()).toEqual({
			categories: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					name: "Vacation",
					type: "vacation",
					description: null,
					color: "#22c55e",
					requiresApproval: true,
					countsAgainstVacation: true,
				},
			],
			absences: [
				{
					id: "absence-1",
					employeeId: "emp-1",
					startDate: "2026-04-12",
					endDate: "2026-04-12",
					startPeriod: "full_day",
					endPeriod: "full_day",
					status: "pending",
					notes: null,
					category: {
						id: "11111111-1111-1111-1111-111111111111",
						name: "Vacation",
						type: "vacation",
						color: "#22c55e",
						countsAgainstVacation: true,
					},
					approvedBy: null,
					approvedAt: null,
					rejectionReason: null,
					createdAt: "2026-04-01T08:00:00.000Z",
				},
			],
			vacationBalance: {
				year: 2026,
				totalDays: 25,
				usedDays: 5,
				pendingDays: 2,
				remainingDays: 18,
				carryoverDays: 0,
			},
		});
	});

	it("uses a cross-year query window so upcoming absences stay visible around year end", async () => {
		vi.setSystemTime(new Date("2026-12-31T10:00:00.000Z"));
		mockState.getAbsenceCategories.mockResolvedValue([]);
		mockState.getAbsenceEntries.mockResolvedValue([]);
		mockState.getVacationBalance.mockResolvedValue({
			year: 2026,
			totalDays: 25,
			usedDays: 5,
			pendingDays: 0,
			remainingDays: 20,
			carryoverDays: 0,
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/absences"));

		expect(response.status).toBe(200);
		expect(mockState.getAbsenceEntries).toHaveBeenCalledWith("emp-1", "2025-01-01", "2027-12-31");
	});

	it("creates a new absence request", async () => {
		mockState.requestAbsenceForEmployee.mockResolvedValue({
			success: true,
			data: { absenceId: "absence-2" },
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/absences", {
				method: "POST",
				body: JSON.stringify({
					categoryId: "11111111-1111-1111-1111-111111111111",
					startDate: "2026-04-20",
					startPeriod: "full_day",
					endDate: "2026-04-21",
					endPeriod: "full_day",
					notes: "Family trip",
				}),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.requestAbsenceForEmployee).toHaveBeenCalledWith(
			{
			categoryId: "11111111-1111-1111-1111-111111111111",
			startDate: "2026-04-20",
			startPeriod: "full_day",
			endDate: "2026-04-21",
			endPeriod: "full_day",
			notes: "Family trip",
			},
			{
				id: "emp-1",
				organizationId: "org-1",
			},
			"user-1",
		);
		expect(await response.json()).toEqual({
			success: true,
			data: { absenceId: "absence-2" },
		});
	});

	it("rejects impossible real dates before calling the request action", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/absences", {
				method: "POST",
				body: JSON.stringify({
					categoryId: "11111111-1111-1111-1111-111111111111",
					startDate: "2026-02-31",
					startPeriod: "full_day",
					endDate: "2026-03-01",
					endPeriod: "full_day",
				}),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.requestAbsenceForEmployee).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({
			error: "startDate must be a real calendar date",
		});
	});
});
