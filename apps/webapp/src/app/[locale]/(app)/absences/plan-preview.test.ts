import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	getHolidays: vi.fn(),
	loadWorkingDays: vi.fn(),
	loadVacationYearBalances: vi.fn(),
	categoryFindFirst: vi.fn(),
	organizationFindFirst: vi.fn(),
	absenceFindMany: vi.fn(),
	shiftFindMany: vi.fn(),
	coverageRuleFindMany: vi.fn(),
	getPrimaryEligibleManagerIdForRequester: vi.fn(),
	and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ op: "gte", column, value })),
	lte: vi.fn((column: unknown, value: unknown) => ({ op: "lte", column, value })),
	or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
	inArray: vi.fn((column: unknown, values: unknown[]) => ({ op: "inArray", column, values })),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: mockState.and,
	eq: mockState.eq,
	gte: mockState.gte,
	inArray: mockState.inArray,
	lte: mockState.lte,
	or: mockState.or,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceCategory: { findFirst: mockState.categoryFindFirst },
			organization: { findFirst: mockState.organizationFindFirst },
			absenceEntry: { findMany: mockState.absenceFindMany },
			shift: { findMany: mockState.shiftFindMany },
			coverageRule: { findMany: mockState.coverageRuleFindMany },
		},
	},
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: mockState.getPrimaryEligibleManagerIdForRequester,
}));

vi.mock("@/lib/absences/absence-days-resolver", () => ({
	loadWorkingDays: mockState.loadWorkingDays,
}));

vi.mock("@/lib/absences/vacation-year-balance-store", () => ({
	loadVacationYearBalances: mockState.loadVacationYearBalances,
}));

