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
	findUserSettings: vi.fn(),
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
			userSettings: {
				findFirst: mockState.findUserSettings,
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
			userId: "user-1",
			organizationId: "org-1",
			isActive: true,
			role: "employee",
			teamId: null,
		});
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.findUserSettings.mockResolvedValue({ timezone: "Europe/Berlin" });
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
		expect(mockState.getTimeEntriesForMonth).toHaveBeenCalledWith(
			4,
			2026,
			{
				organizationId: "org-1",
				employeeId: "employee-1",
			},
			"Europe/Berlin",
		);
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			4,
			2026,
			{
				organizationId: "org-1",
				employeeId: "employee-1",
			},
			"Europe/Berlin",
		);
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
			startDate: new Date("2026-04-30T22:00:00.000Z"),
			endDate: new Date("2026-05-31T21:59:59.999Z"),
			timezone: "Europe/Berlin",
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

	it("returns the selected employee calendar timezone", async () => {
		mockState.getVerifiedOrgContext.mockResolvedValueOnce({
			isValid: true,
			user: { id: "manager-user", role: "user" },
			userId: "manager-user",
			organizationId: "org-1",
			employeeId: "manager-1",
			role: "manager",
		});
		mockState.findEmployee
			.mockResolvedValueOnce({
				id: "manager-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
				teamId: null,
				userId: "manager-user",
			})
			.mockResolvedValueOnce({
				id: "employee-2",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
				teamId: null,
				userId: "employee-user-2",
			});
		mockState.findManagerLinks.mockResolvedValueOnce([{ employeeId: "employee-2" }]);
		mockState.findUserSettings.mockResolvedValueOnce({ timezone: "America/New_York" });

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&employeeId=employee-2&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.calendarTimezone).toBe("America/New_York");
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			4,
			2026,
			{
				organizationId: "org-1",
				employeeId: "employee-2",
			},
			"America/New_York",
		);
	});

	it("passes selected timezone into daily requirements and actual minute grouping", async () => {
		mockState.findUserSettings.mockResolvedValueOnce({ timezone: "America/New_York" });
		mockState.getWorkPeriodsForMonth.mockResolvedValueOnce([
			{
				id: "work-period-late-utc",
				type: "work_period",
				date: new Date("2026-06-01T02:00:00.000Z"),
				endDate: new Date("2026-06-01T04:00:00.000Z"),
				title: "Work period",
				color: "#10b981",
				metadata: { durationMinutes: 120, employeeName: "Ada" },
			},
		]);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=false",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			startDate: new Date("2026-05-01T04:00:00.000Z"),
			endDate: new Date("2026-06-01T03:59:59.999Z"),
			timezone: "America/New_York",
		});
		expect(body.dailyActualMinutes).toEqual({
			"2026-05-31": 120,
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
				endDate: new Date("2026-05-04T16:00:00.000Z"),
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

	it("returns running work periods as events but excludes them from daily actual minutes", async () => {
		const completedWorkPeriod = {
			id: "work-period-completed",
			type: "work_period",
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T14:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: { durationMinutes: 360, employeeName: "Ada" },
		};
		const runningWorkPeriod = {
			id: "work-period-running",
			type: "work_period",
			date: new Date("2026-05-04T14:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: { durationMinutes: 120, employeeName: "Ada", isRunning: true },
		};
		mockState.getWorkPeriodsForMonth.mockResolvedValueOnce([
			completedWorkPeriod,
			runningWorkPeriod,
		]);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.events).toEqual([
			{
				...completedWorkPeriod,
				date: "2026-05-04T08:00:00.000Z",
				endDate: "2026-05-04T14:00:00.000Z",
			},
			{
				...runningWorkPeriod,
				date: "2026-05-04T14:00:00.000Z",
			},
		]);
		expect(body.dailyActualMinutes).toEqual({
			"2026-05-04": 360,
		});
	});

	it("deduplicates a Dec31-Jan1 work period in a full-year response without double-counting actuals", async () => {
		mockState.findUserSettings.mockResolvedValueOnce({ timezone: "UTC" });
		const spanningPeriod = {
			id: "work-period-dec31-jan1",
			type: "work_period" as const,
			date: new Date("2026-12-31T23:00:00.000Z"),
			endDate: new Date("2027-01-01T01:00:00.000Z"),
			title: "Year-end work",
			color: "#10b981",
			metadata: { durationMinutes: 120, employeeName: "Ada" },
		};
		mockState.getWorkPeriodsForMonth.mockImplementation(async (month: number) =>
			month === 0 || month === 11 ? [spanningPeriod] : [],
		);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&fullYear=true&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.total).toBe(1);
		expect(body.events).toEqual([
			{
				...spanningPeriod,
				date: "2026-12-31T23:00:00.000Z",
				endDate: "2027-01-01T01:00:00.000Z",
			},
		]);
		expect(body.dailyActualMinutes).toEqual({ "2026-12-31": 60 });
	});

	it("merges cross-month range events and actual minutes using employee-local requirement boundaries", async () => {
		const duplicatePeriod = {
			id: "work-period-duplicate",
			type: "work_period" as const,
			date: new Date("2026-08-31T08:00:00.000Z"),
			endDate: new Date("2026-08-31T08:30:00.000Z"),
			title: "Duplicate period",
			color: "#10b981",
			metadata: { durationMinutes: 30, employeeName: "Ada" },
		};
		const septemberPeriod = {
			id: "work-period-september",
			type: "work_period" as const,
			date: new Date("2026-09-01T08:00:00.000Z"),
			endDate: new Date("2026-09-01T09:00:00.000Z"),
			title: "September period",
			color: "#10b981",
			metadata: { durationMinutes: 60, employeeName: "Ada" },
		};
		mockState.getWorkPeriodsForMonth.mockImplementation(
			async (month: number) => {
				if (month === 7) return [duplicatePeriod];
				if (month === 8) return [duplicatePeriod, septemberPeriod];
				return [];
			},
		);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&rangeStart=2026-08-31&rangeEnd=2026-09-06&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			7,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"Europe/Berlin",
		);
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			8,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"Europe/Berlin",
		);
		expect(body.total).toBe(2);
		expect(body.dailyActualMinutes).toEqual({
			"2026-08-31": 30,
			"2026-09-01": 60,
		});
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			startDate: new Date("2026-08-30T22:00:00.000Z"),
			endDate: new Date("2026-09-06T21:59:59.999Z"),
			timezone: "Europe/Berlin",
		});
	});

	it("loads each month touched by a cross-year range", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&rangeStart=2026-12-28&rangeEnd=2027-01-03&showWorkPeriods=true",
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			11,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"Europe/Berlin",
		);
		expect(mockState.getWorkPeriodsForMonth).toHaveBeenCalledWith(
			0,
			2027,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"Europe/Berlin",
		);
	});

	it.each([
		"rangeStart=2026-08-31",
		"rangeStart=2026-02-30&rangeEnd=2026-03-01",
		"rangeStart=2026-03-01&rangeEnd=2026-02-30",
		"rangeStart=2026-09-06&rangeEnd=2026-08-31",
		"rangeStart=2026-08-31&rangeEnd=2026-09-07",
	])("rejects invalid calendar range: %s", async (range) => {
		const response = await GET(
			createRequest(
				`https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&${range}&showWorkPeriods=true`,
			),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid calendar date range",
		});
	});
});
