import { describe, expect, it, vi } from "vitest";
import { absenceEntry, approvalRequest, timeRecord, timeRecordAbsence } from "@/db/schema";
import {
	adjustVacationAbsencesForSickness,
	getBlockingOverlapMessage,
	splitVacationAroundSickRange,
} from "./sick-vacation-override";

function createFakeTx(input: {
	absences: Array<{
		id: string;
		employeeId: string;
		organizationId: string;
		categoryId: string;
		startDate: string;
		startPeriod: "full_day" | "am" | "pm";
		endDate: string;
		endPeriod: "full_day" | "am" | "pm";
		status: "pending" | "approved";
		notes: string | null;
		approvedBy: string | null;
		approvedAt: Date | null;
		canonicalRecordId: string | null;
		category: {
			id: string;
			countsAgainstVacation: boolean;
			requiresApproval: boolean;
		};
	}>;
	approval?: {
		id: string;
		organizationId: string;
		entityType: string;
		entityId: string;
		canonicalRecordId: string | null;
		requestedBy: string;
		approverId: string;
		status: "pending" | "approved" | "rejected";
		reason: string | null;
		notes: string | null;
		approvedAt: Date | null;
		rejectionReason: string | null;
	} | null;
}) {
	const calls = {
		updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
		inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
		deletes: [] as Array<{ table: unknown }>,
	};
	const insertIds = ["canonical-new", "absence-new"];

	const tx = {
		query: {
			absenceEntry: {
				findMany: vi.fn().mockResolvedValue(input.absences),
			},
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue(input.approval ?? null),
			},
		},
		update: vi.fn((table: unknown) => ({
			set: vi.fn((set: Record<string, unknown>) => {
				calls.updates.push({ table, set });
				return { where: vi.fn().mockResolvedValue(undefined) };
			}),
		})),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				calls.inserts.push({ table, values });
				return {
					returning: vi.fn().mockImplementation(async () => [{ id: insertIds.shift() ?? "created-id" }]),
				};
			}),
		})),
		delete: vi.fn((table: unknown) => {
			calls.deletes.push({ table });
			return { where: vi.fn().mockResolvedValue(undefined) };
		}),
	};

	return { tx, calls };
}

function vacation(overrides: Partial<Parameters<typeof createFakeTx>[0]["absences"][number]> = {}) {
	return {
		id: "vacation-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		categoryId: "category-1",
		startDate: "2026-05-18",
		startPeriod: "full_day" as const,
		endDate: "2026-05-22",
		endPeriod: "full_day" as const,
		status: "approved" as const,
		notes: "planned vacation",
		approvedBy: "manager-1",
		approvedAt: new Date("2026-05-01T10:00:00.000Z"),
		canonicalRecordId: "canonical-1",
		category: {
			id: "category-1",
			countsAgainstVacation: true,
			requiresApproval: true,
		},
		...overrides,
	};
}

describe("splitVacationAroundSickRange", () => {
	it("shortens vacation when sickness overlaps the start", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-18",
				sickEndDate: "2026-05-19",
			}),
		).toEqual([{ startDate: "2026-05-20", endDate: "2026-05-22" }]);
	});

	it("shortens vacation when sickness overlaps the end", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-21",
				sickEndDate: "2026-05-22",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-20" }]);
	});

	it("splits vacation when sickness is inside the vacation", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-20",
				sickEndDate: "2026-05-20",
			}),
		).toEqual([
			{ startDate: "2026-05-18", endDate: "2026-05-19" },
			{ startDate: "2026-05-21", endDate: "2026-05-22" },
		]);
	});

	it("returns no vacation segment when sickness fully covers vacation", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-18",
				sickEndDate: "2026-05-22",
			}),
		).toEqual([]);
	});

	it("preserves vacation when sickness starts after vacation ends", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-25",
				sickEndDate: "2026-05-26",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-22" }]);
	});

	it("preserves vacation when sickness ends before vacation starts", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-14",
				sickEndDate: "2026-05-15",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-22" }]);
	});
});

describe("getBlockingOverlapMessage", () => {
	it("allows full-day sick overlap with vacation-like absences", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "full_day",
				newEndPeriod: "full_day",
				existingStartPeriod: "full_day",
				existingEndPeriod: "full_day",
				existingStatus: "approved",
				existingCountsAgainstVacation: true,
			}),
		).toBeNull();
	});

	it("blocks full-day sick overlap with half-day vacation", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "full_day",
				newEndPeriod: "full_day",
				existingStartPeriod: "am",
				existingEndPeriod: "am",
				existingStatus: "approved",
				existingCountsAgainstVacation: true,
			}),
		).toBe("Absence request overlaps with an existing approved absence");
	});

	it("blocks half-day sick overlap with vacation", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "am",
				newEndPeriod: "am",
				existingStartPeriod: "full_day",
				existingEndPeriod: "full_day",
				existingStatus: "approved",
				existingCountsAgainstVacation: true,
			}),
		).toBe("Absence request overlaps with an existing approved absence");
	});

	it("blocks sick overlap with non-vacation absences", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "full_day",
				newEndPeriod: "full_day",
				existingStartPeriod: "full_day",
				existingEndPeriod: "full_day",
				existingStatus: "pending",
				existingCountsAgainstVacation: false,
			}),
		).toBe("Absence request overlaps with an existing pending request");
	});
});