vi.mock("./current-employee", () => ({
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("./queries", () => ({
	getHolidays: mockState.getHolidays,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { getAbsenceComparisonPreview, getAbsencePlanPreview } = await import("./plan-preview");

const previewRequest = {
	categoryId: "cat-vacation",
	startDate: "2026-05-04",
	startPeriod: "full_day" as const,
	endDate: "2026-05-05",
	endPeriod: "full_day" as const,
};

describe("getAbsencePlanPreview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "emp-current",
			organizationId: "org-current",
		});
		mockState.getPrimaryEligibleManagerIdForRequester.mockResolvedValue("manager-1");
		mockState.categoryFindFirst.mockResolvedValue({
			id: "cat-vacation",
			name: "Vacation",
			requiresApproval: true,
			countsAgainstVacation: true,
		});
		mockState.organizationFindFirst.mockResolvedValue({ timezone: "Europe/Berlin" });
		mockState.loadVacationYearBalances.mockImplementation(
			async (_database: unknown, input: { years: number[] }) =>
				input.years.map((year) => ({
					year,
					status: "available",
					balance: {
						year,
						totalDays: 20,
						allowanceDays: 20,
						usedDays: 4,
						pendingDays: 2,
						remainingDays: 14,
						overdrawnDays: 0,
					},
				})),
		);
		mockState.getHolidays.mockResolvedValue([]);
		mockState.loadWorkingDays.mockResolvedValue(
			(day: { dayOfWeek: number }) => day.dayOfWeek <= 5,
		);
		mockState.absenceFindMany.mockResolvedValue([]);
		mockState.shiftFindMany.mockResolvedValue([]);
		mockState.coverageRuleFindMany.mockResolvedValue([]);
	});

	it("returns successful preview data for a current employee and active org", async () => {
		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.requestedAbsenceDays).toBe(2);
			expect(result.data.balances).toEqual([
				expect.objectContaining({ year: 2026, chargedAbsenceDays: 2, remainingAfterRequest: 12 }),
			]);
			expect(result.data.notes).toContain("normal_approval_path");
		}
	});

	it("uses canonical manager eligibility to determine whether the current employee has a manager", async () => {
		const result = await getAbsencePlanPreview(previewRequest);

		expect(mockState.getPrimaryEligibleManagerIdForRequester).toHaveBeenCalledWith(
			expect.objectContaining({
				requesterEmployeeId: "emp-current",
				organizationId: "org-current",
			}),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.notes).toContain("normal_approval_path");
			expect(result.data.notes).not.toContain("no_manager_auto_approval");
		}
	});

	it("counts absence days on the current employee's working days", async () => {
		mockState.loadWorkingDays.mockResolvedValue(
			(day: { dayOfWeek: number }) => day.dayOfWeek <= 4,
		);

		const week = await getAbsencePlanPreview({
			...previewRequest,
			startDate: "2026-10-12",
			endDate: "2026-10-16",
		});
		const friday = await getAbsencePlanPreview({
			...previewRequest,
			startDate: "2026-10-16",
			endDate: "2026-10-16",
		});

		expect(mockState.loadWorkingDays).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-current",
			employeeId: "emp-current",
			startDate: "2026-10-12",
			endDate: "2026-10-16",
		});
		expect(week.success && week.data.requestedAbsenceDays).toBe(4);
		expect(friday.success && friday.data.refusal).toBe("no_working_days");
	});

	it("reads the current employee's balance for the request's year at the evaluation time", async () => {
		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		const evaluatedAt = result.success ? result.data.evaluatedAt : "";
		expect(evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
		expect(mockState.loadVacationYearBalances).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-current",
			employeeId: "emp-current",
			years: [2026],
			timezone: "Europe/Berlin",
			currentDate: new Date(evaluatedAt),
		});
	});

	it("reads every calendar year a request across New Year touches", async () => {
		// Wed 2026-12-30 to Sat 2027-01-02.
		const result = await getAbsencePlanPreview({
			...previewRequest,
			startDate: "2026-12-30",
			endDate: "2027-01-02",
		});

		expect(mockState.loadVacationYearBalances).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ years: [2026, 2027] }),
		);
		expect(result.success && result.data.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 2, remainingAfterRequest: 12 }),
			expect.objectContaining({ year: 2027, chargedAbsenceDays: 1, remainingAfterRequest: 13 }),
		]);
	});

	it("keeps the preview when one year's balance is unavailable", async () => {
		mockState.loadVacationYearBalances.mockResolvedValue([
			{ year: 2026, status: "unavailable", reason: "read_failed" },
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success && result.data.balances).toEqual([
			expect.objectContaining({ year: 2026, status: "unavailable", reason: "read_failed" }),
		]);
	});

	it("reads no vacation balance for a category that does not count against it", async () => {
		mockState.categoryFindFirst.mockResolvedValue({
			id: "cat-sick",
			name: "Sick leave",
			requiresApproval: false,
			countsAgainstVacation: false,
		});

		const result = await getAbsencePlanPreview(previewRequest);

		expect(mockState.loadVacationYearBalances).not.toHaveBeenCalled();
		expect(result.success && result.data.balances).toEqual([]);
	});

	it("returns an error when no active employee exists", async () => {
		mockState.getCurrentEmployee.mockResolvedValue(null);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result).toEqual({ success: false, error: "No active employee found" });
		expect(mockState.categoryFindFirst).not.toHaveBeenCalled();
	});

	it("does not accept employeeId or organizationId input from the client", async () => {
		await getAbsencePlanPreview({
			...previewRequest,
			employeeId: "emp-client",
			organizationId: "org-client",
		} as typeof previewRequest & { employeeId: string; organizationId: string });

		expect(mockState.loadVacationYearBalances).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-current", employeeId: "emp-current" }),
		);
		expect(mockState.getHolidays).toHaveBeenCalledWith(
			"emp-current",
			expect.any(Date),
			expect.any(Date),
		);
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "employee_id" }),
			"emp-current",
		);
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "organization_id" }),
			"org-current",
		);
		expect(mockState.eq).not.toHaveBeenCalledWith(expect.anything(), "emp-client");
		expect(mockState.eq).not.toHaveBeenCalledWith(expect.anything(), "org-client");
	});

	it("uses organization scoped category lookup and employee scoped absence/shift lookup", async () => {
		await getAbsencePlanPreview(previewRequest);

		expect(mockState.categoryFindFirst).toHaveBeenCalledWith({ where: expect.anything() });
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "id" }),
			"cat-vacation",
		);
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "organization_id" }),
			"org-current",
		);
		expect(mockState.eq).toHaveBeenCalledWith(expect.objectContaining({ name: "is_active" }), true);
		expect(mockState.absenceFindMany).toHaveBeenCalledWith({
			where: expect.anything(),
			with: { category: true },
		});
		expect(mockState.shiftFindMany).toHaveBeenCalledWith({
			where: expect.anything(),
			with: { subarea: { columns: { name: true } } },
		});
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "employee_id" }),
			"emp-current",
		);
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "status" }),
			"published",
		);
	});

	it("returns an error before deep queries for invalid date ranges", async () => {
		const result = await getAbsencePlanPreview({ ...previewRequest, endDate: "2026-05-03" });

		expect(result).toEqual({ success: false, error: "Invalid preview date range" });
		expect(mockState.categoryFindFirst).not.toHaveBeenCalled();
		expect(mockState.loadVacationYearBalances).not.toHaveBeenCalled();
	});

	it("adds a coverage risk when the employee absence would drop published staff below minimum", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer",
					employeeId: "emp-peer",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [
					{
						date: "2026-05-04",
						subareaId: "subarea-1",
						subareaName: "Front Desk",
						startTime: "09:00",
						endTime: "17:00",
						minimumStaffCount: 2,
						staffCountAfterAbsence: 1,
					},
				],
			});
		}
	});

	it("adds a coverage risk with clamped times when every affected segment is understaffed", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer-am",
					employeeId: "emp-peer-am",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "14:00",
					status: "published",
				},
				{
					id: "shift-peer-pm",
					employeeId: "emp-peer-pm",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "14:00",
					endTime: "17:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [
					{
						date: "2026-05-04",
						subareaId: "subarea-1",
						subareaName: "Front Desk",
						startTime: "12:00",
						endTime: "17:00",
						minimumStaffCount: 2,
						staffCountAfterAbsence: 1,
					},
				],
			});
		}
	});

	it("reports the actual understaffed segment for partially covered affected shifts", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer-full",
					employeeId: "emp-peer-full",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer-partial",
					employeeId: "emp-peer-partial",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "14:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [
					{
						date: "2026-05-04",
						subareaId: "subarea-1",
						subareaName: "Front Desk",
						startTime: "14:00",
						endTime: "17:00",
						minimumStaffCount: 2,
						staffCountAfterAbsence: 1,
					},
				],
			});
		}
	});

	it("does not add a coverage risk when staffing remains sufficient across the affected shift segment", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer-1",
					employeeId: "emp-peer-1",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
				{
					id: "shift-peer-2",
					employeeId: "emp-peer-2",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "12:00",
					endTime: "17:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [],
			});
		}
	});

	it("does not add a coverage risk for understaffing outside the affected shift segment", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "12:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "12:00",
					status: "published",
				},
				{
					id: "shift-peer-1",
					employeeId: "emp-peer-1",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "12:00",
					status: "published",
				},
				{
					id: "shift-peer-2",
					employeeId: "emp-peer-2",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "12:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [],
			});
		}
	});

	it("marks affected shifts as missing coverage rules when subarea rules do not match day or time", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "tuesday",
				startTime: "18:00",
				endTime: "20:00",
				minimumStaffCount: 1,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.coverage).toEqual({
				status: "incomplete",
				gaps: ["rules_missing"],
				risks: [],
			});
		}
	});

	it("loads shifts from the day before, so an overnight shift into the absence counts", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-night",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					// Sunday 2026-05-03 in Berlin, 22:00-06:00.
					date: new Date("2026-05-02T22:00:00.000Z"),
					startTime: "22:00",
					endTime: "06:00",
					status: "published",
					subarea: { name: "Front Desk" },
				},
			])
			.mockResolvedValueOnce([
				{
					id: "shift-night",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-02T22:00:00.000Z"),
					startTime: "22:00",
					endTime: "06:00",
					status: "published",
				},
			]);
		mockState.coverageRuleFindMany.mockResolvedValue([
			{
				id: "rule-1",
				organizationId: "org-current",
				subareaId: "subarea-1",
				dayOfWeek: "monday",
				startTime: "00:00",
				endTime: "06:00",
				minimumStaffCount: 1,
				subarea: { id: "subarea-1", name: "Front Desk" },
			},
		]);

		const result = await getAbsencePlanPreview(previewRequest);

		expect(mockState.gte).toHaveBeenCalledWith(
			expect.objectContaining({ name: "date" }),
			new Date("2026-05-02T22:00:00.000Z"),
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.affectedShifts).toEqual([
			{
				id: "shift-night",
				subareaId: "subarea-1",
				subareaName: "Front Desk",
				date: "2026-05-03",
				startTime: "22:00",
				endTime: "06:00",
				affectedStartTime: "00:00",
				affectedEndTime: "06:00",
			},
		]);
		expect(result.data.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				{
					date: "2026-05-04",
					subareaId: "subarea-1",
					subareaName: "Front Desk",
					startTime: "00:00",
					endTime: "06:00",
					minimumStaffCount: 1,
					staffCountAfterAbsence: 0,
				},
			],
		});
	});

	it("keeps the rest of the preview when coverage evidence cannot be read", async () => {
		mockState.shiftFindMany
			.mockResolvedValueOnce([
				{
					id: "shift-current",
					employeeId: "emp-current",
					subareaId: "subarea-1",
					date: new Date("2026-05-04T00:00:00.000Z"),
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
					subarea: { name: "Front Desk" },
				},
			])
			.mockRejectedValueOnce(new Error("database unavailable"));

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.requestedAbsenceDays).toBe(2);
		expect(result.data.affectedShifts).toHaveLength(1);
		expect(result.data.coverage).toEqual({
			status: "incomplete",
			gaps: ["read_failed"],
			risks: [],
		});
	});

	it("marks coverage unavailable when the requester's own shifts cannot be read", async () => {
		mockState.shiftFindMany.mockRejectedValueOnce(new Error("database unavailable"));

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.affectedShifts).toEqual([]);
		expect(result.data.coverage).toEqual({
			status: "incomplete",
			gaps: ["read_failed"],
			risks: [],
		});
		expect(mockState.coverageRuleFindMany).not.toHaveBeenCalled();
	});

	it("returns a generic failure when advisory planner dependencies reject", async () => {
		mockState.getHolidays.mockRejectedValue(new Error("database unavailable"));

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result).toEqual({
			success: false,
			error: "Unable to build absence plan preview",
		});
	});

	it("returns a generic failure when current employee lookup rejects", async () => {
		mockState.getCurrentEmployee.mockRejectedValue(new Error("session unavailable"));

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result).toEqual({
			success: false,
			error: "Unable to build absence plan preview",
		});
	});

	it("returns a generic failure when category lookup rejects", async () => {
		mockState.categoryFindFirst.mockRejectedValue(new Error("database unavailable"));

		const result = await getAbsencePlanPreview(previewRequest);

		expect(result).toEqual({
			success: false,
			error: "Unable to build absence plan preview",
		});
	});
});

