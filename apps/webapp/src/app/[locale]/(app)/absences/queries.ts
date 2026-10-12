import "server-only";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	vacationAllowance,
} from "@/db/schema";
import { getAbsenceDaysByAbsenceId, loadWorkingDays } from "@/lib/absences/absence-days-resolver";
import { getYearRange } from "@/lib/absences/date-utils";
import {
	type DeputyDisplay,
	loadDeputyDisplays,
	loadDeputyViewer,
} from "@/lib/absences/deputy-display-store";
import type {
	AbsenceWithCategory,
	AbsenceWithDays,
	Holiday,
	VacationBalance,
} from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { getVacationHolidays } from "@/lib/absences/vacation-holidays";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { holidayCalendarDate } from "@/lib/holidays/recurrence";
import { mapAbsenceWithCategory } from "./mappers";

export async function getVacationBalance(
	employeeId: string,
	year: number,
	timezone = "UTC",
): Promise<VacationBalance | null> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return null;
	}

	const yearRange = getYearRange(year);
	const startOfYear = yearRange.start.toISODate() ?? `${year}-01-01`;
	const endOfYear = yearRange.end.toISODate() ?? `${year}-12-31`;

	const [orgAllowance, empAllowance, absences, isWorkingDay] = await Promise.all([
		db.query.vacationAllowance.findFirst({
			where: and(
				eq(vacationAllowance.organizationId, emp.organizationId),
				eq(vacationAllowance.isCompanyDefault, true),
				eq(vacationAllowance.isActive, true),
				lte(vacationAllowance.startDate, endOfYear),
				or(isNull(vacationAllowance.validUntil), gte(vacationAllowance.validUntil, startOfYear)),
			),
			orderBy: desc(vacationAllowance.startDate),
		}),
		db.query.employeeVacationAllowance.findFirst({
			where: and(
				eq(employeeVacationAllowance.employeeId, employeeId),
				eq(employeeVacationAllowance.year, year),
			),
		}),
		db.query.absenceEntry.findMany({
			where: and(
				or(
					isNull(absenceEntry.organizationId),
					eq(absenceEntry.organizationId, emp.organizationId),
				),
				eq(absenceEntry.employeeId, employeeId),
				lte(absenceEntry.startDate, endOfYear),
				gte(absenceEntry.endDate, startOfYear),
			),
			with: {
				category: true,
			},
		}),
		loadWorkingDays(db, {
			organizationId: emp.organizationId,
			employeeId,
			startDate: startOfYear,
			endDate: endOfYear,
		}),
	]);

	if (!orgAllowance) {
		return null;
	}

	const typedAbsences = absences as unknown as AbsenceWithCategory[];
	const absencesWithCategory = typedAbsences.map(mapAbsenceWithCategory);

	return calculateVacationBalance({
		organizationAllowance: orgAllowance,
		employeeAllowance: empAllowance,
		absences: absencesWithCategory,
		isWorkingDay,
		currentDate: currentTimestamp(),
		year,
		timezone,
	});
}

export async function getAbsenceEntries(
	employeeId: string,
	startDate: string,
	endDate: string,
): Promise<AbsenceWithDays[]> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: { organizationId: true },
	});
	if (!emp) return [];

	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			or(isNull(absenceEntry.organizationId), eq(absenceEntry.organizationId, emp.organizationId)),
			lte(absenceEntry.startDate, endDate),
			gte(absenceEntry.endDate, startDate),
		),
		with: {
			category: true,
			// The deputy of the employee's own absences (#1011): an employee of the same organization.
			deputy: { columns: { id: true }, with: { user: { columns: { name: true } } } },
		},
		orderBy: [desc(absenceEntry.startDate)],
	});

	const deputies = await loadOwnAbsenceDeputies(
		employeeId,
		absences.flatMap((absence) => (absence.deputy ? [absence.deputy.id] : [])),
	);
	const typedAbsences = absences.map((absence) =>
		mapAbsenceWithCategory({
			...(absence as unknown as AbsenceWithCategory),
			deputy: absence.deputy
				? {
						id: absence.deputy.id,
						name: absence.deputy.user.name,
						canOpenProfile: deputies.get(absence.deputy.id)?.canOpenProfile ?? false,
					}
				: null,
		}),
	);
	const absenceDays = await getAbsenceDaysByAbsenceId(db, {
		organizationId: emp.organizationId,
		absences: typedAbsences,
	});
	return typedAbsences.map((absence) => ({
		...absence,
		absenceDays: absenceDays.get(absence.id) ?? 0,
	}));
}

/** The employee's own absences' deputies, linked when the employee may open their profile (#1012). */
async function loadOwnAbsenceDeputies(employeeId: string, deputyEmployeeIds: string[]) {
	if (deputyEmployeeIds.length === 0) return new Map<string, DeputyDisplay>();
	const owner = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: { userId: true, organizationId: true },
	});
	if (!owner) return new Map<string, DeputyDisplay>();
	const viewer = await loadDeputyViewer(db, {
		organizationId: owner.organizationId,
		userId: owner.userId,
	});
	return loadDeputyDisplays(db, {
		organizationId: owner.organizationId,
		viewer,
		deputyEmployeeIds,
	});
}

export async function getHolidays(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<Holiday[]> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});
	if (!emp) return [];
	return getVacationHolidays({
		organizationId: emp.organizationId,
		employeeId,
		startDate: holidayCalendarDate(startDate).toString(),
		endDate: holidayCalendarDate(endDate).toString(),
	});
}

export async function getAbsenceCategories(organizationId: string): Promise<
	Array<{
		id: string;
		name: string;
		type: string;
		description: string | null;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
		deputyRequired: boolean;
	}>
> {
	const categories = await db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.organizationId, organizationId),
			eq(absenceCategory.isActive, true),
		),
	});

	return categories.map((c) => ({
		id: c.id,
		name: c.name,
		type: c.type,
		description: c.description,
		color: c.color,
		requiresApproval: c.requiresApproval,
		countsAgainstVacation: c.countsAgainstVacation,
		deputyRequired: c.deputyRequired,
	}));
}
