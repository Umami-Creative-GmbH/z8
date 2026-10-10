"use server";

import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, coverageRule, shift } from "@/db/schema";
import {
	type AbsencePlanPreview,
	buildAbsencePlanPreview,
	type CoverageEvaluationInput,
	type ExistingAbsenceInput,
} from "@/lib/absences/absence-plan-preview";
import { loadTimeOffInLieuPreview } from "@/lib/absences/time-off-in-lieu-preview.server";
import type { AbsenceRequest } from "@/lib/absences/types";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import type { DayOfWeek } from "@/lib/coverage/domain/entities/coverage-rule";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { getCurrentEmployee } from "./current-employee";
import { getHolidays, getVacationBalance } from "./queries";

export type AbsencePlanPreviewRequest = AbsenceRequest;

type PlanPreviewResult =
	| { success: true; data: AbsencePlanPreview }
	| { success: false; error: string };

type AffectedShift = {
	id: string;
	employeeId: string | null;
	subareaId: string;
	/** The organization-local calendar date, `YYYY-MM-DD`. */
	date: string;
	startTime: string;
	endTime: string;
};

type ShiftRow = Omit<AffectedShift, "date"> & { date: Date };

const DAY_OF_WEEK_BY_NUMBER: Record<number, DayOfWeek> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

type ExistingAbsenceRow = Pick<
	typeof absenceEntry.$inferSelect,
	"id" | "startDate" | "endDate" | "status"
> & {
	category: Pick<typeof absenceCategory.$inferSelect, "name">;
};

type CoverageRuleWithSubarea = {
	id: string;
	subareaId: string;
	dayOfWeek: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	subarea?: { id: string; name: string } | null;
};

export async function getAbsencePlanPreview(
	request: AbsencePlanPreviewRequest,
): Promise<PlanPreviewResult> {
	const range = parsePreviewRange(request);
	if (!range) {
		return { success: false, error: "Invalid preview date range" };
	}

	try {
		const currentEmployee = await getCurrentEmployee();
		if (!currentEmployee) {
			return { success: false, error: "No active employee found" };
		}

		const category = await db.query.absenceCategory.findFirst({
			where: and(
				eq(absenceCategory.id, request.categoryId),
				eq(absenceCategory.organizationId, currentEmployee.organizationId),
				eq(absenceCategory.isActive, true),
			),
		});

		if (!category) {
			return { success: false, error: "Absence category not found" };
		}

		const org = await db.query.organization.findFirst({
			where: eq(organization.id, currentEmployee.organizationId),
			columns: { timezone: true },
		});
		const timezone = resolveOrganizationTimezone(org?.timezone).timezone;
		const shiftBounds = shiftDateRangeBounds(
			request.startDate,
			parsePlainDate(request.endDate).add({ days: 1 }),
			timezone,
		);

		const [vacationBalance, holidays, existingAbsences, affectedShiftRows, managerId] =
			await Promise.all([
				getVacationBalance(currentEmployee.id, range.start.year, timezone),
				getHolidays(currentEmployee.id, range.startDate, range.endDate),
				db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.employeeId, currentEmployee.id),
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						lte(absenceEntry.startDate, request.endDate),
						gte(absenceEntry.endDate, request.startDate),
					),
					with: { category: true },
				}),
				db.query.shift.findMany({
					where: and(
						eq(shift.organizationId, currentEmployee.organizationId),
						eq(shift.employeeId, currentEmployee.id),
						eq(shift.status, "published"),
						gte(shift.date, shiftBounds.start),
						lt(shift.date, shiftBounds.endExclusive),
					),
				}),
				getPrimaryEligibleManagerIdForRequester({
					db,
					requesterEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				}),
			]);

		const workBalance = category.drawsOnWorkBalance
			? await loadTimeOffInLieuPreview({
					organizationId: currentEmployee.organizationId,
					employeeId: currentEmployee.id,
					absence: {
						startDate: request.startDate,
						startPeriod: request.startPeriod,
						endDate: request.endDate,
						endPeriod: request.endPeriod,
					},
				}).catch(() => null)
			: null;
		const typedExistingAbsences = existingAbsences as unknown as ExistingAbsenceRow[];
		const typedAffectedShifts = toAffectedShifts(affectedShiftRows, timezone);
		const coverage = await evaluateCoverageRisk({
			organizationId: currentEmployee.organizationId,
			shiftBounds,
			timezone,
			employeeId: currentEmployee.id,
			affectedShifts: typedAffectedShifts,
		});

		const data = buildAbsencePlanPreview({
			category: {
				id: category.id,
				name: category.name,
				requiresApproval: category.requiresApproval,
				countsAgainstVacation: category.countsAgainstVacation,
				drawsOnWorkBalance: category.drawsOnWorkBalance,
			},
			request,
			vacationBalance,
			holidays,
			existingAbsences: typedExistingAbsences.map((absence) => ({
				id: absence.id,
				startDate: absence.startDate,
				endDate: absence.endDate,
				status: absence.status,
				categoryName: absence.category.name,
			})) satisfies ExistingAbsenceInput[],
			affectedShifts: typedAffectedShifts,
			coverage,
			hasManager: Boolean(managerId),
			workBalance,
		});

		return { success: true, data };
	} catch {
		return { success: false, error: "Unable to build absence plan preview" };
	}
}