describe("getAbsenceComparisonPreview (#1342)", () => {
	const vacationCategory = {
		id: "cat-vacation",
		name: "Vacation",
		type: "vacation",
		requiresApproval: true,
		countsAgainstVacation: true,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "emp-current",
			organizationId: "org-current",
		});
		mockState.getPrimaryEligibleManagerIdForRequester.mockResolvedValue("manager-1");
		mockState.categoryFindFirst.mockResolvedValue(vacationCategory);
		mockState.organizationFindFirst.mockResolvedValue({ timezone: "Europe/Berlin" });
		mockState.loadVacationYearBalances.mockImplementation(
			async (_database: unknown, input: { years: number[] }) =>
				input.years.map((year) => ({
					year,
					status: "available",
					balance: {
						year,
						totalDays: 20,
						allowanceDays: 20,
						usedDays: 4,
						pendingDays: 2,
						remainingDays: 14,
						overdrawnDays: 0,
					},
				})),
		);
		mockState.getHolidays.mockResolvedValue([]);
		mockState.loadWorkingDays.mockResolvedValue((day: { dayOfWeek: number }) => day.dayOfWeek <= 5);
		mockState.absenceFindMany.mockResolvedValue([]);
		mockState.shiftFindMany.mockResolvedValue([]);
		mockState.coverageRuleFindMany.mockResolvedValue([]);
	});

	it("evaluates an option exactly like the ordinary preview", async () => {
		const request = { ...previewRequest, startDate: "2026-12-30", endDate: "2027-01-02" };

		const ordinary = await getAbsencePlanPreview(request);
		const comparison = await getAbsenceComparisonPreview(request);

		expect(comparison.success && ordinary.success).toBe(true);
		if (!comparison.success || !ordinary.success) return;
		expect({ ...comparison.data, evaluatedAt: "" }).toEqual({
			...ordinary.data,
			evaluatedAt: "",
		});
		expect(comparison.data.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 2 }),
			expect.objectContaining({ year: 2027, chargedAbsenceDays: 1 }),
		]);
	});

	it.each([
		["sick leave", { type: "sick", countsAgainstVacation: false }],
		["time off in lieu", { type: "time_off_in_lieu", countsAgainstVacation: false }],
		["another type that counts against vacation", { type: "custom", countsAgainstVacation: true }],
		[
			"vacation that does not consume the balance",
			{ type: "vacation", countsAgainstVacation: false },
		],
	])("refuses to compare %s", async (_label, category) => {
		mockState.categoryFindFirst.mockResolvedValue({ ...vacationCategory, ...category });

		const result = await getAbsenceComparisonPreview(previewRequest);

		expect(result).toEqual({
			success: false,
			error: "This absence type cannot be compared",
			code: "comparison_ineligible",
		});
		expect(mockState.loadVacationYearBalances).not.toHaveBeenCalled();
		expect(mockState.shiftFindMany).not.toHaveBeenCalled();
	});

	it("refuses a category outside the current organization or no longer active", async () => {
		mockState.categoryFindFirst.mockResolvedValue(undefined);

		const result = await getAbsenceComparisonPreview(previewRequest);

		// A refusal, not a failed read: the client does not retry it.
		expect(result).toEqual({
			success: false,
			error: "Absence category not found",
			code: "category_unavailable",
		});
		expect(mockState.eq).toHaveBeenCalledWith(
			expect.objectContaining({ name: "organization_id" }),
			"org-current",
		);
		expect(mockState.eq).toHaveBeenCalledWith(expect.objectContaining({ name: "is_active" }), true);
	});

	it("refuses an option the ordinary request rules reject, before reading any evidence", async () => {
		const result = await getAbsenceComparisonPreview({
			...previewRequest,
			durationKind: "partial_day",
			startTime: "13:00",
			endTime: "09:00",
			endDate: "2026-05-04",
		});

		expect(result).toEqual({
			success: false,
			error:
				"Enter an end time after the start time, or choose the next end date for an overnight absence.",
			code: "invalid_option",
		});
		expect(mockState.categoryFindFirst).not.toHaveBeenCalled();
		expect(mockState.loadVacationYearBalances).not.toHaveBeenCalled();
	});

	it("checks the session before validating the option", async () => {
		mockState.getCurrentEmployee.mockResolvedValue(null);

		const result = await getAbsenceComparisonPreview({ ...previewRequest, startDate: "" });

		expect(result).toEqual({ success: false, error: "No active employee found" });
	});

	it("refuses without an active employee in the session", async () => {
		mockState.getCurrentEmployee.mockResolvedValue(null);

		const result = await getAbsenceComparisonPreview(previewRequest);

		expect(result).toEqual({ success: false, error: "No active employee found" });
		expect(mockState.categoryFindFirst).not.toHaveBeenCalled();
	});

	it("derives employee and organization from the session, not the client input", async () => {
		await getAbsenceComparisonPreview({
			...previewRequest,
			employeeId: "emp-client",
			organizationId: "org-client",
		} as typeof previewRequest & { employeeId: string; organizationId: string });

		expect(mockState.loadVacationYearBalances).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-current", employeeId: "emp-current" }),
		);
		expect(mockState.eq).not.toHaveBeenCalledWith(expect.anything(), "emp-client");
		expect(mockState.eq).not.toHaveBeenCalledWith(expect.anything(), "org-client");
	});
});
