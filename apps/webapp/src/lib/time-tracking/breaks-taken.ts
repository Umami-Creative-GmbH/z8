/**
 * Breaks already taken before one piece of completed work (#547): the one read the
 * adopted automatic adjustment and the legacy break enforcement share. It depends
 * only on the work's facts, never on the date it is evaluated or a viewer's zone.
 */
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { breakMinutesTakenBefore } from "./automatic-break-plan";
import { isValidIanaTimezone } from "./timezone-capture";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BreaksTakenClient = Pick<Transaction, "select">;

/** The zone an entry was captured in, or its captured offset as a fixed zone. */
export function capturedZone(entry: { timezone: string | null; utcOffsetMinutes: number }): string {
	return isValidIanaTimezone(entry.timezone)
		? entry.timezone
		: offsetMinutesToTimeZoneId(entry.utcOffsetMinutes);
}

/**
 * Break minutes taken on the work's local start day before it ends, in `startZone`
 * (the zone captured with the work's start): the gaps of more than a minute between
 * the employee's completed, kept work of that organization, the work itself included.
 */
export async function readBreakMinutesTakenBefore(
	client: BreaksTakenClient,
	work: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		startAt: Instant;
		endAt: Instant;
		startZone: string;
	},
): Promise<number> {
	const dayStart = work.startAt.toZonedDateTimeISO(work.startZone).startOfDay().toInstant();
	const dayWork = await client
		.select({ id: workPeriod.id, startTime: workPeriod.startTime, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, work.organizationId),
				eq(workPeriod.employeeId, work.employeeId),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
				ne(workPeriod.approvalStatus, "rejected"),
				gte(workPeriod.startTime, dateFromInstant(dayStart)),
				lte(workPeriod.startTime, dateFromInstant(work.endAt)),
			),
		);
	const intervals = [
		...dayWork.flatMap((other) =>
			other.id !== work.workPeriodId && other.endTime
				? [{ startAt: instantFromDate(other.startTime), endAt: instantFromDate(other.endTime) }]
				: [],
		),
		{ startAt: work.startAt, endAt: work.endAt },
	];
	return breakMinutesTakenBefore(intervals, work.endAt);
}
