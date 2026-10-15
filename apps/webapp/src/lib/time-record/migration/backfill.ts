import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	db,
	employee,
	timeRecord,
	timeRecordAbsence,
	timeRecordApprovalDecision,
} from "@/db";
import { legacyApprovalDecision } from "@/lib/time-record/legacy-approval-decision";
import {
	attachMissingWorkRecords,
	type MissingWorkRecordAttachment,
} from "./attach-missing-work-records";

type LegacyApprovalStatus = "pending" | "approved" | "rejected";
type CanonicalDayPeriod = "full_day" | "am" | "pm";
type LegacyDayPeriod = CanonicalDayPeriod | "morning" | "afternoon";
type LegacyEntityType = "time_entry" | "absence_entry";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LegacyAbsenceEntry = {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: LegacyDayPeriod;
	endDate: string;
	endPeriod: LegacyDayPeriod;
	status: LegacyApprovalStatus;
	createdAt: Date;
	updatedAt: Date;
};

export type LegacyApprovalRequest = {
	id: string;
	organizationId: string;
	entityType: LegacyEntityType;
	entityId: string;
	requestedBy: string;
	approverId: string;
	status: LegacyApprovalStatus;
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Date | null;
	createdAt: Date;
};

export type BackfillAbsenceCategory = {
	id: string;
	countsAgainstVacation: boolean;
};

export type CanonicalBackfillInput = {
	organizationId: string;
	actorId: string;
	legacy: {
		absenceEntries: LegacyAbsenceEntry[];
		approvalRequests: LegacyApprovalRequest[];
		absenceCategories: BackfillAbsenceCategory[];
	};
};

export type CanonicalBackfillRunInput = {
	organizationId: string;
	/** The user the absences' canonical records are created by. */
	actorId: string;
	legacy?: CanonicalBackfillInput["legacy"];
};

/** The canonical absence records the backfill writes. */
export type CanonicalBackfillPayload = {
	timeRecords: Array<{
		id: string;
		organizationId: string;
		employeeId: string;
		recordKind: "absence";
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: "pending" | "approved" | "rejected";
		origin: "system";
		createdAt: Date;
		createdBy: string;
		updatedAt: Date;
		updatedBy: string;
	}>;
	timeRecordAbsence: Array<{
		recordId: string;
		organizationId: string;
		recordKind: "absence";
		absenceCategoryId: string;
		startPeriod: CanonicalDayPeriod;
		endPeriod: CanonicalDayPeriod;
		countsAgainstVacation: boolean;
	}>;
	timeRecordApprovalDecision: Array<{
		organizationId: string;
		recordId: string;
		actorEmployeeId: string;
		action: "submitted" | "approved" | "rejected";
		reason: string | null;
		createdAt: Date;
	}>;
	legacyLinks: {
		absenceEntry: Array<{
			id: string;
			canonicalRecordId: string;
			organizationId: string;
		}>;
		approvalRequest: Array<{ id: string; canonicalRecordId: string }>;
	};
};

/**
 * The canonical absence records of the organization's legacy absences. Work is
 * not built here: completed work gets its canonical work record from work
 * records' attach (#1224).
 */
