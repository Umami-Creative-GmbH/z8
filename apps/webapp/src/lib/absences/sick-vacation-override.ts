import { and, eq, or } from "drizzle-orm";
import { DateTime } from "luxon";
import type { db } from "@/db";
import { absenceEntry, approvalRequest, timeRecord, timeRecordAbsence } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { dateRangesOverlap } from "./date-utils";
import type { DayPeriod } from "./types";

export type VacationSegment = { startDate: string; endDate: string };
export type AbsenceStatus = "pending" | "approved" | "rejected";
export type VacationOverrideSummary = {
	updatedAbsenceIds: string[];
	createdAbsenceIds: string[];
	deletedAbsenceIds: string[];
};

type AbsenceTransaction = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"delete" | "insert" | "query" | "update"
>;

type CanonicalAbsenceRangeInput = {
	organizationId: string;
	canonicalRecordId: string | null;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	updatedBy: string;
};

function isoDatePlusDays(date: string, days: number): string {
	return DateTime.fromISO(date).plus({ days }).toISODate() ?? date;
}

function mapAbsenceRangeToCanonicalTimestamps(input: {
	startDate: string;
	endDate: string;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
}): { startAt: Date; endAt: Date } {
	const startOfStartDate = DateTime.fromISO(input.startDate, { zone: "utc" }).startOf("day");
	const endOfEndDate = DateTime.fromISO(input.endDate, { zone: "utc" }).endOf("day");

	const startAt = input.startPeriod === "pm" ? startOfStartDate.plus({ hours: 12 }) : startOfStartDate;
	const endAt = input.endPeriod === "am" ? endOfEndDate.minus({ hours: 12 }) : endOfEndDate;

	return { startAt: startAt.toJSDate(), endAt: endAt.toJSDate() };
}

