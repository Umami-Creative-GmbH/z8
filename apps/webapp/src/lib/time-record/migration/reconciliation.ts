import { and, asc, eq, isNull } from "drizzle-orm";
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
import { diagnoseRecordAgreement } from "@/lib/time-tracking/work-records/record-agreement-diagnosis";
import { planAttachment } from "@/lib/time-tracking/work-records/repair-plan";
import type { CanonicalAllocationShape } from "@/lib/time-tracking/work-records/work-attribution";

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
	/**
	 * Completed work whose canonical work record disagrees with it under the
	 * record agreement rule (#1217): interval, duration, approval state or work
	 * attribution, or whose attribution cannot be represented. Reported only:
	 * it does not block until production shows no divergence (#1228).
	 */
	divergentWorkRecords: number;
	/**
	 * Completed work without a canonical work record that work records' attach
	 * refuses as it stands (spec-2 M1): no minutes, an end without its clock-out,
	 * or work that cannot be represented. Only work diagnostics can repair it (an
	 * attach with a resolution), so it is reported without blocking and left out
	 * of the blocking counts.
	 */
	unattachableWorkRecords: number;
	/** The sum of the blocking counts (`BLOCKING_RECONCILIATION_KEYS`). */
	blockingMismatchCount: number;
};

/**
 * The counts that hold the payroll gate and the approval cutover back: the
 * mismatches blocked before #1217. Full record agreement (`divergentWorkRecords`)
 * is reported without blocking until the user confirms production shows none
 * (#1228); enforcing it means adding `divergentWorkRecords` here.
 */
export const BLOCKING_RECONCILIATION_KEYS = [
	"workCountMismatch",
	"absenceCountMismatch",
	"durationMismatchRecords",
	"missingWorkCanonicalRecords",
	"missingAbsenceCanonicalRecords",
	"missingWorkDetailRows",
	"missingAbsenceDetailRows",
	"missingProjectAllocationRows",
	"approvalStateMismatchRecords",
	"missingAbsenceCanonicalLinks",
	"missingAbsenceOrganizationIds",
] as const satisfies readonly Exclude<
	keyof LegacyCanonicalReconciliation,
	"blockingMismatchCount"
>[];

const vehicleColumns = {
	vehicleKind: true,
	vehicleId: true,
	odometerStartKm: true,
	odometerEndKm: true,
	drivenDistanceKm: true,
} as const;

