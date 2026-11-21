import "server-only";

import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { timeRecord, timeRecordBreak } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	attributeRecordsToLocalDays,
	type PayrollPeriodRecordSource,
	type PayrollPeriodRecordsByDay,
} from "./day-records";
import type { PayrollPeriodDayRecord } from "./types";

/** Employees per records query. */
const EMPLOYEE_BATCH_SIZE = 500;

/**
 * The work and break records of a payroll period, for each employee per local day
 * (#1900 day sheets): the records `readPeriodDay` shows for one employee-day, for every
 * day of the period at once. Non-rejected records touching a local day in the
 * employee's zone are on it, with local wall-clock times; a record across local
 * midnight is on each day it touches, a running record on the days up to `now`.
 *
 * `employees` must already be resolved through the payroll access grant, with the
 * effective zone the period read attributes their days in (`PayrollPeriodEmployee`).
 * One query per batch of employees; every read is filtered by `organizationId`.
 */
export async function readPeriodRecordsForEmployees(
	organizationId: string,
	query: {
		employees: readonly { id: string; timezone: string }[];
		startDate: string;
		endDate: string;
		now?: Instant;
	},
): Promise<PayrollPeriodRecordsByDay> {
	const result = new Map<string, Map<string, PayrollPeriodDayRecord[]>>();
	if (query.employees.length === 0) return result;
	const { db } = await import("@/db");
	const now = query.now ?? Temporal.Now.instant();

	for (let offset = 0; offset < query.employees.length; offset += EMPLOYEE_BATCH_SIZE) {
		const batch = query.employees.slice(offset, offset + EMPLOYEE_BATCH_SIZE);
		// The batch's widest window: from the earliest local period start to the latest end.
		const windows = batch.map((person) => ({
			start: localDayRange(query.startDate, person.timezone).start,
			endExclusive: localDayRange(query.endDate, person.timezone).endExclusive,
		}));
		const windowStart = windows
			.map((window) => window.start)
			.reduce((left, right) => (Temporal.Instant.compare(left, right) <= 0 ? left : right));
		const windowEnd = windows
			.map((window) => window.endExclusive)
			.reduce((left, right) => (Temporal.Instant.compare(left, right) >= 0 ? left : right));

		const rows = await db
			.select({
				id: timeRecord.id,
				employeeId: timeRecord.employeeId,
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
					inArray(
						timeRecord.employeeId,
						batch.map((person) => person.id),
					),
					inArray(timeRecord.recordKind, ["work", "break"]),
					ne(timeRecord.approvalState, "rejected"),
					lt(timeRecord.startAt, dateFromInstant(windowEnd)),
					or(isNull(timeRecord.endAt), gt(timeRecord.endAt, dateFromInstant(windowStart))),
				),
			)
			.orderBy(asc(timeRecord.startAt), asc(timeRecord.id));

		const byEmployee = new Map<string, PayrollPeriodRecordSource[]>();
		for (const row of rows) {
			if (row.kind !== "work" && row.kind !== "break") continue;
			if (row.approvalState === "rejected") continue;
			const source: PayrollPeriodRecordSource = {
				id: row.id,
				kind: row.kind,
				approvalState: row.approvalState,
				startAt: instantFromDate(row.startAt),
				endAt: row.endAt ? instantFromDate(row.endAt) : null,
				durationMinutes: row.durationMinutes,
				isPaid: row.isPaid,
			};
			const list = byEmployee.get(row.employeeId);
			if (list) list.push(source);
			else byEmployee.set(row.employeeId, [source]);
		}

		for (const person of batch) {
			result.set(
				person.id,
				attributeRecordsToLocalDays(byEmployee.get(person.id) ?? [], {
					timezone: person.timezone,
					startDate: query.startDate,
					endDate: query.endDate,
					now,
				}),
			);
		}
	}
	return result;
}