function parsePreviewRange(request: AbsencePlanPreviewRequest) {
	const start = DateTime.fromISO(request.startDate, { zone: "utc" });
	const end = DateTime.fromISO(request.endDate, { zone: "utc" });

	if (!start.isValid || !end.isValid || end < start) {
		return null;
	}

	return {
		start,
		end,
		startDate: start.startOf("day").toJSDate(),
		endDate: end.endOf("day").toJSDate(),
	};
}

/** Reads each shift's `shift.date` as its calendar date in the organization's zone. */
function toAffectedShifts(rows: ShiftRow[], timezone: string): AffectedShift[] {
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		subareaId: row.subareaId,
		date: shiftCalendarDate(row.date, timezone).toString(),
		startTime: row.startTime,
		endTime: row.endTime,
	}));
}

async function evaluateCoverageRisk({
	organizationId,
	shiftBounds,
	timezone,
	employeeId,
	affectedShifts,
}: {
	organizationId: string;
	shiftBounds: { start: Date; endExclusive: Date };
	timezone: string;
	employeeId: string;
	affectedShifts: AffectedShift[];
}): Promise<CoverageEvaluationInput> {
	const subareaIds = [...new Set(affectedShifts.map((affectedShift) => affectedShift.subareaId))];
	if (subareaIds.length === 0) {
		return { risks: [], hasConfiguredRulesForAffectedShifts: false };
	}

	const [rules, publishedShifts] = await Promise.all([
		db.query.coverageRule.findMany({
			where: and(
				eq(coverageRule.organizationId, organizationId),
				inArray(coverageRule.subareaId, subareaIds),
			),
			with: { subarea: true },
		}),
		db.query.shift.findMany({
			where: and(
				eq(shift.organizationId, organizationId),
				eq(shift.status, "published"),
				inArray(shift.subareaId, subareaIds),
				gte(shift.date, shiftBounds.start),
				lt(shift.date, shiftBounds.endExclusive),
			),
		}),
	]);

	const coverageRisks: CoverageEvaluationInput["risks"] = [];
	const typedRules = rules as unknown as CoverageRuleWithSubarea[];
	const typedPublishedShifts = toAffectedShifts(publishedShifts, timezone);
	let hasMatchingRuleForAffectedShifts = false;

	for (const affectedShift of affectedShifts) {
		const dateKey = affectedShift.date;
		const dayOfWeek = DAY_OF_WEEK_BY_NUMBER[parsePlainDate(dateKey).dayOfWeek];

		for (const rule of typedRules) {
			if (
				rule.subareaId !== affectedShift.subareaId ||
				rule.dayOfWeek !== dayOfWeek ||
				!timeRangesOverlap(
					rule.startTime,
					rule.endTime,
					affectedShift.startTime,
					affectedShift.endTime,
				)
			) {
				continue;
			}
			hasMatchingRuleForAffectedShifts = true;

			const evaluatedCoverageRisks = findUnderstaffedSegments({
				rule,
				affectedShift,
				employeeId,
				publishedShifts: typedPublishedShifts,
			});

			for (const evaluatedCoverage of evaluatedCoverageRisks) {
				coverageRisks.push({
					date: dateKey,
					subareaId: rule.subareaId,
					subareaName: rule.subarea?.name ?? "Unknown subarea",
					startTime: evaluatedCoverage.startTime,
					endTime: evaluatedCoverage.endTime,
					minimumStaffCount: rule.minimumStaffCount,
					staffCountAfterAbsence: evaluatedCoverage.staffCountAfterAbsence,
				});
			}
		}
	}

	return {
		risks: dedupeCoverageRisks(coverageRisks),
		hasConfiguredRulesForAffectedShifts: hasMatchingRuleForAffectedShifts,
	};
}

