import { and, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";

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
	] = await Promise.all([
		db.query.workPeriod.findMany({
			where: eq(workPeriod.organizationId, organizationId),
			columns: {
				id: true,
				canonicalRecordId: true,
				projectId: true,
				durationMinutes: true,
				approvalStatus: true,
			},
		}),
		db.query.absenceEntry.findMany({
			where: eq(absenceEntry.organizationId, organizationId),
			columns: {
				id: true,
				canonicalRecordId: true,
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

	const expectedWorkCanonicalIds = new Set(
		legacyWork.map(resolveExpectedCanonicalId),
	);
	const expectedAbsenceCanonicalIds = new Set(
		legacyAbsence.map(resolveExpectedCanonicalId),
	);
	const canonicalWorkIds = new Set(canonicalWork.map((row) => row.id));
	const canonicalAbsenceIds = new Set(canonicalAbsence.map((row) => row.id));
	const canonicalWorkDetailIds = new Set(
		canonicalWorkDetails.map((row) => row.recordId),
	);
	const canonicalAbsenceDetailIds = new Set(
		canonicalAbsenceDetails.map((row) => row.recordId),
	);
	const canonicalWorkById = new Map(canonicalWork.map((row) => [row.id, row]));
	const canonicalAbsenceById = new Map(
		canonicalAbsence.map((row) => [row.id, row]),
	);
	const legacyWorkByCanonicalId = new Map(
		legacyWork.map((row) => [resolveExpectedCanonicalId(row), row]),
	);
	const expectedProjectAllocations = new Set(
		legacyWork
			.filter((row) => row.projectId)
			.map((row) => `${resolveExpectedCanonicalId(row)}:${row.projectId}`),
	);
	const canonicalProjectAllocationKeys = new Set(
		canonicalProjectAllocations.map(
			(row) => `${row.recordId}:${row.projectId}`,
		),
	);
	const targetEmployeeIds = new Set(targetEmployees.map((row) => row.id));
	const attributedNullOrgAbsenceEntries = nullOrgAbsenceEntries.filter((row) =>
		targetEmployeeIds.has(row.employeeId),
	);
	const effectiveExpectedAbsenceCanonicalIds = new Set(
		expectedAbsenceCanonicalIds,
	);
	const effectiveLegacyAbsenceByCanonicalId = new Map(
		legacyAbsence.map((row) => [resolveExpectedCanonicalId(row), row]),
	);

	for (const row of attributedNullOrgAbsenceEntries) {
		const expectedCanonicalId = resolveExpectedCanonicalId(row);
		effectiveExpectedAbsenceCanonicalIds.add(expectedCanonicalId);
		effectiveLegacyAbsenceByCanonicalId.set(expectedCanonicalId, row);
	}

	const missingWorkCanonicalRecords = countMissingIds(
		expectedWorkCanonicalIds,
		canonicalWorkIds,
	);
	const missingAbsenceCanonicalRecords = countMissingIds(
		effectiveExpectedAbsenceCanonicalIds,
		canonicalAbsenceIds,
	);

	return {
		workCountMismatch: missingWorkCanonicalRecords,
		absenceCountMismatch: missingAbsenceCanonicalRecords,
		durationMismatchRecords:
			countWorkDurationMismatches(legacyWorkByCanonicalId, canonicalWorkById) +
			countAbsenceDurationMismatches(
				effectiveLegacyAbsenceByCanonicalId,
				canonicalAbsenceById,
			),
		missingWorkCanonicalRecords,
		missingAbsenceCanonicalRecords,
		missingWorkDetailRows: countMissingIds(
			expectedWorkCanonicalIds,
			canonicalWorkDetailIds,
		),
		missingAbsenceDetailRows: countMissingIds(
			effectiveExpectedAbsenceCanonicalIds,
			canonicalAbsenceDetailIds,
		),
		missingProjectAllocationRows: countMissingIds(
			expectedProjectAllocations,
			canonicalProjectAllocationKeys,
		),
		missingAbsenceCanonicalLinks:
			linkedAbsenceEntries.filter((row) => !row.canonicalRecordId).length +
			attributedNullOrgAbsenceEntries.filter((row) => !row.canonicalRecordId)
				.length,
		approvalStateMismatchRecords:
			countWorkApprovalStateMismatches(
				legacyWorkByCanonicalId,
				canonicalWorkById,
			) +
			countAbsenceApprovalStateMismatches(
				effectiveLegacyAbsenceByCanonicalId,
				canonicalAbsenceById,
			),
		missingAbsenceOrganizationIds: attributedNullOrgAbsenceEntries.length,
	};
}

function resolveExpectedCanonicalId(record: {
	id: string;
	canonicalRecordId: string | null | undefined;
}) {
	return record.canonicalRecordId ?? record.id;
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
	legacyWorkById: Map<string, { durationMinutes: number | null }>,
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
	legacyWorkById: Map<
		string,
		{ approvalStatus: "pending" | "approved" | "rejected" }
	>,
	canonicalWorkById: Map<
		string,
		{ approvalState: "pending" | "approved" | "rejected" | "draft" }
	>,
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
	legacyAbsenceById: Map<
		string,
		{ status: "pending" | "approved" | "rejected" }
	>,
	canonicalAbsenceById: Map<
		string,
		{ approvalState: "pending" | "approved" | "rejected" | "draft" }
	>,
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
		return edge === "start"
			? day.startOf("day")
			: day.startOf("day").plus({ hours: 12 });
	}

	if (period === "pm") {
		return edge === "start"
			? day.startOf("day").plus({ hours: 12 })
			: day.endOf("day").plus({ millisecond: 1 });
	}

	return edge === "start"
		? day.startOf("day")
		: day.endOf("day").plus({ millisecond: 1 });
}

function normalizeLegacyDayPeriod(
	period: "full_day" | "am" | "pm" | "morning" | "afternoon",
) {
	if (period === "morning") {
		return "am" as const;
	}

	if (period === "afternoon") {
		return "pm" as const;
	}

	return period;
}
