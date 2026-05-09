import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	getMobileEffectiveSchedule: vi.fn(),
	findManyShifts: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/lib/mobile/effective-schedule", () => ({
	getMobileEffectiveSchedule: mockState.getMobileEffectiveSchedule,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			shift: {
				findMany: mockState.findManyShifts,
			},
		},
	},
}));

const { GET } = await import("./route");

describe("GET /api/mobile/schedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-11T12:00:00.000Z"));
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
		mockState.getMobileEffectiveSchedule.mockResolvedValue({
			policyName: "Standard",
			assignedVia: "Organization Default",
			scheduleCycle: "weekly",
			scheduleType: "fixed",
			hoursPerCycle: "40.00",
			homeOfficeDaysPerCycle: null,
			days: [],
		});
		mockState.findManyShifts.mockResolvedValue([
			{
				id: "shift-1",
				date: new Date("2026-04-12T23:00:00.000Z"),
				startTime: "09:00",
				endTime: "17:00",
				status: "published",
				notes: "Front desk",
				color: "#2563eb",
			},
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the employee's upcoming published shifts and effective schedule", async () => {
		const response = await GET(new Request("https://app.example.com/api/mobile/schedule"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.findManyShifts).toHaveBeenCalledOnce();
		expect(mockState.getMobileEffectiveSchedule).toHaveBeenCalledWith("emp-1", "org-1");
		expect(await response.json()).toEqual({
			activeOrganizationId: "org-1",
			shifts: [
				{
					id: "shift-1",
					date: "2026-04-12",
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
					notes: "Front desk",
					color: "#2563eb",
				},
			],
			effectiveSchedule: {
				policyName: "Standard",
				assignedVia: "Organization Default",
				scheduleCycle: "weekly",
				scheduleType: "fixed",
				hoursPerCycle: "40.00",
				homeOfficeDaysPerCycle: null,
				days: [],
			},
		});
	});

	it("returns 400 when no active organization is selected", async () => {
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: {
				user: { id: "user-1" },
				session: { activeOrganizationId: null },
			},
			activeOrganizationId: null,
			memberships: [],
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/schedule"));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Active organization required" });
		expect(mockState.requireMobileEmployee).not.toHaveBeenCalled();
	});
});
