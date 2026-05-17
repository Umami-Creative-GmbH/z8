import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	getVerifiedOrgContext: vi.fn(),
	getAbsencesForMonth: vi.fn(async () => []),
	getHolidaysForMonth: vi.fn(async () => []),
	getTimeEntriesForMonth: vi.fn(async () => []),
	getWorkPeriodsForMonth: vi.fn(async () => []),
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/lib/auth-helpers", () => ({
	getVerifiedOrgContext: mockState.getVerifiedOrgContext,
}));

vi.mock("@/lib/calendar/absence-service", () => ({
	getAbsencesForMonth: mockState.getAbsencesForMonth,
}));

vi.mock("@/lib/calendar/holiday-service", () => ({
	getHolidaysForMonth: mockState.getHolidaysForMonth,
}));

vi.mock("@/lib/calendar/time-entry-service", () => ({
	getTimeEntriesForMonth: mockState.getTimeEntriesForMonth,
}));

vi.mock("@/lib/calendar/work-period-service", () => ({
	getWorkPeriodsForMonth: mockState.getWorkPeriodsForMonth,
}));

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		nextUrl: new URL(url),
	} as unknown as NextRequest;
}

describe("GET /api/calendar/events", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.connection.mockResolvedValue(undefined);
		mockState.getVerifiedOrgContext.mockResolvedValue({
			isValid: true,
			userId: "user-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			role: "employee",
		});
	});

	it("scopes employee calendar event requests to the caller's employee record", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showAbsences=true&showTimeEntries=true&showWorkPeriods=true",
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.getAbsencesForMonth).toHaveBeenCalledWith(4, 2026, {
			organizationId: "org-1",
			employeeId: "employee-1",
		});
		expect(mockState.getTimeEntriesForMonth).toHaveBeenCalledWith(4, 2026, {
			organizationId: "org-1",
			employeeId: "employee-1",
		});
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(4, 2026, {
			organizationId: "org-1",
			employeeId: "employee-1",
		});
	});
});
