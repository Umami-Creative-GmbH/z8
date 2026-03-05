import { describe, expect, it } from "vitest";
import { buildCanonicalBackfillPayload } from "@/lib/time-record/migration/backfill";

describe("canonical backfill period normalization", () => {
	it("normalizes legacy morning/afternoon periods to am/pm", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "morning",
						endDate: "2026-01-15",
						endPeriod: "morning",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordAbsence).toEqual([
			{
				recordId: "absence-1",
				organizationId: "org-1",
				recordKind: "absence",
				absenceCategoryId: "category-1",
				startPeriod: "am",
				endPeriod: "am",
				countsAgainstVacation: true,
			},
		]);

		expect(payload.timeRecords[0]?.durationMinutes).toBe(720);
	});

	it("keeps canonical am/pm periods and preserves half-day duration", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-2",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "pm",
						endDate: "2026-01-15",
						endPeriod: "pm",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordAbsence[0]?.startPeriod).toBe("pm");
		expect(payload.timeRecordAbsence[0]?.endPeriod).toBe("pm");
		expect(payload.timeRecords[0]?.durationMinutes).toBe(720);
	});

	it("maps legacy project assignment to canonical work allocation", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [
					{
						id: "work-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						startTime: new Date("2026-01-15T08:00:00.000Z"),
						endTime: new Date("2026-01-15T16:00:00.000Z"),
						durationMinutes: 480,
						approvalStatus: "approved",
						projectId: "project-1",
						workCategoryId: null,
						workLocationType: "office",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				absenceEntries: [],
				approvalRequests: [],
				absenceCategories: [],
			},
		});

		expect(payload.timeRecordAllocation).toEqual([
			{
				organizationId: "org-1",
				recordId: "work-1",
				allocationKind: "project",
				projectId: "project-1",
				weightPercent: 100,
			},
		]);
	});
});