export async function reconcileLegacyToCanonical(
	organizationId: string,
): Promise<LegacyCanonicalReconciliation> {
	const [
		allLegacyWork,
		legacyAbsence,
		canonicalWork,
		canonicalAbsence,
		linkedAbsenceEntries,
		nullOrgAbsenceEntries,
		targetEmployees,
		canonicalWorkDetails,
		canonicalAbsenceDetails,
		canonicalWorkAllocations,
	] = await Promise.all([
		db.query.workPeriod.findMany({
			where: eq(workPeriod.organizationId, organizationId),
			columns: {
				id: true,
				canonicalRecordId: true,
				clockOutId: true,
				isActive: true,
				deletedAt: true,
				startTime: true,
				endTime: true,
				durationMinutes: true,
				approvalStatus: true,
				projectId: true,
				taskId: true,
				isBillable: true,
				missingTask: true,
				workCategoryId: true,
				workLocationType: true,
				...vehicleColumns,
			},
			// The closed month an unlinked period's work touches, if any (#1213).
			extras: (period, { sql }) => ({
				unlinkedClosedMonth: sql<
					string | null
				>`case when ${period.canonicalRecordId} is null then public.closed_month_touching_work(${period.employeeId}, ${period.startTime}, ${period.endTime}) end`.as(
					"unlinked_closed_month",
				),
			}),
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
			where: and(eq(timeRecord.organizationId, organizationId), eq(timeRecord.recordKind, "work")),
			columns: {
				id: true,
				startAt: true,
				endAt: true,
				durationMinutes: true,
				approvalState: true,
			},
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
			columns: {
				recordId: true,
				workCategoryId: true,
				workLocationType: true,
				...vehicleColumns,
			},
		}),
		db.query.timeRecordAbsence.findMany({
			where: eq(timeRecordAbsence.organizationId, organizationId),
			columns: { recordId: true },
		}),
		db.query.timeRecordAllocation.findMany({
			where: eq(timeRecordAllocation.organizationId, organizationId),
			columns: {
				recordId: true,
				allocationKind: true,
				projectId: true,
				taskId: true,
				costCenterId: true,
				weightPercent: true,
				isBillable: true,
				missingTask: true,
			},
			// A stable order: the record agreement rule reads the first project allocation.
			orderBy: [asc(timeRecordAllocation.createdAt), asc(timeRecordAllocation.id)],
		}),
	]);

	const canonicalWorkIds = new Set(canonicalWork.map((row) => row.id));
	// Live work receives its completed canonical representation at clock-out. A completed
	// period without a canonical work record in a closed month is a half pair the database
	// keeps from changing (Time Tracking ADR-0004), so it can't diverge and doesn't count
	// against readiness; reopening the month lets the backfill attach it (#1213).
	const halfPairs = allLegacyWork.filter(
		(row) =>
			!(row.isActive && row.endTime === null) &&
			!(row.unlinkedClosedMonth && !canonicalWorkIds.has(row.id)),
	);
	// Work the backfill's attach refuses waits for a repair in work diagnostics (spec-2 M1).
	const unattachable = new Set(
		halfPairs
			.filter(
				(row) =>
					row.canonicalRecordId === null &&
					row.deletedAt === null &&
					!canonicalWorkIds.has(row.id) &&
					(row.clockOutId === null || "kind" in planAttachment(row)),
			)
			.map((row) => row.id),
	);
	const legacyWork = halfPairs.filter((row) => !unattachable.has(row.id));
	const expectedWorkCanonicalIds = new Set(legacyWork.map(resolveExpectedCanonicalId));
	const expectedAbsenceCanonicalIds = new Set(legacyAbsence.map(resolveExpectedCanonicalId));
	const canonicalAbsenceIds = new Set(canonicalAbsence.map((row) => row.id));
	const canonicalWorkDetailById = new Map(
		canonicalWorkDetails.map(({ recordId, ...detail }) => [recordId, detail]),
	);
	const canonicalAbsenceDetailIds = new Set(canonicalAbsenceDetails.map((row) => row.recordId));
	const canonicalWorkById = new Map(canonicalWork.map((row) => [row.id, row]));
	const canonicalAbsenceById = new Map(canonicalAbsence.map((row) => [row.id, row]));
	const allocationsByRecord = new Map<string, CanonicalAllocationShape[]>();
	for (const { recordId, ...allocation } of canonicalWorkAllocations) {
		const recordAllocations = allocationsByRecord.get(recordId);
		if (recordAllocations) recordAllocations.push(allocation);
		else allocationsByRecord.set(recordId, [allocation]);
	}
	const targetEmployeeIds = new Set(targetEmployees.map((row) => row.id));
	const attributedNullOrgAbsenceEntries = nullOrgAbsenceEntries.filter((row) =>
		targetEmployeeIds.has(row.employeeId),
	);
	const effectiveExpectedAbsenceCanonicalIds = new Set(expectedAbsenceCanonicalIds);
	const effectiveLegacyAbsenceByCanonicalId = new Map(
		legacyAbsence.map((row) => [resolveExpectedCanonicalId(row), row]),
	);

	for (const row of attributedNullOrgAbsenceEntries) {
		const expectedCanonicalId = resolveExpectedCanonicalId(row);
		effectiveExpectedAbsenceCanonicalIds.add(expectedCanonicalId);
		effectiveLegacyAbsenceByCanonicalId.set(expectedCanonicalId, row);
	}

	// Each pair is also judged by the record agreement rule every writer and work
	// diagnostics use (#1217), reported without blocking. Deleted work is no longer
	// work: diagnostics reports only a payable representation of it.
	const legacyWorkByCanonicalId = new Map(
		legacyWork.map((row) => [resolveExpectedCanonicalId(row), row]),
	);
	let divergentWorkRecords = 0;
	for (const [id, period] of legacyWorkByCanonicalId) {
		const record = canonicalWorkById.get(id);
		if (!record || period.deletedAt !== null) continue;
		const diagnosis = diagnoseRecordAgreement(period, {
			record,
			detail: canonicalWorkDetailById.get(id) ?? null,
			allocations: allocationsByRecord.get(id) ?? [],
		});
		if (!diagnosis.agrees) divergentWorkRecords += 1;
	}

	const missingWorkCanonicalRecords = countMissingIds(expectedWorkCanonicalIds, canonicalWorkIds);
	const missingAbsenceCanonicalRecords = countMissingIds(
		effectiveExpectedAbsenceCanonicalIds,
		canonicalAbsenceIds,
	);
	// A project allocation matches only with the period's billability (#900).
	const expectedProjectAllocations = new Set(
		legacyWork
			.filter((row) => row.projectId)
			.map(
				(row) => `${resolveExpectedCanonicalId(row)}:${row.projectId}:${row.isBillable ?? false}`,
			),
	);
	const canonicalProjectAllocationKeys = new Set(
		canonicalWorkAllocations
			.filter((row) => row.allocationKind === "project")
			.map((row) => `${row.recordId}:${row.projectId}:${row.isBillable ?? false}`),
	);

	const counts: Omit<LegacyCanonicalReconciliation, "blockingMismatchCount"> = {
		workCountMismatch: missingWorkCanonicalRecords,
		absenceCountMismatch: missingAbsenceCanonicalRecords,
		durationMismatchRecords:
			countDurationMismatches(legacyWorkByCanonicalId, canonicalWorkById) +
			countAbsenceDurationMismatches(effectiveLegacyAbsenceByCanonicalId, canonicalAbsenceById),
		missingWorkCanonicalRecords,
		missingAbsenceCanonicalRecords,
		missingWorkDetailRows: countMissingIds(
			expectedWorkCanonicalIds,
			new Set(canonicalWorkDetailById.keys()),
		),
		missingAbsenceDetailRows: countMissingIds(
			effectiveExpectedAbsenceCanonicalIds,
			canonicalAbsenceDetailIds,
		),
		missingProjectAllocationRows: countMissingIds(
			expectedProjectAllocations,
			canonicalProjectAllocationKeys,
		),
		approvalStateMismatchRecords:
			countWorkApprovalStateMismatches(legacyWorkByCanonicalId, canonicalWorkById) +
			countAbsenceApprovalStateMismatches(
				effectiveLegacyAbsenceByCanonicalId,
				canonicalAbsenceById,
			),
		missingAbsenceCanonicalLinks:
			linkedAbsenceEntries.filter((row) => !row.canonicalRecordId).length +
			attributedNullOrgAbsenceEntries.filter((row) => !row.canonicalRecordId).length,
		missingAbsenceOrganizationIds: attributedNullOrgAbsenceEntries.length,
		divergentWorkRecords,
		unattachableWorkRecords: unattachable.size,
	};
	return {
		...counts,
		blockingMismatchCount: BLOCKING_RECONCILIATION_KEYS.reduce((sum, key) => sum + counts[key], 0),
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

function countDurationMismatches(
	legacyWorkById: Map<string, { durationMinutes: number | null }>,
	canonicalWorkById: Map<string, { durationMinutes: number | null }>,
) {
	let count = 0;
	for (const [id, legacyRecord] of legacyWorkById) {
		const canonicalRecord = canonicalWorkById.get(id);
		if (canonicalRecord && legacyRecord.durationMinutes !== canonicalRecord.durationMinutes) {
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
		if (canonicalRecord && legacyRecord.approvalStatus !== canonicalRecord.approvalState) {
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

function countAbsenceApprovalStateMismatches(
	legacyAbsenceById: Map<string, { status: "pending" | "approved" | "rejected" }>,
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

function dateWithPeriod(dateIso: string, period: "full_day" | "am" | "pm", edge: "start" | "end") {
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
