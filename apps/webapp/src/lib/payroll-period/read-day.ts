import "server-only";

import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { employee, timeRecord, timeRecordBreak, userSettings } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { resolvePeriodEmployeeIds } from "./read-period";
import type { PayrollPeriodActor, PayrollPeriodDayDetail, PayrollPeriodDayRecord } from "./types";

/**
 * The records behind one employee-day (#1894): every work and break record that
 * touches the employee's local day, with local times in the employee's zone. Read only;
 * rejected records are left out. Null when the employee is outside the actor's payroll
 * access grant scope (employees who left during or after the day included) or the
 * organization.
 */
export async function readPeriodDay(
	organizationId: string,
	actor: Pick<PayrollPeriodActor, "employeeId">,
	query: { employeeId: string; date: string },
): Promise<PayrollPeriodDayDetail | null> {
	const date = parsePlainDate(query.date).toString();
	const [employeeId] = await resolvePeriodEmployeeIds(organizationId, actor, date, {
		employeeIds: [query.employeeId],
	});
	if (!employeeId) return null;
	return readPeriodDayForEmployee(organizationId, { employeeId, date });
}

/** `readPeriodDay` for an employee already resolved through the payroll access grant. */
export async function readPeriodDayForEmployee(
	organizationId: string,
	query: { employeeId: string; date: string },
): Promise<PayrollPeriodDayDetail | null> {
	const { db } = await import("@/db");
	const [person] = await db
		.select({
			id: employee.id,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), eq(employee.id, query.employeeId)))
		.limit(1);
	if (!person) return null;

	const timezone = resolveEffectiveTimezone(person.userTimezone, person.organizationTimezone);
	const day = localDayRange(query.date, timezone);
	const rows = await db
		.select({
			id: timeRecord.id,
			kind: timeRecord.recordKind,
			approvalState: timeRecord.approvalState,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
			isPaid: timeRecordBreak.isPaid,
		})
		.from(timeRecord)
		.leftJoin(
			timeRecordBreak,
			and(
				eq(timeRecordBreak.recordId, timeRecord.id),
				eq(timeRecordBreak.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, person.id),
				inArray(timeRecord.recordKind, ["work", "break"]),
				ne(timeRecord.approvalState, "rejected"),
				lt(timeRecord.startAt, dateFromInstant(day.endExclusive)),
				or(isNull(timeRecord.endAt), gt(timeRecord.endAt, dateFromInstant(day.start))),
			),
		)
		.orderBy(asc(timeRecord.startAt), asc(timeRecord.id));

	const localTime = (value: Date) =>
		instantFromDate(value)
			.toZonedDateTimeISO(timezone)
			.toPlainDateTime()
			.toString({ smallestUnit: "minute" });

	return {
		employeeId: person.id,
		date: query.date,
		timezone,
		records: rows.flatMap((row): PayrollPeriodDayRecord[] =>
			(row.kind === "work" || row.kind === "break") && row.approvalState !== "rejected"
				? [
						{
							id: row.id,
							kind: row.kind,
							approvalState: row.approvalState,
							start: localTime(row.startAt),
							end: row.endAt ? localTime(row.endAt) : null,
							durationMinutes: row.endAt ? row.durationMinutes : null,
							isPaid: row.kind === "break" ? (row.isPaid ?? false) : null,
						},
					]
				: [],
		),
	};
}
