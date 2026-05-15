import { and, eq, or } from "drizzle-orm";
import { DateTime } from "luxon";
import type { db } from "@/db";
import { absenceEntry, approvalRequest } from "@/db/schema";
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

function isoDatePlusDays(date: string, days: number): string {
	return DateTime.fromISO(date).plus({ days }).toISODate() ?? date;
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
	existingStatus: AbsenceStatus;
	existingCountsAgainstVacation: boolean;
}): string | null {
	const isEligibleSickVacationOverride =
		input.newCategoryType === "sick" &&
		input.newStartPeriod === "full_day" &&
		input.newEndPeriod === "full_day" &&
		input.existingCountsAgainstVacation;

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
		if (!vacation.category.countsAgainstVacation) continue;
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
			await input.tx.delete(approvalRequest).where(
				and(
					eq(approvalRequest.entityType, "absence_entry"),
					eq(approvalRequest.entityId, vacation.id),
					eq(approvalRequest.organizationId, input.organizationId),
				),
			);
			await input.tx.delete(absenceEntry).where(
				and(eq(absenceEntry.id, vacation.id), eq(absenceEntry.organizationId, input.organizationId)),
			);
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
		summary.updatedAbsenceIds.push(vacation.id);

		if (secondSegment) {
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
				})
				.returning({ id: absenceEntry.id });
			summary.createdAbsenceIds.push(created.id);
		}
	}

	return summary;
}
