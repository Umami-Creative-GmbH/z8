"use server";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	holiday,
	vacationAllowance,
} from "@/db/schema";
import type { AbsenceWithCategory, Holiday, VacationBalance } from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { mapAbsenceWithCategory } from "./mappers";

export async function getVacationBalance(
	employeeId: string,
	year: number,
): Promise<VacationBalance | null> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return null;
	}

	const startOfYear = `${year}-01-01`;
	const endOfYear = `${year}-12-31`;

	const [orgAllowance, empAllowance, absences] = await Promise.all([
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
				eq(absenceEntry.employeeId, employeeId),
				gte(absenceEntry.startDate, startOfYear),
				lte(absenceEntry.endDate, endOfYear),
			),
			with: {
				category: true,
			},
		}),
	]);

	if (!orgAllowance) {
		return null;
	}

	const absencesWithCategory: AbsenceWithCategory[] = absences.map(mapAbsenceWithCategory);

	return calculateVacationBalance({
		organizationAllowance: orgAllowance,
		employeeAllowance: empAllowance,
		absences: absencesWithCategory,
		currentDate: currentTimestamp(),
		year,
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
			gte(absenceEntry.startDate, startDate),
			lte(absenceEntry.endDate, endDate),
		),
		with: {
			category: true,
		},
		orderBy: [desc(absenceEntry.startDate)],
	});

	return absences.map(mapAbsenceWithCategory);
}

export async function getHolidays(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<Holiday[]> {
	const holidays = await db.query.holiday.findMany({
		where: and(
			eq(holiday.organizationId, organizationId),
			gte(holiday.startDate, startDate),
			lte(holiday.endDate, endDate),
			eq(holiday.isActive, true),
		),
	});

	return holidays.map((h) => ({
		id: h.id,
		name: h.name,
		startDate: h.startDate,
		endDate: h.endDate,
		categoryId: h.categoryId,
	}));
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
	}));
}