export function buildCanonicalBackfillPayload(
	input: CanonicalBackfillInput,
): CanonicalBackfillPayload {
	const categoryVacationFlagById = new Map(
		input.legacy.absenceCategories.map((category) => [category.id, category.countsAgainstVacation]),
	);

	const absences = input.legacy.absenceEntries.filter(
		(absenceEntry) => absenceEntry.organizationId === input.organizationId,
	);
	const approvals = input.legacy.approvalRequests.filter(
		(approvalRequest) =>
			approvalRequest.organizationId === input.organizationId &&
			approvalRequest.entityType === "absence_entry",
	);

	const timeRecords: CanonicalBackfillPayload["timeRecords"] = [];
	const timeRecordAbsence: CanonicalBackfillPayload["timeRecordAbsence"] = [];
	const timeRecordApprovalDecision: CanonicalBackfillPayload["timeRecordApprovalDecision"] = [];
	const absenceRecordMap = new Map<string, string>();

	for (const absenceEntry of absences) {
		const startPeriod = normalizeLegacyDayPeriod(absenceEntry.startPeriod);
		const endPeriod = normalizeLegacyDayPeriod(absenceEntry.endPeriod);

		const interval = mapAbsenceToInterval(
			absenceEntry.startDate,
			startPeriod,
			absenceEntry.endDate,
			endPeriod,
		);

		timeRecords.push({
			id: absenceEntry.id,
			organizationId: input.organizationId,
			employeeId: absenceEntry.employeeId,
			recordKind: "absence",
			startAt: interval.startAt,
			endAt: interval.endAt,
			durationMinutes: interval.durationMinutes,
			approvalState: absenceEntry.status,
			origin: "system",
			createdAt: absenceEntry.createdAt,
			createdBy: input.actorId,
			updatedAt: absenceEntry.updatedAt,
			updatedBy: input.actorId,
		});

		timeRecordAbsence.push({
			recordId: absenceEntry.id,
			organizationId: input.organizationId,
			recordKind: "absence",
			absenceCategoryId: absenceEntry.categoryId,
			startPeriod,
			endPeriod,
			countsAgainstVacation: categoryVacationFlagById.get(absenceEntry.categoryId) ?? true,
		});

		absenceRecordMap.set(absenceEntry.id, absenceEntry.id);
	}

	const approvalLinks: CanonicalBackfillPayload["legacyLinks"]["approvalRequest"] = [];
	for (const approvalRequest of approvals) {
		const recordId = absenceRecordMap.get(approvalRequest.entityId);
		if (!recordId) {
			continue;
		}

		timeRecordApprovalDecision.push({
			organizationId: input.organizationId,
			recordId,
			...legacyApprovalDecision(approvalRequest),
		});
		approvalLinks.push({ id: approvalRequest.id, canonicalRecordId: recordId });
	}

	return {
		timeRecords,
		timeRecordAbsence,
		timeRecordApprovalDecision,
		legacyLinks: {
			absenceEntry: absences.map((absenceEntry) => ({
				id: absenceEntry.id,
				canonicalRecordId: absenceEntry.id,
				organizationId: input.organizationId,
			})),
			approvalRequest: approvalLinks,
		},
	};
}

export type CanonicalBackfillResult = CanonicalBackfillPayload & {
	/**
	 * Completed work attached through work records one period at a time (#1224). Work
	 * touching a closed month is skipped and stays a half pair (#1213, Time Tracking
	 * ADR-0004) until the month reopens.
	 */
	work: MissingWorkRecordAttachment;
};

/**
 * The lazy canonical backfill behind the payroll export and the payroll workspace:
 * completed work without a canonical work record gets one through work records'
 * attach, a period at a time, skipping closed months; legacy absences get theirs in
 * one transaction.
 */
