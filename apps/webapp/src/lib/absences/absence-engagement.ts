import { and, eq, inArray } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeEmploymentPeriod,
	userSettings,
} from "@/db/schema";
import {
	type EmploymentPeriodSnapshot,
	engagementKindOnDay,
} from "@/lib/contracts/resolve-contract";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { absenceEngagementRefusal, type EngagementCategoryRefusal } from "./category-rules";

type Reader = Pick<DatabaseClient, "select">;

/**
 * The engagement kinds of the stints an absence's days fall in (#1996): one kind per
 * employee-local calendar day from `startDate` to `endDate`, decided as the contract resolver
 * decides it (`engagementKindOnDay`). Absence categories are allowed by these kinds
 * (`absenceEngagementRefusal`), never by the person's kind today. Empty when the employee is not
 * in the organization.
 */
export async function loadEngagementKindsOnDays(
	db: Reader,
	input: { organizationId: string; employeeId: string; startDate: string; endDate: string },
): Promise<Set<EngagementKind>> {
	// One after another: `db` may be a transaction on one connection.
	const [person] = await db
		.select({ engagementKind: employee.engagementKind, timezone: userSettings.timezone })
		.from(employee)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		)
		.limit(1);
	if (!person) return new Set();
	const periods = await loadPeriods(db, input.organizationId, [input.employeeId]);
	const organizationTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const employeeCalendarTimezone = resolveEffectiveTimezone(person.timezone, organizationTimezone);

	const kinds = new Set<EngagementKind>();
	const end = parsePlainDate(input.endDate);
	for (
		let day = parsePlainDate(input.startDate);
		day.until(end).days >= 0;
		day = day.add({ days: 1 })
	) {
		kinds.add(
			engagementKindOnDay({
				periods,
				day,
				employeeCalendarTimezone,
				employeeEngagementKind: person.engagementKind,
			}),
		);
		// Both kinds found: nothing further can change the decision.
		if (kinds.size > 1) break;
	}
	return kinds;
}

/**
 * Whether a recorded absence's category still fits the stints its days fall in (#1996), for
 * approving a pending request: a departure leaves pending requests in place, so the person may
 * have become a contractor (or an employee) on those days since they asked. Null when it fits or
 * the absence is not in the organization.
 */
export async function loadAbsenceEngagementRefusal(
	db: Reader,
	input: { organizationId: string; absenceId: string },
): Promise<EngagementCategoryRefusal | null> {
	const [absence] = await db
		.select({
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			categoryType: absenceCategory.type,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, absenceEntry.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.id, input.absenceId),
			),
		)
		.limit(1);
	if (!absence) return null;
	const kinds = await loadEngagementKindsOnDays(db, {
		organizationId: input.organizationId,
		employeeId: absence.employeeId,
		startDate: absence.startDate,
		endDate: absence.endDate,
	});
	return absenceEngagementRefusal(kinds, absence.categoryType);
}

/**
 * The kinds of every stint each employee had (#1996), for pickers offering absence categories
 * before dates are chosen (`categoryOfferedFor`). An employee without a recorded stint has the
 * kind of `employee.engagement_kind`. Employees outside the organization are left out.
 */
export async function loadEngagementKindsOfStints(
	db: Reader,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, EngagementKind[]>> {
	const ids = [...new Set(input.employeeIds)];
	const result = new Map<string, EngagementKind[]>();
	if (ids.length === 0) return result;
	const people = await db
		.select({ id: employee.id, engagementKind: employee.engagementKind })
		.from(employee)
		.where(and(eq(employee.organizationId, input.organizationId), inArray(employee.id, ids)));
	const periods = await loadPeriods(db, input.organizationId, ids);
	const kindsByEmployee = Map.groupBy(periods, (period) => period.employeeId);
	for (const person of people) {
		const stints = kindsByEmployee.get(person.id) ?? [];
		result.set(
			person.id,
			stints.length
				? [...new Set(stints.map((period) => period.engagementKind))]
				: [person.engagementKind],
		);
	}
	return result;
}

async function loadPeriods(
	db: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<EmploymentPeriodSnapshot[]> {
	const rows = await db
		.select({
			id: employeeEmploymentPeriod.id,
			employeeId: employeeEmploymentPeriod.employeeId,
			status: employeeEmploymentPeriod.status,
			startedAt: employeeEmploymentPeriod.startedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
			endedAt: employeeEmploymentPeriod.endedAt,
			createdAt: employeeEmploymentPeriod.createdAt,
			engagementKind: employeeEmploymentPeriod.engagementKind,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...employeeIds]),
			),
		);
	return rows.map((row) => ({
		...row,
		startedAt: row.startedAt ? instantFromDate(row.startedAt) : null,
		endedAt: row.endedAt ? instantFromDate(row.endedAt) : null,
		createdAt: instantFromDate(row.createdAt),
	}));
}
