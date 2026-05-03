"use server";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceCategory, absenceEntry, coverageRule, shift } from "@/db/schema";
import {
	buildAbsencePlanPreview,
	type AbsencePlanPreview,
	type CoverageEvaluationInput,
	type ExistingAbsenceInput,
} from "@/lib/absences/absence-plan-preview";
import type { AbsenceRequest } from "@/lib/absences/types";
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
	date: Date;
	startTime: string;
	endTime: string;
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

		const [vacationBalance, holidays, existingAbsences, affectedShifts] = await Promise.all([
			getVacationBalance(currentEmployee.id, range.start.year),
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
					gte(shift.date, range.startDate),
					lte(shift.date, range.endDate),
				),
			}),
		]);

		const typedAffectedShifts = affectedShifts as AffectedShift[];
		const coverage = await evaluateCoverageRisk({
			organizationId: currentEmployee.organizationId,
			startDate: range.startDate,
			endDate: range.endDate,
			employeeId: currentEmployee.id,
			affectedShifts: typedAffectedShifts,
		});

		const data = buildAbsencePlanPreview({
			category: {
				id: category.id,
				name: category.name,
				requiresApproval: category.requiresApproval,
				countsAgainstVacation: category.countsAgainstVacation,
			},
			request,
			vacationBalance,
			holidays,
			existingAbsences: existingAbsences.map((absence) => ({
				id: absence.id,
				startDate: absence.startDate,
				endDate: absence.endDate,
				status: absence.status,
				categoryName: absence.category.name,
			})) satisfies ExistingAbsenceInput[],
			affectedShifts: typedAffectedShifts,
			coverage,
			hasManager: Boolean(currentEmployee.managerId),
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

async function evaluateCoverageRisk({
	organizationId,
	startDate,
	endDate,
	employeeId,
	affectedShifts,
}: {
	organizationId: string;
	startDate: Date;
	endDate: Date;
	employeeId: string;
	affectedShifts: AffectedShift[];
}): Promise<CoverageEvaluationInput> {
	const subareaIds = [...new Set(affectedShifts.map((affectedShift) => affectedShift.subareaId))];
	if (subareaIds.length === 0) {
		return { risks: [], hasConfiguredRulesForAffectedShifts: false };
	}

	const [rules, publishedShifts] = await Promise.all([
		db.query.coverageRule.findMany({
			where: and(eq(coverageRule.organizationId, organizationId), inArray(coverageRule.subareaId, subareaIds)),
			with: { subarea: true },
		}),
		db.query.shift.findMany({
			where: and(
				eq(shift.organizationId, organizationId),
				eq(shift.status, "published"),
				inArray(shift.subareaId, subareaIds),
				gte(shift.date, startDate),
				lte(shift.date, endDate),
			),
		}),
	]);

	const coverageRisks: CoverageEvaluationInput["risks"] = [];
	const typedRules = rules as CoverageRuleWithSubarea[];
	const typedPublishedShifts = publishedShifts as AffectedShift[];
	let hasMatchingRuleForAffectedShifts = false;

	for (const affectedShift of affectedShifts) {
		const date = DateTime.fromJSDate(affectedShift.date, { zone: "utc" });
		const dateKey = date.toISODate();
		const weekday = date.weekdayLong;
		if (!dateKey || !weekday) {
			continue;
		}
		const dayOfWeek = weekday.toLowerCase();

		for (const rule of typedRules) {
			if (
				rule.subareaId !== affectedShift.subareaId ||
				rule.dayOfWeek !== dayOfWeek ||
				!timeRangesOverlap(rule.startTime, rule.endTime, affectedShift.startTime, affectedShift.endTime)
			) {
				continue;
			}
			hasMatchingRuleForAffectedShifts = true;

			const staffCountAfterAbsence = findLowestSegmentStaffCount({
				rule,
				affectedShift,
				employeeId,
				publishedShifts: typedPublishedShifts,
			});
			if (staffCountAfterAbsence === null) {
				continue;
			}

			if (staffCountAfterAbsence < rule.minimumStaffCount) {
				coverageRisks.push({
					date: dateKey,
					subareaId: rule.subareaId,
					subareaName: rule.subarea?.name ?? "Unknown subarea",
					startTime: rule.startTime,
					endTime: rule.endTime,
					minimumStaffCount: rule.minimumStaffCount,
					staffCountAfterAbsence,
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

function findLowestSegmentStaffCount({
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
		return null;
	}

	const candidateShifts = publishedShifts.filter(
		(publishedShift) =>
			publishedShift.employeeId &&
			publishedShift.employeeId !== employeeId &&
			publishedShift.subareaId === rule.subareaId &&
			isSameDate(publishedShift.date, affectedShift.date) &&
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

	const sortedBoundaries = [...boundaries].sort();
	let lowestStaffCount = Number.POSITIVE_INFINITY;

	for (let index = 0; index < sortedBoundaries.length - 1; index++) {
		const segmentStart = sortedBoundaries[index];
		const segmentEnd = sortedBoundaries[index + 1];
		if (!segmentStart || !segmentEnd || segmentStart === segmentEnd) {
			continue;
		}

		const assignedStaff = new Set(
			candidateShifts
				.filter(
					(publishedShift) =>
						publishedShift.startTime <= segmentStart && publishedShift.endTime >= segmentEnd,
				)
				.map((publishedShift) => publishedShift.employeeId),
		).size;

		lowestStaffCount = Math.min(lowestStaffCount, assignedStaff);
	}

	return Number.isFinite(lowestStaffCount) ? lowestStaffCount : 0;
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

function isSameDate(left: Date, right: Date) {
	return DateTime.fromJSDate(left, { zone: "utc" }).toISODate() === DateTime.fromJSDate(right, { zone: "utc" }).toISODate();
}

function dedupeCoverageRisks(risks: CoverageEvaluationInput["risks"]) {
	const risksByKey = new Map<string, CoverageEvaluationInput["risks"][number]>();
	for (const risk of risks) {
		risksByKey.set(
			[risk.date, risk.subareaId, risk.startTime, risk.endTime].join(":"),
			risk,
		);
	}

	return [...risksByKey.values()];
}
