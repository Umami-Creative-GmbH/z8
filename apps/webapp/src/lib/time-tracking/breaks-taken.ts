import "server-only";

/**
 * Breaks already taken before one piece of completed work (#547): the reads the
 * owed-break division counts them with ("earlier breaks" for the automatic break,
 * "approved work of the local day" for the terminal break). They depend only on the
 * work's facts, never on the date they are evaluated or a viewer's zone.
 */
import { and, eq, gte, isNotNull, isNull, lt, lte, ne } from "drizzle-orm";
import type { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { breakMinutesTakenBefore } from "./automatic-break-plan";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BreaksTakenClient = Pick<Transaction, "select">;

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

/**
 * Break minutes taken on the local day the work ends on, in `zone` (the terminal
 * break's rule, #303 / #1221): the gaps of more than a minute between the employee's
 * approved, completed, kept work of that organization that starts on that day, up to
 * the work's end. The work itself counts only when it is approved and starts that day.
 */
export async function readApprovedBreakMinutesOfLocalDay(
	client: BreaksTakenClient,
	work: { organizationId: string; employeeId: string; endAt: Instant; zone: string },
): Promise<number> {
	const dayStart = work.endAt.toZonedDateTimeISO(work.zone).startOfDay();
	const nextDayStart = dayStart.add({ days: 1 });
	const dayWork = await client
		.select({ startTime: workPeriod.startTime, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, work.organizationId),
				eq(workPeriod.employeeId, work.employeeId),
				eq(workPeriod.approvalStatus, "approved"),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
				isNotNull(workPeriod.endTime),
				gte(workPeriod.startTime, dateFromInstant(dayStart.toInstant())),
				lt(workPeriod.startTime, dateFromInstant(nextDayStart.toInstant())),
				lte(workPeriod.startTime, dateFromInstant(work.endAt)),
			),
		);
	return breakMinutesTakenBefore(
		dayWork.flatMap(({ startTime, endTime }) =>
			endTime ? [{ startAt: instantFromDate(startTime), endAt: instantFromDate(endTime) }] : [],
		),
		work.endAt,
	);
}
