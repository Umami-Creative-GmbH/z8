import { describe, expect, it, vi } from "vitest";
import { orchestrateClockinImport, type ClockinImportDependencies } from "@/lib/clockin/import-orchestrator";
import type { ClockinClient } from "@/lib/clockin/client";

function createClientMock(overrides: Partial<ClockinClient> = {}): ClockinClient {
	return {
		searchWorkdays: vi.fn().mockResolvedValue([]),
		searchAbsences: vi.fn().mockResolvedValue([]),
		...overrides,
	} as unknown as ClockinClient;
}

function createDeps(): ClockinImportDependencies {
	return {
		fetchExistingWorkPeriods: vi.fn().mockResolvedValue([]),
		fetchExistingAbsences: vi.fn().mockResolvedValue([]),
		getTimeEntryChainState: vi.fn().mockResolvedValue({ previousHash: null, previousEntryId: null }),
		insertTimeEntry: vi.fn()
			.mockResolvedValueOnce({ id: "te-in-1", hash: "hash-in-1" })
			.mockResolvedValueOnce({ id: "te-out-1", hash: "hash-out-1" }),
		insertWorkPeriod: vi.fn().mockResolvedValue(undefined),
		ensureAbsenceCategory: vi.fn().mockResolvedValue("cat-1"),
		insertAbsence: vi.fn().mockResolvedValue(undefined),
	};
}

describe("orchestrateClockinImport", () => {
	it("reports duplicate workdays as skipped", async () => {
		const client = createClientMock({
			searchWorkdays: vi.fn().mockResolvedValue([
				{
					employee_id: 100,
					date: "2026-03-01",
					starts_at: "2026-03-01T08:00:00Z",
					ends_at: "2026-03-01T16:00:00Z",
					break_seconds: 0,
					work_seconds: 28800,
					target_seconds: 28800,
					activities: [],
					events: [],
				},
			]),
		}) as ClockinClient;
		const deps = createDeps();
		deps.fetchExistingWorkPeriods = vi.fn().mockResolvedValue([
			{
				employeeId: "emp-1",
				startTime: new Date("2026-03-01T08:00:00Z"),
				endTime: new Date("2026-03-01T16:00:00Z"),
			},
		]);

		const result = await orchestrateClockinImport(
			client,
			"org-1",
			"user-1",
			{
				workdays: true,
				absences: false,
				schedules: false,
				dateRange: { startDate: "2026-03-01", endDate: "2026-03-31" },
			},
			[
				{ clockinEmployeeId: 100, employeeId: "emp-1", userId: "user-1", mappingType: "manual" },
			],
			deps,
		);

		expect(result.workdays.skipped).toBe(1);
		expect(result.workdays.imported).toBe(0);
		expect(deps.insertTimeEntry).not.toHaveBeenCalled();
	});

	it("imports absences and workdays when no duplicates exist", async () => {
		const client = createClientMock({
			searchWorkdays: vi.fn().mockResolvedValue([
				{
					employee_id: 100,
					date: "2026-03-01",
					starts_at: "2026-03-01T08:00:00Z",
					ends_at: "2026-03-01T16:00:00Z",
					break_seconds: 0,
					work_seconds: 28800,
					target_seconds: 28800,
					activities: [],
					events: [],
				},
			]),
			searchAbsences: vi.fn().mockResolvedValue([
				{
					id: 500,
					employee_id: 100,
					absencecategory_name: "Vacation",
					approval: "approved",
					duration: 1,
					note: "Imported",
					starts_at: "2026-03-10T00:00:00Z",
					ends_at: "2026-03-12T00:00:00Z",
					created_at: "2026-03-01T00:00:00Z",
					updated_at: "2026-03-01T00:00:00Z",
				},
			]),
		}) as ClockinClient;
		const deps = createDeps();

		const result = await orchestrateClockinImport(
			client,
			"org-1",
			"user-1",
			{
				workdays: true,
				absences: true,
				schedules: false,
				dateRange: { startDate: "2026-03-01", endDate: "2026-03-31" },
			},
			[
				{ clockinEmployeeId: 100, employeeId: "emp-1", userId: "user-1", mappingType: "manual" },
			],
			deps,
		);

		expect(result.workdays.imported).toBe(1);
		expect(result.absences.imported).toBe(1);
		expect(result.status).toBe("success");
		expect(deps.insertTimeEntry).toHaveBeenCalledTimes(2);
		expect(deps.insertWorkPeriod).toHaveBeenCalledTimes(1);
		expect(deps.ensureAbsenceCategory).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Vacation", countsAgainstVacation: true }),
		);
		expect(deps.insertAbsence).toHaveBeenCalledTimes(1);
	});
});
