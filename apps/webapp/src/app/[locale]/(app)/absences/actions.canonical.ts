import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { timeRecord, timeRecordAbsence } from "@/db/schema";
import {
	mapAbsenceDurationToCanonicalTimestamps,
	normalizeAbsenceDurationInput,
} from "@/lib/absences/duration";
import type { AbsenceDurationKind } from "@/lib/absences/types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

type DayPeriod = "full_day" | "am" | "pm";
type CanonicalAbsenceTransaction = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"delete" | "update"
>;

export function mapAbsenceRangeToCanonicalTimestamps(input: {
	startDate: string;
	endDate: string;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
	durationKind?: AbsenceDurationKind;
	startTime?: string;
	endTime?: string;
}): { startAt: Date; endAt: Date } {
	if (input.durationKind) {
		const normalized = normalizeAbsenceDurationInput(input);

		return mapAbsenceDurationToCanonicalTimestamps({
			...normalized,
			categoryId: normalized.categoryId || "canonical-absence",
		});
	}

	const startOfStartDate = DateTime.fromISO(input.startDate, {
		zone: "utc",
	}).startOf("day");
	const endOfEndDate = DateTime.fromISO(input.endDate, { zone: "utc" }).endOf(
		"day",
	);

	const startAt =
		input.startPeriod === "pm"
			? startOfStartDate.plus({ hours: 12 })
			: startOfStartDate;
	const endAt =
		input.endPeriod === "am" ? endOfEndDate.minus({ hours: 12 }) : endOfEndDate;

	return {
		startAt: startAt.toJSDate(),
		endAt: endAt.toJSDate(),
	};
}

export function buildCanonicalAbsenceRecordValues(input: {
	organizationId: string;
	employeeId: string;
	absenceCategoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	countsAgainstVacation: boolean;
	requiresApproval: boolean;
	createdBy: string;
	durationKind?: AbsenceDurationKind;
	startTime?: string;
	endTime?: string;
}) {
	const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps(input);

	return {
		timeRecord: {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			recordKind: "absence" as const,
			startAt,
			endAt,
			durationMinutes: Math.max(
				0,
				Math.floor((endAt.getTime() - startAt.getTime()) / 60000),
			),
			approvalState: input.requiresApproval
				? ("pending" as const)
				: ("approved" as const),
			origin: "manual" as const,
			createdBy: input.createdBy,
			updatedBy: input.createdBy,
		},
		timeRecordAbsence: {
			organizationId: input.organizationId,
			recordKind: "absence" as const,
			absenceCategoryId: input.absenceCategoryId,
			startPeriod: input.startPeriod,
			endPeriod: input.endPeriod,
			countsAgainstVacation: input.countsAgainstVacation,
		},
	};
}

export const canonicalAbsenceRecordClient = {
	create: async (input: {
		organizationId: string;
		employeeId: string;
		absenceCategoryId: string;
		startDate: string;
		startPeriod: DayPeriod;
		endDate: string;
		endPeriod: DayPeriod;
		durationKind?: AbsenceDurationKind;
		startTime?: string;
		endTime?: string;
		countsAgainstVacation: boolean;
		requiresApproval: boolean;
		createdBy: string;
	}) => {
		const values = buildCanonicalAbsenceRecordValues(input);

		return db.transaction(async (tx) => {
			const [record] = await tx
				.insert(timeRecord)
				.values(values.timeRecord)
				.returning({ id: timeRecord.id });

			await tx.insert(timeRecordAbsence).values({
				recordId: record.id,
				...values.timeRecordAbsence,
			});

			return record;
		});
	},
};

export async function updateCanonicalAbsenceRangeInTransaction(
	tx: CanonicalAbsenceTransaction,
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		startDate: string;
		startPeriod: DayPeriod;
		endDate: string;
		endPeriod: DayPeriod;
		updatedBy: string;
	},
): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	const canonicalRecordId = input.canonicalRecordId;
	const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps(input);

	await tx
		.update(timeRecord)
		.set({
			startAt,
			endAt,
			durationMinutes: Math.max(
				0,
				Math.floor((endAt.getTime() - startAt.getTime()) / 60000),
			),
			updatedAt: currentTimestamp(),
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
			),
		);

	await tx
		.update(timeRecordAbsence)
		.set({
			startPeriod: input.startPeriod,
			endPeriod: input.endPeriod,
		})
		.where(
			and(
				eq(timeRecordAbsence.recordId, canonicalRecordId),
				eq(timeRecordAbsence.organizationId, input.organizationId),
				eq(timeRecordAbsence.recordKind, "absence"),
			),
		);
}

