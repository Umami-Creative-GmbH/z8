import { DateTime } from "luxon";
import { and, eq, isNull } from "drizzle-orm";

import {
	absenceEntry,
	db,
	employee,
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db";

export type LegacyCanonicalReconciliation = {
	workCountMismatch: number;
	absenceCountMismatch: number;
	durationMismatchRecords: number;
	missingWorkCanonicalRecords: number;
	missingAbsenceCanonicalRecords: number;
	missingWorkDetailRows: number;
	missingAbsenceDetailRows: number;
	missingProjectAllocationRows: number;
	approvalStateMismatchRecords: number;
	missingAbsenceCanonicalLinks: number;
	missingAbsenceOrganizationIds: number;
};

export async function reconcileLegacyToCanonical(
	organizationId: string,
): Promise<LegacyCanonicalReconciliation> {
	const [
		legacyWork,
		legacyAbsence,
		canonicalWork,
		canonicalAbsence,
		linkedAbsenceEntries,
		nullOrgAbsenceEntries,
		targetEmployees,
		canonicalWorkDetails,
		canonicalAbsenceDetails,
		canonicalProjectAllocations,
	] =
		await Promise.all([
			db.query.workPeriod.findMany({
				where: eq(workPeriod.organizationId, organizationId),
				columns: { id: true, projectId: true, durationMinutes: true, approvalStatus: true },
			}),
			db.query.absenceEntry.findMany({
				where: eq(absenceEntry.organizationId, organizationId),
				columns: {
					id: true,
					endDate: true,
					endPeriod: true,
					startDate: true,
					startPeriod: true,
					status: true,
				},
			}),
			db.query.timeRecord.findMany({
				where: and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
				),
				columns: { id: true, durationMinutes: true, approvalState: true },
			}),
			db.query.timeRecord.findMany({
				where: and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "absence"),
				),
				columns: { id: true, durationMinutes: true, approvalState: true },
			}),
			db.query.absenceEntry.findMany({
				where: eq(absenceEntry.organizationId, organizationId),
				columns: { id: true, canonicalRecordId: true },
			}),
			db.query.absenceEntry.findMany({
				where: isNull(absenceEntry.organizationId),
				columns: {
					id: true,
					employeeId: true,
					canonicalRecordId: true,
					organizationId: true,
					endDate: true,
					endPeriod: true,
					startDate: true,
					startPeriod: true,
					status: true,
				},
			}),
			db.query.employee.findMany({
				where: eq(employee.organizationId, organizationId),
				columns: { id: true },
			}),
			db.query.timeRecordWork.findMany({
				where: eq(timeRecordWork.organizationId, organizationId),
				columns: { recordId: true },
			}),
			db.query.timeRecordAbsence.findMany({
				where: eq(timeRecordAbsence.organizationId, organizationId),
				columns: { recordId: true },
			}),
			db.query.timeRecordAllocation.findMany({
				where: and(
					eq(timeRecordAllocation.organizationId, organizationId),
					eq(timeRecordAllocation.allocationKind, "project"),
				),
				columns: { recordId: true, projectId: true },
			}),
		]);

	const legacyWorkIds = new Set(legacyWork.map((row) => row.id));
	const legacyAbsenceIds = new Set(legacyAbsence.map((row) => row.id));
	const canonicalWorkIds = new Set(canonicalWork.map((row) => row.id));
	const canonicalAbsenceIds = new Set(canonicalAbsence.map((row) => row.id));
	const canonicalWorkDetailIds = new Set(canonicalWorkDetails.map((row) => row.recordId));
	const canonicalAbsenceDetailIds = new Set(canonicalAbsenceDetails.map((row) => row.recordId));
	const canonicalWorkById = new Map(canonicalWork.map((row) => [row.id, row]));
	const canonicalAbsenceById = new Map(canonicalAbsence.map((row) => [row.id, row]));
	const legacyWorkById = new Map(legacyWork.map((row) => [row.id, row]));
	const expectedProjectAllocations = new Set(
		legacyWork
			.filter((row) => row.projectId)
			.map((row) => `${row.id}:${row.projectId}`),
	);
	const canonicalProjectAllocationKeys = new Set(
		canonicalProjectAllocations.map((row) => `${row.recordId}:${row.projectId}`),
	);
	const targetEmployeeIds = new Set(targetEmployees.map((row) => row.id));
	const attributedNullOrgAbsenceEntries = nullOrgAbsenceEntries.filter((row) =>
		targetEmployeeIds.has(row.employeeId),
	);
	const effectiveLegacyAbsenceIds = new Set(legacyAbsenceIds);
	const effectiveLegacyAbsenceById = new Map(legacyAbsence.map((row) => [row.id, row]));

	for (const row of attributedNullOrgAbsenceEntries) {
		effectiveLegacyAbsenceIds.add(row.id);
		effectiveLegacyAbsenceById.set(row.id, row);
	}

	return {
		workCountMismatch: Math.abs(legacyWork.length - canonicalWork.length),
		absenceCountMismatch: Math.abs(effectiveLegacyAbsenceIds.size - canonicalAbsence.length),
		durationMismatchRecords:
			countWorkDurationMismatches(legacyWorkById, canonicalWorkById) +
			countAbsenceDurationMismatches(effectiveLegacyAbsenceById, canonicalAbsenceById),
		missingWorkCanonicalRecords: countMissingIds(legacyWorkIds, canonicalWorkIds),
		missingAbsenceCanonicalRecords: countMissingIds(effectiveLegacyAbsenceIds, canonicalAbsenceIds),
		missingWorkDetailRows: countMissingIds(legacyWorkIds, canonicalWorkDetailIds),
		missingAbsenceDetailRows: countMissingIds(effectiveLegacyAbsenceIds, canonicalAbsenceDetailIds),
		missingProjectAllocationRows: countMissingIds(
			expectedProjectAllocations,
			canonicalProjectAllocationKeys,
		),
		missingAbsenceCanonicalLinks:
			linkedAbsenceEntries.filter((row) => !row.canonicalRecordId).length +
			attributedNullOrgAbsenceEntries.filter((row) => !row.canonicalRecordId).length,
		approvalStateMismatchRecords:
			countWorkApprovalStateMismatches(legacyWorkById, canonicalWorkById) +
			countAbsenceApprovalStateMismatches(effectiveLegacyAbsenceById, canonicalAbsenceById),
		missingAbsenceOrganizationIds: attributedNullOrgAbsenceEntries.length,
	};
}