async function updateCanonicalAbsenceRangeInTransaction(
	tx: AbsenceTransaction,
	input: CanonicalAbsenceRangeInput,
): Promise<void> {
	if (!input.canonicalRecordId) return;

	const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps(input);

	await tx
		.update(timeRecord)
		.set({
			startAt,
			endAt,
			durationMinutes: Math.max(0, Math.floor((endAt.getTime() - startAt.getTime()) / 60000)),
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

	await tx
		.update(timeRecordAbsence)
		.set({ startPeriod: input.startPeriod, endPeriod: input.endPeriod })
		.where(
			and(
				eq(timeRecordAbsence.recordId, input.canonicalRecordId),
				eq(timeRecordAbsence.organizationId, input.organizationId),
				eq(timeRecordAbsence.recordKind, "absence"),
			),
		);
}

async function rejectCanonicalAbsenceInTransaction(
	tx: AbsenceTransaction,
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		updatedBy: string;
	},
): Promise<void> {
	if (!input.canonicalRecordId) return;

	await tx
		.update(timeRecord)
		.set({
			approvalState: "rejected",
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

	await tx
		.update(timeRecordAbsence)
		.set({ countsAgainstVacation: false })
		.where(
			and(
				eq(timeRecordAbsence.recordId, input.canonicalRecordId),
				eq(timeRecordAbsence.organizationId, input.organizationId),
				eq(timeRecordAbsence.recordKind, "absence"),
			),
		);
}

async function createCanonicalAbsenceInTransaction(
	tx: AbsenceTransaction,
	input: {
		organizationId: string;
		employeeId: string;
		absenceCategoryId: string;
		startDate: string;
		startPeriod: DayPeriod;
		endDate: string;
		endPeriod: DayPeriod;
		countsAgainstVacation: boolean;
		requiresApproval: boolean;
		approvalState?: "pending" | "approved";
		createdBy: string;
	},
): Promise<string> {
	const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps(input);
	const [record] = await tx
		.insert(timeRecord)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			recordKind: "absence",
			startAt,
			endAt,
			durationMinutes: Math.max(0, Math.floor((endAt.getTime() - startAt.getTime()) / 60000)),
			approvalState: input.approvalState ?? (input.requiresApproval ? "pending" : "approved"),
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

	return record.id;
}

export function splitVacationAroundSickRange(input: {
	vacationStartDate: string;
	vacationEndDate: string;
	sickStartDate: string;
	sickEndDate: string;
}): VacationSegment[] {
	if (
		input.sickEndDate < input.vacationStartDate ||
		input.sickStartDate > input.vacationEndDate
	) {
		return [
			{ startDate: input.vacationStartDate, endDate: input.vacationEndDate },
		];
	}

	const segments: VacationSegment[] = [];

	if (input.vacationStartDate < input.sickStartDate) {
		segments.push({
			startDate: input.vacationStartDate,
			endDate: isoDatePlusDays(input.sickStartDate, -1),
		});
	}

	if (input.vacationEndDate > input.sickEndDate) {
		segments.push({
			startDate: isoDatePlusDays(input.sickEndDate, 1),
			endDate: input.vacationEndDate,
		});
	}

	return segments.filter((segment) => segment.startDate <= segment.endDate);
}

export function getBlockingOverlapMessage(input: {
	newCategoryType: string;
	newStartPeriod: DayPeriod;
	newEndPeriod: DayPeriod;
	existingStartPeriod: DayPeriod;
	existingEndPeriod: DayPeriod;
	existingStatus: AbsenceStatus;
	existingCountsAgainstVacation: boolean;
	incomingRequiresApproval?: boolean;
	hasManagerApprovalWorkflow?: boolean;
}): string | null {
	const isEligibleSickVacationOverride =
		input.newCategoryType === "sick" &&
		input.newStartPeriod === "full_day" &&
		input.newEndPeriod === "full_day" &&
		input.existingStartPeriod === "full_day" &&
		input.existingEndPeriod === "full_day" &&
		input.existingCountsAgainstVacation;

	if (isEligibleSickVacationOverride && input.incomingRequiresApproval && input.hasManagerApprovalWorkflow) {
		return "Sick absence requires approval before it can override vacation";
	}

	if (isEligibleSickVacationOverride) return null;

	return input.existingStatus === "pending"
		? "Absence request overlaps with an existing pending request"
		: "Absence request overlaps with an existing approved absence";
}

export async function adjustVacationAbsencesForSickness(input: {
	tx: AbsenceTransaction;
	organizationId: string;
	employeeId: string;
	sickStartDate: string;
	sickEndDate: string;
	updatedBy: string;
}): Promise<VacationOverrideSummary> {
	const summary: VacationOverrideSummary = {
		updatedAbsenceIds: [],
		createdAbsenceIds: [],
		deletedAbsenceIds: [],
	};

	const overlappingVacations = await input.tx.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, input.employeeId),
			eq(absenceEntry.organizationId, input.organizationId),
			or(eq(absenceEntry.status, "pending"), eq(absenceEntry.status, "approved")),
		),
		with: { category: true },
	});

	for (const vacation of overlappingVacations) {
		if (vacation.status !== "pending" && vacation.status !== "approved") continue;
		if (!vacation.category.countsAgainstVacation) continue;
		if (vacation.startPeriod !== "full_day" || vacation.endPeriod !== "full_day") continue;
		if (!dateRangesOverlap(input.sickStartDate, input.sickEndDate, vacation.startDate, vacation.endDate)) {
			continue;
		}

		const segments = splitVacationAroundSickRange({
			vacationStartDate: vacation.startDate,
			vacationEndDate: vacation.endDate,
			sickStartDate: input.sickStartDate,
			sickEndDate: input.sickEndDate,
		});

		if (segments.length === 0) {
			if (vacation.status === "pending") {
				await input.tx
					.update(approvalRequest)
					.set({
						status: "rejected",
						approvedAt: currentTimestamp(),
						rejectionReason: "Overridden by sick absence",
					})
					.where(
						and(
							eq(approvalRequest.entityType, "absence_entry"),
							eq(approvalRequest.entityId, vacation.id),
							eq(approvalRequest.organizationId, input.organizationId),
							eq(approvalRequest.status, "pending"),
						),
					);
			}
			await input.tx
				.update(absenceEntry)
				.set({
					status: "rejected",
					rejectionReason: "Overridden by sick absence",
				})
				.where(and(eq(absenceEntry.id, vacation.id), eq(absenceEntry.organizationId, input.organizationId)));
			await rejectCanonicalAbsenceInTransaction(input.tx, {
				organizationId: input.organizationId,
				canonicalRecordId: vacation.canonicalRecordId,
				updatedBy: input.updatedBy,
			});
			summary.deletedAbsenceIds.push(vacation.id);
			continue;
		}

		const [firstSegment, secondSegment] = segments;
		await input.tx
			.update(absenceEntry)
			.set({
				startDate: firstSegment.startDate,
				startPeriod: "full_day",
				endDate: firstSegment.endDate,
				endPeriod: "full_day",
			})
			.where(and(eq(absenceEntry.id, vacation.id), eq(absenceEntry.organizationId, input.organizationId)));
		await updateCanonicalAbsenceRangeInTransaction(input.tx, {
			organizationId: input.organizationId,
			canonicalRecordId: vacation.canonicalRecordId,
			startDate: firstSegment.startDate,
			startPeriod: "full_day",
			endDate: firstSegment.endDate,
			endPeriod: "full_day",
			updatedBy: input.updatedBy,
		});
		summary.updatedAbsenceIds.push(vacation.id);

		if (secondSegment) {
			const canonicalRecordId = await createCanonicalAbsenceInTransaction(input.tx, {
				organizationId: input.organizationId,
				employeeId: vacation.employeeId,
				absenceCategoryId: vacation.categoryId,
				startDate: secondSegment.startDate,
				startPeriod: "full_day",
				endDate: secondSegment.endDate,
				endPeriod: "full_day",
				countsAgainstVacation: vacation.category.countsAgainstVacation,
				requiresApproval: vacation.category.requiresApproval,
				approvalState: vacation.status,
				createdBy: input.updatedBy,
			});
			const [created] = await input.tx
				.insert(absenceEntry)
				.values({
					employeeId: vacation.employeeId,
					organizationId: input.organizationId,
					categoryId: vacation.categoryId,
					startDate: secondSegment.startDate,
					startPeriod: "full_day",
					endDate: secondSegment.endDate,
					endPeriod: "full_day",
					status: vacation.status,
					notes: vacation.notes,
					approvedBy: vacation.approvedBy,
					approvedAt: vacation.approvedAt,
					canonicalRecordId,
				})
				.returning({ id: absenceEntry.id });
			summary.createdAbsenceIds.push(created.id);

			if (vacation.status === "pending") {
				const existingApproval = await input.tx.query.approvalRequest.findFirst({
					where: and(
						eq(approvalRequest.organizationId, input.organizationId),
						eq(approvalRequest.entityType, "absence_entry"),
						eq(approvalRequest.entityId, vacation.id),
					),
				});

				if (existingApproval) {
					await input.tx.insert(approvalRequest).values({
						organizationId: input.organizationId,
						entityType: existingApproval.entityType,
						entityId: created.id,
						canonicalRecordId,
						requestedBy: existingApproval.requestedBy,
						approverId: existingApproval.approverId,
						status: existingApproval.status,
						reason: existingApproval.reason,
						notes: existingApproval.notes,
						approvedAt: existingApproval.approvedAt,
						rejectionReason: existingApproval.rejectionReason,
					});
				}
			}
		}
	}

	return summary;
}
