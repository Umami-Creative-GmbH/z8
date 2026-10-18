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
	normalizeAbsenceDurationInput,
	toAbsenceEntryDurationFields,
} from "@/lib/absences/duration";
import { loadTimeOffInLieuPreview } from "@/lib/absences/time-off-in-lieu-preview.server";
import type { AbsenceRequest } from "@/lib/absences/types";
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

type PlanPreviewResult =
	| { success: true; data: AbsencePlanPreview }
	| { success: false; error: string };

type ExistingAbsenceRow = Pick<
	typeof absenceEntry.$inferSelect,
	"id" | "startDate" | "endDate" | "status"
> & {
	category: Pick<typeof absenceCategory.$inferSelect, "name">;
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

		const evaluatedAt = systemClock.nowInstant();
		const [
			vacationBalances,
			holidays,
			isWorkingDay,
			existingAbsences,
			coverageEvidence,
			managerId,
		] = await Promise.all([
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

		const data = buildAbsencePlanPreview({
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