function countMissingIds(legacyIds: Set<string>, canonicalIds: Set<string>) {
	let count = 0;

	for (const legacyId of legacyIds) {
		if (!canonicalIds.has(legacyId)) {
			count += 1;
		}
	}

	return count;
}

function countWorkDurationMismatches(
	legacyWorkById: Map<
		string,
		{ durationMinutes: number | null }
	>,
	canonicalWorkById: Map<string, { durationMinutes: number | null }>,
) {
	let count = 0;

	for (const [id, legacyRecord] of legacyWorkById) {
		const canonicalRecord = canonicalWorkById.get(id);
		if (!canonicalRecord) {
			continue;
		}

		if (legacyRecord.durationMinutes !== canonicalRecord.durationMinutes) {
			count += 1;
		}
	}

	return count;
}

function countAbsenceDurationMismatches(
	legacyAbsenceById: Map<
		string,
		{
			startDate: string;
			startPeriod: "full_day" | "am" | "pm" | "morning" | "afternoon";
			endDate: string;
			endPeriod: "full_day" | "am" | "pm" | "morning" | "afternoon";
		}
	>,
	canonicalAbsenceById: Map<string, { durationMinutes: number | null }>,
) {
	let count = 0;

	for (const [id, legacyRecord] of legacyAbsenceById) {
		const canonicalRecord = canonicalAbsenceById.get(id);
		if (!canonicalRecord) {
			continue;
		}

		if (
			calculateAbsenceDurationMinutes(
				legacyRecord.startDate,
				normalizeLegacyDayPeriod(legacyRecord.startPeriod),
				legacyRecord.endDate,
				normalizeLegacyDayPeriod(legacyRecord.endPeriod),
			) !== canonicalRecord.durationMinutes
		) {
			count += 1;
		}
	}

	return count;
}

function countWorkApprovalStateMismatches(
	legacyWorkById: Map<string, { approvalStatus: "pending" | "approved" | "rejected" }>,
	canonicalWorkById: Map<string, { approvalState: "pending" | "approved" | "rejected" | "draft" }>,
) {
	let count = 0;

	for (const [id, legacyRecord] of legacyWorkById) {
		const canonicalRecord = canonicalWorkById.get(id);
		if (!canonicalRecord) {
			continue;
		}

		if (legacyRecord.approvalStatus !== canonicalRecord.approvalState) {
			count += 1;
		}
	}

	return count;
}

function countAbsenceApprovalStateMismatches(
	legacyAbsenceById: Map<string, { status: "pending" | "approved" | "rejected" }>,
	canonicalAbsenceById: Map<string, { approvalState: "pending" | "approved" | "rejected" | "draft" }>,
) {
	let count = 0;

	for (const [id, legacyRecord] of legacyAbsenceById) {
		const canonicalRecord = canonicalAbsenceById.get(id);
		if (!canonicalRecord) {
			continue;
		}

		if (legacyRecord.status !== canonicalRecord.approvalState) {
			count += 1;
		}
	}

	return count;
}

function calculateAbsenceDurationMinutes(
	startDate: string,
	startPeriod: "full_day" | "am" | "pm",
	endDate: string,
	endPeriod: "full_day" | "am" | "pm",
) {
	const startAt = dateWithPeriod(startDate, startPeriod, "start");
	const endAt = dateWithPeriod(endDate, endPeriod, "end");

	return Math.max(0, Math.round(endAt.diff(startAt, "minutes").minutes));
}

function dateWithPeriod(
	dateIso: string,
	period: "full_day" | "am" | "pm",
	edge: "start" | "end",
) {
	const day = DateTime.fromISO(dateIso, { zone: "utc" });

	if (period === "am") {
		return edge === "start" ? day.startOf("day") : day.startOf("day").plus({ hours: 12 });
	}

	if (period === "pm") {
		return edge === "start"
			? day.startOf("day").plus({ hours: 12 })
			: day.endOf("day").plus({ millisecond: 1 });
	}

	return edge === "start" ? day.startOf("day") : day.endOf("day").plus({ millisecond: 1 });
}

function normalizeLegacyDayPeriod(period: "full_day" | "am" | "pm" | "morning" | "afternoon") {
	if (period === "morning") {
		return "am" as const;
	}

	if (period === "afternoon") {
		return "pm" as const;
	}

	return period;
}
