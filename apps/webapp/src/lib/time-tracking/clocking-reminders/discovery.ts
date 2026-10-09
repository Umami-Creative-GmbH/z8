import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	organizationClockingReminderSettings,
	shift,
	userSettings,
	workPeriod,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { clockingReminderSettingsFromRow } from "./settings";
import type { ClockingReminderRole, ClockingReminderSettings } from "./settings-policy";
import type { ReminderShift, ReminderWork } from "./shift-reminders";

type Database = Pick<typeof db, "select">;

export interface ClockingReminderOrganization {
	organizationId: string;
	/** The zone `shift.date` is keyed in and employees fall back to. */
	timezone: string;
	settings: ClockingReminderSettings;
}

/** Organizations that are not deleted and have at least one reminder type enabled. */
export async function listClockingReminderOrganizations(
	input: { after: string | null; limit: number },
	database: Database,
): Promise<ClockingReminderOrganization[]> {
	const rows = await database
		.select({ settings: organizationClockingReminderSettings, timezone: organization.timezone })
		.from(organizationClockingReminderSettings)
		.innerJoin(
			organization,
			eq(organization.id, organizationClockingReminderSettings.organizationId),
		)
		.where(
			and(
				isNull(organization.deletedAt),
				or(
					eq(organizationClockingReminderSettings.missedClockInEnabled, true),
					eq(organizationClockingReminderSettings.forgottenClockOutEnabled, true),
					eq(organizationClockingReminderSettings.breakDueEnabled, true),
				),
				input.after
					? gt(organizationClockingReminderSettings.organizationId, input.after)
					: undefined,
			),
		)
		.orderBy(asc(organizationClockingReminderSettings.organizationId))
		.limit(input.limit);
	return rows.map((row) => ({
		organizationId: row.settings.organizationId,
		timezone: resolveEffectiveTimezone(null, row.timezone),
		settings: clockingReminderSettingsFromRow(row.settings),
	}));
}

export interface ClockingReminderEmployee {
	employeeId: string;
	userId: string;
	/** The employee's own timezone, otherwise the organization's. */
	timezone: string;
}

/** Active, not departed employees of the organization whose role receives reminders. */
export async function listClockingReminderEmployees(
	input: {
		organization: ClockingReminderOrganization;
		roles: readonly ClockingReminderRole[];
		now: Instant;
		after: string | null;
		limit: number;
	},
	database: Database,
): Promise<ClockingReminderEmployee[]> {
	if (input.roles.length === 0) return [];
	const rows = await database
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			userTimezone: userSettings.timezone,
		})
		.from(employee)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organization.organizationId),
				inArray(employee.role, [...input.roles]),
				employeeHasOrganizationAccess(input.now),
				input.after ? gt(employee.id, input.after) : undefined,
			),
		)
		.orderBy(asc(employee.id))
		.limit(input.limit);
	return rows.map((row) => ({
		employeeId: row.employeeId,
		userId: row.userId,
		timezone: resolveEffectiveTimezone(row.userTimezone, input.organization.timezone),
	}));
}

/** How far back shifts and work are read: covers overnight shifts and every timezone offset. */
const LOOKBACK_DAYS = 3;
const LOOKAHEAD_DAYS = 2;

export interface ShiftReminderFacts {
	shifts: ReminderShift[];
	work: ReminderWork[];
}

/**
 * The published, assigned shifts around `now` and the recent and live work of a page of
 * employees, read without a work transaction. `shift.date` stores the organization-local midnight
 * of the shift's calendar date, so it is read back as a calendar date in the organization's zone.
 */
export async function loadShiftReminderFacts(
	input: {
		organizationId: string;
		organizationTimezone: string;
		employeeIds: readonly string[];
		now: Instant;
	},
	database: Database,
): Promise<Map<string, ShiftReminderFacts>> {
	const facts = new Map<string, ShiftReminderFacts>(
		input.employeeIds.map((id) => [id, { shifts: [], work: [] }]),
	);
	if (input.employeeIds.length === 0) return facts;
	const from = dateFromInstant(input.now.subtract({ hours: LOOKBACK_DAYS * 24 }));
	const until = dateFromInstant(input.now.add({ hours: LOOKAHEAD_DAYS * 24 }));
	const [shifts, work] = await Promise.all([
		database
			.select({
				id: shift.id,
				employeeId: shift.employeeId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.where(
				and(
					eq(shift.organizationId, input.organizationId),
					eq(shift.status, "published"),
					inArray(shift.employeeId, [...input.employeeIds]),
					gte(shift.date, from),
					lt(shift.date, until),
				),
			),
		database
			.select({
				employeeId: workPeriod.employeeId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
				live: sql<boolean>`(${workPeriod.isActive} = true AND ${workPeriod.endTime} IS NULL AND ${workPeriod.clockOutId} IS NULL)`,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, input.organizationId),
					inArray(workPeriod.employeeId, [...input.employeeIds]),
					isNull(workPeriod.deletedAt),
					or(gte(workPeriod.startTime, from), isNull(workPeriod.endTime)),
				),
			),
	]);
	for (const row of shifts) {
		if (!row.employeeId) continue;
		facts.get(row.employeeId)?.shifts.push({
			id: row.id,
			date: plainDateAt(instantFromDate(row.date), input.organizationTimezone),
			startTime: row.startTime,
			endTime: row.endTime,
		});
	}
	for (const row of work) {
		// An unended period that is not live work is not evidence of either state.
		if (row.endTime === null && !row.live) continue;
		facts.get(row.employeeId)?.work.push({
			start: instantFromDate(row.startTime),
			end: row.endTime ? instantFromDate(row.endTime) : null,
			durationMinutes: row.durationMinutes,
		});
	}
	return facts;
}