export async function updateCanonicalAbsenceRange(input: {
	organizationId: string;
	canonicalRecordId: string | null;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	updatedBy: string;
}): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	await db.transaction(async (tx) => {
		await updateCanonicalAbsenceRangeInTransaction(tx, input);
	});
}

export async function syncAbsenceRequestToCanonicalRecord(input: {
	organizationId: string;
	employeeId: string;
	absenceCategoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	durationKind?: AbsenceDurationKind;
	startTime?: string;
	endTime?: string;
	countsAgainstVacation: boolean;
	requiresApproval: boolean;
	createdBy: string;
}): Promise<string> {
	const canonicalRecord = await canonicalAbsenceRecordClient.create({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		absenceCategoryId: input.absenceCategoryId,
		startDate: input.startDate,
		startPeriod: input.startPeriod,
		endDate: input.endDate,
		endPeriod: input.endPeriod,
		durationKind: input.durationKind,
		startTime: input.startTime,
		endTime: input.endTime,
		countsAgainstVacation: input.countsAgainstVacation,
		requiresApproval: input.requiresApproval,
		createdBy: input.createdBy,
	});

	return canonicalRecord.id;
}

export async function syncCanonicalAbsenceApprovalState(input: {
	organizationId: string;
	canonicalRecordId: string | null;
	approvalState: "approved" | "rejected";
	updatedBy: string;
}): Promise<void> {
	await syncCanonicalAbsenceApprovalStateInTransaction(db, input);
}

export async function syncCanonicalAbsenceApprovalStateInTransaction(
	tx: CanonicalAbsenceTransaction,
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		approvalState: "approved" | "rejected";
		updatedBy: string;
	},
): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	await tx
		.update(timeRecord)
		.set({
			approvalState: input.approvalState,
			updatedAt: currentTimestamp(),
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
			),
		);
}

export async function removeCanonicalAbsenceRecord(input: {
	organizationId: string;
	canonicalRecordId: string | null;
	expectedEmployeeId?: string;
	expectedApprovalState?: "pending" | "approved";
}): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	if (input.expectedApprovalState && input.expectedEmployeeId) {
		await removeCanonicalAbsenceRecordInTransaction(db, {
			organizationId: input.organizationId,
			canonicalRecordId: input.canonicalRecordId,
			expectedEmployeeId: input.expectedEmployeeId,
			expectedApprovalState: input.expectedApprovalState,
		});
		return;
	}

	await db
		.delete(timeRecord)
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
			),
		);
}

export async function removeCanonicalAbsenceRecordInTransaction(
	tx: CanonicalAbsenceTransaction,
	input: {
		organizationId: string;
		canonicalRecordId: string;
		expectedEmployeeId: string;
		expectedApprovalState: "pending" | "approved";
	},
): Promise<void> {
	const deleted = await tx
		.delete(timeRecord)
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
				eq(timeRecord.approvalState, input.expectedApprovalState),
				eq(timeRecord.employeeId, input.expectedEmployeeId),
			),
		)
		.returning({
			id: timeRecord.id,
			organizationId: timeRecord.organizationId,
			employeeId: timeRecord.employeeId,
			recordKind: timeRecord.recordKind,
			approvalState: timeRecord.approvalState,
		});
	const row = deleted[0];
	if (
		deleted.length !== 1 ||
		row?.id !== input.canonicalRecordId ||
		row.organizationId !== input.organizationId ||
		row.recordKind !== "absence" ||
		row.approvalState !== input.expectedApprovalState ||
		row.employeeId !== input.expectedEmployeeId
	) {
		throw new Error("Canonical absence deletion affected-row mismatch");
	}
}