describe("adjustVacationAbsencesForSickness", () => {
	it("shortens vacation and updates the linked canonical absence record", async () => {
		const { tx, calls } = createFakeTx({ absences: [vacation()] });

		await adjustVacationAbsencesForSickness({
			tx,
			organizationId: "org-1",
			employeeId: "employee-1",
			sickStartDate: "2026-05-18",
			sickEndDate: "2026-05-19",
			updatedBy: "user-1",
		});

		expect(calls.updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: absenceEntry,
					set: expect.objectContaining({
						startDate: "2026-05-20",
						endDate: "2026-05-22",
					}),
				}),
				expect.objectContaining({
					table: timeRecord,
					set: expect.objectContaining({
						startAt: new Date("2026-05-20T00:00:00.000Z"),
						endAt: new Date("2026-05-22T23:59:59.999Z"),
						updatedBy: "user-1",
					}),
				}),
				expect.objectContaining({
					table: timeRecordAbsence,
					set: { startPeriod: "full_day", endPeriod: "full_day" },
				}),
			]),
		);
	});

	it("does not adjust half-day vacation overlaps", async () => {
		const { tx, calls } = createFakeTx({
			absences: [vacation({ startPeriod: "am", endPeriod: "am" })],
		});

		const summary = await adjustVacationAbsencesForSickness({
			tx,
			organizationId: "org-1",
			employeeId: "employee-1",
			sickStartDate: "2026-05-18",
			sickEndDate: "2026-05-19",
			updatedBy: "user-1",
		});

		expect(summary).toEqual({
			updatedAbsenceIds: [],
			createdAbsenceIds: [],
			deletedAbsenceIds: [],
		});
		expect(calls.updates).toEqual([]);
		expect(calls.inserts).toEqual([]);
		expect(calls.deletes).toEqual([]);
	});

	it("rejects fully covered vacation without removing the row needed for calendar deletion", async () => {
		const { tx, calls } = createFakeTx({ absences: [vacation()] });

		const summary = await adjustVacationAbsencesForSickness({
			tx,
			organizationId: "org-1",
			employeeId: "employee-1",
			sickStartDate: "2026-05-18",
			sickEndDate: "2026-05-22",
			updatedBy: "user-1",
		});

		expect(summary.deletedAbsenceIds).toEqual(["vacation-1"]);
		expect(calls.deletes.map((call) => call.table)).toEqual([approvalRequest]);
		expect(calls.updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: absenceEntry,
					set: expect.objectContaining({
						status: "rejected",
						rejectionReason: "Overridden by sick absence",
					}),
				}),
				expect.objectContaining({
					table: timeRecord,
					set: expect.objectContaining({ approvalState: "rejected", updatedBy: "user-1" }),
				}),
				expect.objectContaining({
					table: timeRecordAbsence,
					set: expect.objectContaining({ countsAgainstVacation: false }),
				}),
			]),
		);
	});

	it("splits vacation with a canonical record for the second segment", async () => {
		const { tx, calls } = createFakeTx({ absences: [vacation()] });

		const summary = await adjustVacationAbsencesForSickness({
			tx,
			organizationId: "org-1",
			employeeId: "employee-1",
			sickStartDate: "2026-05-20",
			sickEndDate: "2026-05-20",
			updatedBy: "user-1",
		});

		expect(summary.createdAbsenceIds).toEqual(["absence-new"]);
		expect(calls.inserts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ table: timeRecord }),
				expect.objectContaining({
					table: timeRecord,
					values: expect.objectContaining({ approvalState: "approved" }),
				}),
				expect.objectContaining({
					table: timeRecordAbsence,
					values: expect.objectContaining({ recordId: "canonical-new" }),
				}),
				expect.objectContaining({
					table: absenceEntry,
					values: expect.objectContaining({
						startDate: "2026-05-21",
						endDate: "2026-05-22",
						canonicalRecordId: "canonical-new",
					}),
				}),
			]),
		);
	});

	it("duplicates pending approval request when splitting pending vacation", async () => {
		const { tx, calls } = createFakeTx({
			absences: [vacation({ status: "pending", approvedBy: null, approvedAt: null })],
			approval: {
				id: "approval-1",
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "vacation-1",
				canonicalRecordId: "canonical-1",
				requestedBy: "employee-1",
				approverId: "manager-1",
				status: "pending",
				reason: "vacation approval",
				notes: "please approve",
				approvedAt: null,
				rejectionReason: null,
			},
		});

		await adjustVacationAbsencesForSickness({
			tx,
			organizationId: "org-1",
			employeeId: "employee-1",
			sickStartDate: "2026-05-20",
			sickEndDate: "2026-05-20",
			updatedBy: "user-1",
		});

		expect(tx.query.approvalRequest.findFirst).toHaveBeenCalledTimes(1);
		expect(calls.inserts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: approvalRequest,
					values: {
						organizationId: "org-1",
						entityType: "absence_entry",
						entityId: "absence-new",
						canonicalRecordId: "canonical-new",
						requestedBy: "employee-1",
						approverId: "manager-1",
						status: "pending",
						reason: "vacation approval",
						notes: "please approve",
						approvedAt: null,
						rejectionReason: null,
					},
				}),
			]),
		);
	});
});
