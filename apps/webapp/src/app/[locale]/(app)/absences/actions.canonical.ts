import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { timeRecord, timeRecordAbsence } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

type DayPeriod = "full_day" | "am" | "pm";

export function mapAbsenceRangeToCanonicalTimestamps(input: {
	startDate: string;
	endDate: string;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
}): { startAt: Date; endAt: Date } {
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

export const canonicalAbsenceRecordClient = {
	create: async (input: {
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
	}) => {
		const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps({
			startDate: input.startDate,
			startPeriod: input.startPeriod,
			endDate: input.endDate,
			endPeriod: input.endPeriod,
		});

		return db.transaction(async (tx) => {
			const [record] = await tx
				.insert(timeRecord)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					recordKind: "absence",
					startAt,
					endAt,
					durationMinutes: Math.max(
						0,
						Math.floor((endAt.getTime() - startAt.getTime()) / 60000),
					),
					approvalState: input.requiresApproval ? "pending" : "approved",
					origin: "manual",
					createdBy: input.createdBy,
					updatedBy: input.createdBy,
				})
				.returning({ id: timeRecord.id });

			await tx.insert(timeRecordAbsence).values({
				recordId: record.id,
				organizationId: input.organizationId,
				recordKind: "absence",
				absenceCategoryId: input.absenceCategoryId,
				startPeriod: input.startPeriod,
				endPeriod: input.endPeriod,
				countsAgainstVacation: input.countsAgainstVacation,
			});

			return record;
		});
	},
};

export async function syncAbsenceRequestToCanonicalRecord(input: {
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
}): Promise<string> {
	const canonicalRecord = await canonicalAbsenceRecordClient.create({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		absenceCategoryId: input.absenceCategoryId,
		startDate: input.startDate,
		startPeriod: input.startPeriod,
		endDate: input.endDate,
		endPeriod: input.endPeriod,
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
	if (!input.canonicalRecordId) {
		return;
	}

	await db
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
}): Promise<void> {
	if (!input.canonicalRecordId) {
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
