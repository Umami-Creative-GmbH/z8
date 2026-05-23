import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	getVerifiedOrgContext: vi.fn(),
	getAbsencesForMonth: vi.fn(async () => []),
	getAssignedHolidaysForEmployee: vi.fn(async () => []),
	assignedHolidayToCalendarEvent: vi.fn(),
	getHolidaysForMonth: vi.fn(async () => []),
	getTimeEntriesForMonth: vi.fn(async () => []),
	getWorkPeriodsForMonth: vi.fn(async () => []),
	getDailyWorkRequirementsForEmployee: vi.fn(async () => ({})),
	getEmployeeWorkBalance: vi.fn(async () => null),
	findEmployee: vi.fn(),
	findManagerLinks: vi.fn(),
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

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
			},
			employeeManagers: {
				findMany: mockState.findManagerLinks,
			},
		},
	},
}));

vi.mock("@/lib/calendar/absence-service", () => ({
	getAbsencesForMonth: mockState.getAbsencesForMonth,
}));

vi.mock("@/lib/calendar/holiday-service", () => ({
	getHolidaysForMonth: mockState.getHolidaysForMonth,
}));

vi.mock("@/lib/calendar/assigned-holidays", () => ({
	getAssignedHolidaysForEmployee: mockState.getAssignedHolidaysForEmployee,
	assignedHolidayToCalendarEvent: mockState.assignedHolidayToCalendarEvent,
}));

vi.mock("@/lib/calendar/time-entry-service", () => ({
	getTimeEntriesForMonth: mockState.getTimeEntriesForMonth,
}));

vi.mock("@/lib/calendar/work-period-service", () => ({
	getWorkPeriodsForMonth: mockState.getWorkPeriodsForMonth,
}));

vi.mock("@/lib/calendar/work-policy-requirements", () => ({
	getDailyWorkRequirementsForEmployee: mockState.getDailyWorkRequirementsForEmployee,
}));

vi.mock("@/lib/work-balance/service", () => ({
	getEmployeeWorkBalance: mockState.getEmployeeWorkBalance,
}));

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		nextUrl: new URL(url),
	} as unknown as NextRequest;
}

function getResponsePayload<T>(body: T | { json: T }): T {
	return "json" in (body as { json?: T }) ? (body as { json: T }).json : (body as T);
}

describe("GET /api/calendar/events", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.connection.mockResolvedValue(undefined);
		mockState.getVerifiedOrgContext.mockResolvedValue({
			isValid: true,
			user: { id: "user-1", role: "user" },
			userId: "user-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			role: "employee",
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			isActive: true,
			role: "employee",
			teamId: null,
		});
		mockState.findManagerLinks.mockResolvedValue([]);
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

	it("returns daily requirements for the scoped employee", async () => {
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValueOnce({
			"2026-05-04": {
				requiredMinutes: 480,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});
		expect(body.dailyRequirements).toEqual({
			"2026-05-04": {
				requiredMinutes: 480,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});
	});

	it("returns empty daily requirements when policy calculation fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mockState.getDailyWorkRequirementsForEmployee.mockRejectedValueOnce(new Error("policy failed"));

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.dailyRequirements).toEqual({});
		consoleError.mockRestore();
	});

	it("returns materialized work balance for the scoped employee", async () => {
		mockState.getEmployeeWorkBalance.mockResolvedValueOnce({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt: new Date("2026-05-22T12:00:00.000Z"),
		});

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getEmployeeWorkBalance).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
		});
		expect(body.workBalance).toMatchObject({
			balanceMinutes: 120,
			actualMinutes: 2520,
			requiredMinutes: 2400,
		});
	});

	it("returns employee-assigned holidays for a scoped employee calendar", async () => {
		const holiday = {
			id: "holiday-1",
			name: "Labor Day",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-01T23:59:59.999Z"),
		};
		const mappedHolidayEvent = {
			id: "holiday-1",
			type: "holiday",
			date: new Date("2026-05-01T00:00:00.000Z"),
			title: "Labor Day",
			color: "#0ea5e9",
			metadata: { source: "assigned" },
		};
		mockState.getAssignedHolidaysForEmployee.mockResolvedValueOnce([holiday]);
		mockState.assignedHolidayToCalendarEvent.mockReturnValueOnce(mappedHolidayEvent);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showHolidays=true&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getAssignedHolidaysForEmployee).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});
		expect(mockState.getHolidaysForMonth).not.toHaveBeenCalled();
		expect(body.events).toContainEqual({
			...mappedHolidayEvent,
			date: "2026-05-01T00:00:00.000Z",
		});
	});

	it("returns organization-wide holidays for a holiday-only calendar request", async () => {
		const orgWideHolidayEvent = {
			id: "holiday-org-1",
			type: "holiday",
			date: new Date("2026-05-01T00:00:00.000Z"),
			title: "May Day",
			color: "#f59e0b",
			metadata: { source: "organization" },
		};
		mockState.getHolidaysForMonth.mockResolvedValueOnce([orgWideHolidayEvent]);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showHolidays=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getHolidaysForMonth).toHaveBeenCalledWith("org-1", 4, 2026);
		expect(mockState.getAssignedHolidaysForEmployee).not.toHaveBeenCalled();
		expect(body.events).toContainEqual({
			...orgWideHolidayEvent,
			date: "2026-05-01T00:00:00.000Z",
		});
	});

	it("rejects employee-scoped calendar data for an unauthorized requested employee", async () => {
		mockState.findEmployee
			.mockResolvedValueOnce({
				id: "employee-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
				teamId: null,
			})
			.mockResolvedValueOnce({
				id: "employee-2",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
				teamId: null,
			});

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&employeeId=employee-2&year=2026&month=4&showAbsences=true",
			),
		);

		expect(response.status).toBe(403);
		expect(mockState.getAbsencesForMonth).not.toHaveBeenCalled();
		expect(mockState.getAssignedHolidaysForEmployee).not.toHaveBeenCalled();
	});

	it("omits hidden work period events but still returns daily actual minutes", async () => {
		mockState.getWorkPeriodsForMonth.mockResolvedValueOnce([
			{
				id: "work-period-1",
				type: "work_period",
				date: new Date("2026-05-04T08:00:00.000Z"),
				title: "Work period",
				color: "#10b981",
				metadata: { durationMinutes: 480, employeeName: "Ada" },
			},
		]);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=false",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.events).toEqual([]);
		expect(body.dailyActualMinutes).toEqual({
			"2026-05-04": 480,
		});
	});
});