function timeRangesOverlap(
	leftStart: string,
	leftEnd: string,
	rightStart: string,
	rightEnd: string,
) {
	return leftStart < rightEnd && leftEnd > rightStart;
}

function findUnderstaffedSegments({
	rule,
	affectedShift,
	employeeId,
	publishedShifts,
}: {
	rule: CoverageRuleWithSubarea;
	affectedShift: AffectedShift;
	employeeId: string;
	publishedShifts: AffectedShift[];
}) {
	const evaluationStart = maxTime(rule.startTime, affectedShift.startTime);
	const evaluationEnd = minTime(rule.endTime, affectedShift.endTime);
	if (evaluationStart >= evaluationEnd) {
		return [];
	}

	const candidateShifts = publishedShifts.filter(
		(publishedShift) =>
			publishedShift.employeeId &&
			publishedShift.employeeId !== employeeId &&
			publishedShift.subareaId === rule.subareaId &&
			publishedShift.date === affectedShift.date &&
			timeRangesOverlap(
				evaluationStart,
				evaluationEnd,
				publishedShift.startTime,
				publishedShift.endTime,
			),
	);
	const boundaries = new Set([evaluationStart, evaluationEnd]);

	for (const publishedShift of candidateShifts) {
		boundaries.add(clampTime(publishedShift.startTime, evaluationStart, evaluationEnd));
		boundaries.add(clampTime(publishedShift.endTime, evaluationStart, evaluationEnd));
	}

	const sortedBoundaries = Array.from(boundaries).toSorted();
	const understaffedSegments: Array<{
		startTime: string;
		endTime: string;
		staffCountAfterAbsence: number;
	}> = [];

	for (let index = 0; index < sortedBoundaries.length - 1; index++) {
		const segmentStart = sortedBoundaries[index];
		const segmentEnd = sortedBoundaries[index + 1];
		if (!segmentStart || !segmentEnd || segmentStart === segmentEnd) {
			continue;
		}

		const assignedStaff = new Set(
			candidateShifts.flatMap((publishedShift) =>
				publishedShift.startTime <= segmentStart && publishedShift.endTime >= segmentEnd
					? [publishedShift.employeeId]
					: [],
			),
		).size;

		if (assignedStaff >= rule.minimumStaffCount) {
			continue;
		}

		const previousSegment = understaffedSegments.at(-1);
		if (previousSegment?.endTime === segmentStart) {
			previousSegment.endTime = segmentEnd;
			previousSegment.staffCountAfterAbsence = Math.min(
				previousSegment.staffCountAfterAbsence,
				assignedStaff,
			);
			continue;
		}

		understaffedSegments.push({
			startTime: segmentStart,
			endTime: segmentEnd,
			staffCountAfterAbsence: assignedStaff,
		});
	}

	return understaffedSegments;
}

function maxTime(left: string, right: string) {
	return left > right ? left : right;
}

function minTime(left: string, right: string) {
	return left < right ? left : right;
}

function clampTime(time: string, startTime: string, endTime: string) {
	if (time < startTime) {
		return startTime;
	}

	if (time > endTime) {
		return endTime;
	}

	return time;
}

function dedupeCoverageRisks(risks: CoverageEvaluationInput["risks"]) {
	const risksByKey = new Map<string, CoverageEvaluationInput["risks"][number]>();
	for (const risk of risks) {
		risksByKey.set([risk.date, risk.subareaId, risk.startTime, risk.endTime].join(":"), risk);
	}

	return [...risksByKey.values()];
}
