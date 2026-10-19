"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { absenceCategory, absenceEntry } from "@/db/schema";
import { calendarYearsOf } from "@/lib/absences/absence-days";
import { loadWorkingDays } from "@/lib/absences/absence-days-resolver";
import {
	type AbsencePlanPreview,
	buildAbsencePlanPreview,
	type ExistingAbsenceInput,
} from "@/lib/absences/absence-plan-preview";
import { loadAbsenceCoverageEvidence } from "@/lib/absences/coverage-evidence.server";
import {
	findAbsenceDurationIssue,
	normalizeAbsenceDurationInput,
	toAbsenceEntryDurationFields,
} from "@/lib/absences/duration";
import { loadTimeOffInLieuPreview } from "@/lib/absences/time-off-in-lieu-preview.server";
import type { AbsenceRequest } from "@/lib/absences/types";
import { isComparisonEligibleCategory } from "@/lib/absences/vacation-comparison";
import { loadVacationYearBalances } from "@/lib/absences/vacation-year-balance-store";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import {
	dateFromInstant,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { getCurrentEmployee } from "./current-employee";
import { getHolidays } from "./queries";

export type AbsencePlanPreviewRequest = AbsenceRequest;

/**
 * Why a comparison option was refused rather than evaluated (#1342). A refusal does not change on
 * retry; the client explains it instead of retrying.
 */
export type AbsenceComparisonRefusal =
	| "comparison_ineligible"
	| "invalid_option"
	/** The category is not an active category of the employee's organization. */
	| "category_unavailable";

type PlanPreviewResult =
	| { success: true; data: AbsencePlanPreview }
	| { success: false; error: string; code?: AbsenceComparisonRefusal };

type ExistingAbsenceRow = Pick<
	typeof absenceEntry.$inferSelect,
	"id" | "startDate" | "endDate" | "status"
> & {
	category: Pick<typeof absenceCategory.$inferSelect, "name">;
};

type CurrentEmployee = NonNullable<Awaited<ReturnType<typeof getCurrentEmployee>>>;
type ActiveCategory = NonNullable<Awaited<ReturnType<typeof findActiveCategory>>>;
type PreviewRange = NonNullable<ReturnType<typeof parsePreviewRange>>;

const NO_ACTIVE_EMPLOYEE = { success: false, error: "No active employee found" } as const;
const CATEGORY_NOT_FOUND = "Absence category not found";
const PREVIEW_FAILED = { success: false, error: "Unable to build absence plan preview" } as const;

export async function getAbsencePlanPreview(
	request: AbsencePlanPreviewRequest,
): Promise<PlanPreviewResult> {
	const range = parsePreviewRange(request);
	if (!range) {
		return { success: false, error: "Invalid preview date range" };
	}

	try {
		const currentEmployee = await getCurrentEmployee();
		if (!currentEmployee) return NO_ACTIVE_EMPLOYEE;

		const category = await findActiveCategory(request.categoryId, currentEmployee.organizationId);
		if (!category) return { success: false, error: CATEGORY_NOT_FOUND };

		return {
			success: true,
			data: await evaluateAbsencePlanPreview(request, range, currentEmployee, category),
		};
	} catch {
		return PREVIEW_FAILED;
	}
}

/**
 * One option of a vacation comparison (#1342): the ordinary preview of a hypothetical request,
 * refused unless its category is an active vacation category that consumes the vacation balance
 * and its dates pass the ordinary request rules. Read-only, like the ordinary preview.
 */
export async function getAbsenceComparisonPreview(
	request: AbsencePlanPreviewRequest,
): Promise<PlanPreviewResult> {
	try {
		const currentEmployee = await getCurrentEmployee();
		if (!currentEmployee) return NO_ACTIVE_EMPLOYEE;

		const invalidOption = findAbsenceDurationIssue(request);
		const range = parsePreviewRange(request);
		if (invalidOption || !range) {
			return {
				success: false,
				error: invalidOption?.message ?? "Invalid preview date range",
				code: "invalid_option",
			};
		}

		const category = await findActiveCategory(request.categoryId, currentEmployee.organizationId);
		if (!category) {
			return { success: false, error: CATEGORY_NOT_FOUND, code: "category_unavailable" };
		}
		if (!isComparisonEligibleCategory(category)) {
			return {
				success: false,
				error: "This absence type cannot be compared",
				code: "comparison_ineligible",
			};
		}

		return {
			success: true,
			data: await evaluateAbsencePlanPreview(request, range, currentEmployee, category),
		};
	} catch {
		return PREVIEW_FAILED;
	}
}

/** An active category of the organization; another organization's is never found. */
function findActiveCategory(categoryId: string, organizationId: string) {
	return db.query.absenceCategory.findFirst({
		where: and(
			eq(absenceCategory.id, categoryId),
			eq(absenceCategory.organizationId, organizationId),
			eq(absenceCategory.isActive, true),
		),
	});
}

/** The shared evaluator of both entry points; throws on a failed read outside isolated evidence. */
async function evaluateAbsencePlanPreview(
	request: AbsencePlanPreviewRequest,
	range: PreviewRange,
	currentEmployee: CurrentEmployee,
	category: ActiveCategory,
): Promise<AbsencePlanPreview> {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, currentEmployee.organizationId),
		columns: { timezone: true },
	});
	const timezone = resolveOrganizationTimezone(org?.timezone).timezone;

	const evaluatedAt = systemClock.nowInstant();
	const [vacationBalances, holidays, isWorkingDay, existingAbsences, coverageEvidence, managerId] =
		await Promise.all([
			// Every year the request touches, read at one evaluation time; each year fails alone.
			category.countsAgainstVacation
				? loadVacationYearBalances(db, {
						organizationId: currentEmployee.organizationId,
						employeeId: currentEmployee.id,
						years: calendarYearsOf(
							toAbsenceEntryDurationFields(normalizeAbsenceDurationInput(request)),
						),
						timezone,
						currentDate: dateFromInstant(evaluatedAt),
					})
				: [],
			getHolidays(currentEmployee.id, range.startDate, range.endDate),
			loadWorkingDays(db, {
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				startDate: request.startDate,
				endDate: request.endDate,
			}),
			db.query.absenceEntry.findMany({
				where: and(
					eq(absenceEntry.employeeId, currentEmployee.id),
					eq(absenceEntry.organizationId, currentEmployee.organizationId),
					lte(absenceEntry.startDate, request.endDate),
					gte(absenceEntry.endDate, request.startDate),
				),
				with: { category: true },
			}),
			// Isolated: failed coverage reads become incomplete evidence (#1341).
			loadAbsenceCoverageEvidence({
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				timezone,
				request,
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

	return buildAbsencePlanPreview({
		category: {
			id: category.id,
			name: category.name,
			requiresApproval: category.requiresApproval,
			countsAgainstVacation: category.countsAgainstVacation,
			drawsOnWorkBalance: category.drawsOnWorkBalance,
		},
		request,
		vacationBalances,
		evaluatedAt: instantToCanonicalString(evaluatedAt),
		timezone,
		holidays,
		isWorkingDay,
		existingAbsences: typedExistingAbsences.map((absence) => ({
			id: absence.id,
			startDate: absence.startDate,
			endDate: absence.endDate,
			status: absence.status,
			categoryName: absence.category.name,
		})) satisfies ExistingAbsenceInput[],
		affectedShifts: coverageEvidence.affectedShifts,
		coverage: coverageEvidence.coverage,
		hasManager: Boolean(managerId),
		workBalance,
	});
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
