import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	getHolidays: vi.fn(),
	getVacationBalance: vi.fn(),
	categoryFindFirst: vi.fn(),
	absenceFindMany: vi.fn(),
	shiftFindMany: vi.fn(),
	coverageRuleFindMany: vi.fn(),
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
			absenceEntry: { findMany: mockState.absenceFindMany },
			shift: { findMany: mockState.shiftFindMany },
			coverageRule: { findMany: mockState.coverageRuleFindMany },
		},
	},
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
			managerId: "manager-1",
		});
		mockState.categoryFindFirst.mockResolvedValue({
			id: "cat-vacation",
			name: "Vacation",
			requiresApproval: true,
			countsAgainstVacation: true,
		});
		mockState.getVacationBalance.mockResolvedValue({
			year: 2026,
			totalDays: 20,
			usedDays: 4,
			pendingDays: 2,
			remainingDays: 14,
		});
		mockState.getHolidays.mockResolvedValue([]);
		mockState.absenceFindMany.mockResolvedValue([]);
		mockState.shiftFindMany.mockResolvedValue([]);
		mockState.coverageRuleFindMany.mockResolvedValue([]);
	});

	it("returns successful preview data for a current employee and active org", async () => {
		const result = await getAbsencePlanPreview(previewRequest);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.requestedDays).toBe(2);
			expect(result.data.balance?.remainingAfterRequest).toBe(12);
			expect(result.data.approvalSignal).toBe("likely");
		}
	});

	it("calls getVacationBalance with the current employee id and request year", async () => {
		await getAbsencePlanPreview(previewRequest);

		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026);
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

		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026);
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
		expect(mockState.shiftFindMany).toHaveBeenCalledWith({ where: expect.anything() });
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
				hasConfiguredRulesForAffectedShifts: true,
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
			expect(result.data.approvalSignal).toBe("risky");
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
				hasConfiguredRulesForAffectedShifts: true,
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
			expect(result.data.approvalSignal).toBe("risky");
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
				hasConfiguredRulesForAffectedShifts: true,
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
			expect(result.data.approvalSignal).toBe("risky");
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
				hasConfiguredRulesForAffectedShifts: true,
				risks: [],
			});
			expect(result.data.approvalSignal).toBe("likely");
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
				hasConfiguredRulesForAffectedShifts: true,
				risks: [],
			});
			expect(result.data.approvalSignal).toBe("likely");
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
				hasConfiguredRulesForAffectedShifts: false,
				risks: [],
			});
			expect(result.data.approvalSignal).toBe("needs_review");
			expect(result.data.reasons).toContain(
				"Coverage rules are not configured for the affected scheduled work.",
			);
		}
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
