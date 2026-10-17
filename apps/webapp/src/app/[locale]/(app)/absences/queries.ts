import "server-only";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employee } from "@/db/schema";
import { getAbsenceDaysByAbsenceId } from "@/lib/absences/absence-days-resolver";
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
	VacationBalanceConfiguration,
} from "@/lib/absences/types";
import { loadVacationBalances } from "@/lib/absences/vacation-balance-store";
import { getVacationHolidays } from "@/lib/absences/vacation-holidays";
import { holidayCalendarDate } from "@/lib/holidays/recurrence";
import { mapAbsenceWithCategory } from "./mappers";

/**
 * One employee's vacation balance for a calendar year, from the same computation as the admin
 * vacation pages (`loadVacationBalances`, #1111). Null when policy configuration cannot produce
 * a reliable balance. Callers check that the viewer may see the employee.
 */
export async function getVacationBalance(
	employeeId: string,
	year: number,
	timezone = "UTC",
): Promise<VacationBalance | null> {
	return (await getVacationBalanceResult(employeeId, year, timezone)).balance;
}

export async function getVacationBalanceResult(
	employeeId: string,
	year: number,
	timezone = "UTC",
): Promise<{
	balance: VacationBalance | null;
	configuration: VacationBalanceConfiguration | null;
}> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: { organizationId: true },
	});

	if (!emp) {
		return { balance: null, configuration: null };
	}

	const { balances, configurations } = await loadVacationBalances(db, {
		organizationId: emp.organizationId,
		employeeIds: [employeeId],
		year,
		timezone,
	});
	return {
		balance: balances.get(employeeId) ?? null,
		configuration: configurations.get(employeeId) ?? null,
	};
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
			or(
				isNull(absenceEntry.organizationId),
				eq(absenceEntry.organizationId, emp.organizationId),
			),
			lte(absenceEntry.startDate, endDate),
			gte(absenceEntry.endDate, startDate),
		),
		with: {
			category: true,
			// The deputy of the employee's own absences (#1011): an employee of the same organization.
			deputy: {
				columns: { id: true },
				with: { user: { columns: { name: true } } },
			},
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
						canOpenProfile:
							deputies.get(absence.deputy.id)?.canOpenProfile ?? false,
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
async function loadOwnAbsenceDeputies(
	employeeId: string,
	deputyEmployeeIds: string[],
) {
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
