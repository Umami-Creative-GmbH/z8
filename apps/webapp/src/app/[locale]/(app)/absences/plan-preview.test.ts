import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	getHolidays: vi.fn(),
	loadWorkingDays: vi.fn(),
	getVacationBalance: vi.fn(),
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

vi.mock("./current-employee", () => ({
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("./queries", () => ({
	getHolidays: mockState.getHolidays,
	getVacationBalance: mockState.getVacationBalance,
}));

const { getAbsencePlanPreview } = await import("./plan-preview");

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
		mockState.getVacationBalance.mockResolvedValue({
			year: 2026,
			totalDays: 20,
			usedDays: 4,
			pendingDays: 2,
			remainingDays: 14,
		});
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
			expect(result.data.balance?.remainingAfterRequest).toBe(12);
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
			expect(result.data.reasons).toContain("Request follows the normal approval path.");
			expect(result.data.reasons).not.toContain(
				"No manager is assigned, so this request follows the current auto-approval behavior.",
			);
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

	it("calls getVacationBalance with the current employee id and calendar year", async () => {
		await getAbsencePlanPreview(previewRequest);

		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026, "Europe/Berlin");
	});

	it("uses the request start date calendar year for vacation balance", async () => {
		await getAbsencePlanPreview({
			...previewRequest,
			startDate: "2026-03-04",
			endDate: "2026-03-05",
		});

		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026, "Europe/Berlin");
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

		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026, "Europe/Berlin");
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
		expect(mockState.getVacationBalance).not.toHaveBeenCalled();
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
		mockState.getVacationBalance.mockRejectedValue(new Error("database unavailable"));

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
