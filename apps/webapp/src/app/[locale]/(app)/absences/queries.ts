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
import { getYearRange } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, Holiday, VacationBalance } from "@/lib/absences/types";
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

	const [orgAllowance, empAllowance, absences, holidays] = await Promise.all([
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
		getVacationHolidays({
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
		holidays,
		currentDate: currentTimestamp(),
		year,
		timezone,
	});
}

export async function getAbsenceEntries(
	employeeId: string,
	startDate: string,
	endDate: string,
): Promise<AbsenceWithCategory[]> {
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
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

	return absences.map((absence) =>
		mapAbsenceWithCategory({
			...(absence as unknown as AbsenceWithCategory),
			deputy: absence.deputy ? { id: absence.deputy.id, name: absence.deputy.user.name } : null,
		}),
	);
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
