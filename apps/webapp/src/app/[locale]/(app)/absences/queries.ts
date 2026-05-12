"use server";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	type holiday,
	holidayAssignment,
	type holidayPreset,
	holidayPresetAssignment,
	type holidayPresetHoliday,
	vacationAllowance,
} from "@/db/schema";
import type { AbsenceWithCategory, Holiday, VacationBalance } from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { getFiscalYearRangeForLabelYear } from "@/lib/fiscal-year";
import { expandPresetHolidayForYear } from "./holiday-expansion";
import { mapAbsenceWithCategory } from "./mappers";

type HolidayAssignmentWithHoliday = {
	holiday: Pick<
		typeof holiday.$inferSelect,
		"id" | "name" | "organizationId" | "startDate" | "endDate" | "categoryId" | "isActive"
	> | null;
};

type HolidayPresetAssignmentWithPreset = {
	preset:
		| (Pick<typeof holidayPreset.$inferSelect, "isActive"> & {
				holidays: (typeof holidayPresetHoliday.$inferSelect)[];
		  })
		| null;
};

export async function getVacationBalance(
	employeeId: string,
	year: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<VacationBalance | null> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return null;
	}

	const yearRange = getFiscalYearRangeForLabelYear(year, fiscalYearStartMonth);
	const startOfYear = yearRange.start.toISODate() ?? `${year}-01-01`;
	const endOfYear = yearRange.end.toISODate() ?? `${year}-12-31`;

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

	const typedAbsences = absences as unknown as AbsenceWithCategory[];
	const absencesWithCategory = typedAbsences.map(mapAbsenceWithCategory);

	return calculateVacationBalance({
		organizationAllowance: orgAllowance,
		employeeAllowance: empAllowance,
		absences: absencesWithCategory,
		currentDate: currentTimestamp(),
		year,
		fiscalYearStartMonth,
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

	const typedAbsences = absences as unknown as AbsenceWithCategory[];
	return typedAbsences.map(mapAbsenceWithCategory);
}

export async function getHolidays(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<Holiday[]> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return [];
	}

	const assignmentScope = [eq(holidayAssignment.assignmentType, "organization")];
	if (emp.teamId) {
		assignmentScope.push(eq(holidayAssignment.teamId, emp.teamId));
	}
	assignmentScope.push(eq(holidayAssignment.employeeId, employeeId));

	const customAssignments = await db.query.holidayAssignment.findMany({
		where: and(
			eq(holidayAssignment.organizationId, emp.organizationId),
			eq(holidayAssignment.isActive, true),
			or(...assignmentScope),
		),
		with: {
			holiday: true,
		},
	});

	const presetAssignmentScope = [eq(holidayPresetAssignment.assignmentType, "organization")];
	if (emp.teamId) {
		presetAssignmentScope.push(eq(holidayPresetAssignment.teamId, emp.teamId));
	}
	presetAssignmentScope.push(eq(holidayPresetAssignment.employeeId, employeeId));

	const presetAssignments = await db.query.holidayPresetAssignment.findMany({
		where: and(
			eq(holidayPresetAssignment.organizationId, emp.organizationId),
			eq(holidayPresetAssignment.isActive, true),
			or(...presetAssignmentScope),
			or(
				isNull(holidayPresetAssignment.effectiveFrom),
				lte(holidayPresetAssignment.effectiveFrom, endDate),
			),
			or(
				isNull(holidayPresetAssignment.effectiveUntil),
				gte(holidayPresetAssignment.effectiveUntil, startDate),
			),
		),
		with: {
			preset: {
				with: {
					holidays: true,
				},
			},
		},
	});

	const holidaysByKey = new Map<string, Holiday>();

	const typedCustomAssignments = customAssignments as unknown as HolidayAssignmentWithHoliday[];
	const typedPresetAssignments =
		presetAssignments as unknown as HolidayPresetAssignmentWithPreset[];

	for (const assignment of typedCustomAssignments) {
		const assignedHoliday = assignment.holiday;
		if (
			!assignedHoliday?.isActive ||
			assignedHoliday.organizationId !== emp.organizationId ||
			assignedHoliday.startDate > endDate ||
			assignedHoliday.endDate < startDate
		) {
			continue;
		}

		holidaysByKey.set(`custom-${assignedHoliday.id}`, {
			id: assignedHoliday.id,
			name: assignedHoliday.name,
			startDate: assignedHoliday.startDate,
			endDate: assignedHoliday.endDate,
			categoryId: assignedHoliday.categoryId,
		});
	}

	const startYear = startDate.getFullYear();
	const endYear = endDate.getFullYear();
	for (const assignment of typedPresetAssignments) {
		if (!assignment.preset?.isActive) {
			continue;
		}

		for (let year = startYear; year <= endYear; year++) {
			for (const presetHoliday of assignment.preset.holidays) {
				if (!presetHoliday.isActive) {
					continue;
				}

				for (const expandedHoliday of expandPresetHolidayForYear(presetHoliday, year)) {
					if (expandedHoliday.startDate > endDate || expandedHoliday.endDate < startDate) {
						continue;
					}

					holidaysByKey.set(expandedHoliday.id, expandedHoliday);
				}
			}
		}
	}

	return [...holidaysByKey.values()].sort(
		(left, right) => left.startDate.getTime() - right.startDate.getTime(),
	);
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