export async function runCanonicalBackfill(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillResult> {
	// A system process: the records are created by each work's original actor.
	const work = await attachMissingWorkRecords({
		organizationId: input.organizationId,
		actorUserId: null,
	});

	const resolvedInput = input.legacy
		? { organizationId: input.organizationId, actorId: input.actorId, legacy: input.legacy }
		: await loadCanonicalBackfillInput(input);
	const payload = buildCanonicalBackfillPayload(resolvedInput);

	// Absences: the closed-month refusal guards an absence by its entry's local days, and
	// neither its canonical record nor the entry's link and organization are frozen.
	await db.transaction(async (tx) => {
		await upsertCanonicalAbsenceRecords(tx, payload.timeRecords);
		await insertIfPresent(tx, timeRecordAbsence, payload.timeRecordAbsence);

		const decisions = payload.timeRecordApprovalDecision;
		if (decisions.length > 0) {
			await tx.delete(timeRecordApprovalDecision).where(
				and(
					eq(timeRecordApprovalDecision.organizationId, input.organizationId),
					inArray(
						timeRecordApprovalDecision.recordId,
						decisions.map((decision) => decision.recordId),
					),
				),
			);
			await tx.insert(timeRecordApprovalDecision).values(decisions);
		}

		for (const link of payload.legacyLinks.absenceEntry) {
			await tx
				.update(absenceEntry)
				.set({
					canonicalRecordId: link.canonicalRecordId,
					organizationId: link.organizationId,
				})
				.where(eq(absenceEntry.id, link.id));
		}

		for (const link of payload.legacyLinks.approvalRequest) {
			await tx
				.update(approvalRequest)
				.set({ canonicalRecordId: link.canonicalRecordId })
				.where(
					and(
						eq(approvalRequest.id, link.id),
						eq(approvalRequest.organizationId, input.organizationId),
					),
				);
		}
	});

	return { ...payload, work };
}

async function loadCanonicalBackfillInput(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillInput> {
	const [
		targetEmployees,
		scopedAbsenceEntries,
		nullOrgAbsenceEntries,
		approvalRequests,
		absenceCategories,
	] = await Promise.all([
		db.query.employee.findMany({
			where: eq(employee.organizationId, input.organizationId),
			columns: { id: true },
		}),
		db.query.absenceEntry.findMany({
			where: eq(absenceEntry.organizationId, input.organizationId),
		}),
		db.query.absenceEntry.findMany({
			where: isNull(absenceEntry.organizationId),
		}),
		db.query.approvalRequest.findMany({
			where: eq(approvalRequest.organizationId, input.organizationId),
		}),
		db.query.absenceCategory.findMany({
			where: eq(absenceCategory.organizationId, input.organizationId),
			columns: { id: true, countsAgainstVacation: true },
		}),
	]);

	const targetEmployeeIds = new Set(targetEmployees.map((record) => record.id));
	const normalizedScopedAbsenceEntries: LegacyAbsenceEntry[] = scopedAbsenceEntries
		.filter(
			(record): record is typeof record & { organizationId: string } =>
				record.organizationId !== null,
		)
		.map((record) => ({
			...record,
			organizationId: record.organizationId,
		}));
	const attributedNullOrgAbsenceEntries: LegacyAbsenceEntry[] = nullOrgAbsenceEntries
		.filter((record) => targetEmployeeIds.has(record.employeeId))
		.map((record) => ({
			...record,
			organizationId: input.organizationId,
		}));
	const normalizedApprovalRequests: LegacyApprovalRequest[] = approvalRequests.filter(
		(record): record is typeof record & { entityType: LegacyEntityType } =>
			record.entityType === "time_entry" || record.entityType === "absence_entry",
	);

	return {
		organizationId: input.organizationId,
		actorId: input.actorId,
		legacy: {
			absenceEntries: [...normalizedScopedAbsenceEntries, ...attributedNullOrgAbsenceEntries],
			approvalRequests: normalizedApprovalRequests,
			absenceCategories,
		},
	};
}

async function upsertCanonicalAbsenceRecords(
	tx: Transaction,
	values: CanonicalBackfillPayload["timeRecords"],
) {
	if (values.length === 0) return;
	await tx
		.insert(timeRecord)
		.values(values)
		.onConflictDoUpdate({
			target: [timeRecord.id, timeRecord.organizationId],
			set: {
				durationMinutes: sql.raw("excluded.duration_minutes"),
				approvalState: sql.raw("excluded.approval_state"),
			},
		});
}

async function insertIfPresent<TTable, TValue>(
	tx: {
		insert: (table: TTable) => {
			values: (values: TValue[]) => {
				onConflictDoNothing: () => Promise<unknown>;
			};
		};
	},
	table: TTable,
	values: TValue[],
) {
	if (values.length === 0) {
		return;
	}

	await tx.insert(table).values(values).onConflictDoNothing();
}

function mapAbsenceToInterval(
	startDate: string,
	startPeriod: CanonicalDayPeriod,
	endDate: string,
	endPeriod: CanonicalDayPeriod,
): {
	startAt: Date;
	endAt: Date;
	durationMinutes: number;
} {
	const startAt = dateWithPeriod(startDate, startPeriod, "start");
	const endAt = dateWithPeriod(endDate, endPeriod, "end");

	const durationMinutes = Math.max(0, Math.round(endAt.diff(startAt, "minutes").minutes));

	return {
		startAt: startAt.toJSDate(),
		endAt: endAt.toJSDate(),
		durationMinutes,
	};
}

function dateWithPeriod(
	dateIso: string,
	period: CanonicalDayPeriod,
	edge: "start" | "end",
): DateTime {
	const day = DateTime.fromISO(dateIso, { zone: "utc" });

	if (!day.isValid) {
		throw new Error(`Invalid absence date for backfill: ${dateIso}`);
	}

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

function normalizeLegacyDayPeriod(period: LegacyDayPeriod): CanonicalDayPeriod {
	if (period === "morning") {
		return "am";
	}

	if (period === "afternoon") {
		return "pm";
	}

	return period;
}
