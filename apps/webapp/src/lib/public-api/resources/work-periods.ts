import { and, asc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { timeEntry, workPeriod } from "@/db/schema";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema, instantSchema } from "../schemas";
import { checkInstantRange, instantRangeShape, utcIso } from "./date-range";

const endpointSchema = z
	.object({
		at: instantSchema(),
		utcOffset: z
			.string()
			.describe(
				"The UTC offset where the clock event happened, such as +02:00. Use it to show local time; never the caller's zone.",
			),
	})
	.meta({ title: "WorkPeriodEndpoint" });

export const workPeriodSchema = z
	.object({
		id: idSchema(),
		employeeId: idSchema(),
		projectId: idSchema().nullable(),
		start: endpointSchema,
		end: endpointSchema.nullable().describe("Null while the work is still running."),
		durationMinutes: z.int().nullable().describe("Worked minutes; null while running."),
		approvalStatus: z
			.enum(["approved", "pending"])
			.describe("`pending` while the work waits for approval."),
	})
	.meta({ title: "WorkPeriod" });

const clockIn = alias(timeEntry, "clock_in");
const clockOut = alias(timeEntry, "clock_out");
/**
 * The sort key of the list. Writers may store sub-millisecond start times, but a
 * cursor carries milliseconds, so the list sorts and resumes on the start
 * truncated to milliseconds: a row is never compared with a rounded copy of itself.
 */
const startMillis = sql<Date>`date_trunc('milliseconds', ${workPeriod.startTime})`;

export const listWorkPeriods = defineEndpoint({
	method: "GET",
	path: "/api/v1/work-periods",
	operationId: "listWorkPeriods",
	tag: "Time entries",
	summary: "List work periods",
	description: [
		"Recorded work, one period from clock-in to clock-out, in its current state: approved corrections are applied, and raw time entries and correction history are not returned. Rejected and deleted work is left out. Running work is included with no end.",
		"",
		"Each endpoint is a UTC instant with the UTC offset where it was recorded. A break is the time between two consecutive work periods of an employee.",
		"",
		"`from` and `to` select periods by their start instant.",
	].join("\n"),
	scope: "time-entries:read",
	query: z
		.object({
			...instantRangeShape,
			employeeId: z.uuid().optional().describe("Only this employee's work."),
			...pageQueryShape,
		})
		.superRefine(checkInstantRange),
	response: pageSchema(workPeriodSchema),
	async run({ principal, query, database }) {
		const after = query.cursor ? decodeCursor(query.cursor, ["instant", "uuid"]) : null;
		if (query.cursor && !after) return invalidCursor();
		const { organizationId } = principal;
		const rows = await database
			.select({
				id: workPeriod.id,
				employeeId: workPeriod.employeeId,
				projectId: workPeriod.projectId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
				approvalStatus: workPeriod.approvalStatus,
				startOffset: clockIn.utcOffsetMinutes,
				endOffset: clockOut.utcOffsetMinutes,
			})
			.from(workPeriod)
			.innerJoin(
				clockIn,
				and(eq(clockIn.id, workPeriod.clockInId), eq(clockIn.organizationId, organizationId)),
			)
			.leftJoin(
				clockOut,
				and(eq(clockOut.id, workPeriod.clockOutId), eq(clockOut.organizationId, organizationId)),
			)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					isNull(workPeriod.deletedAt),
					ne(workPeriod.approvalStatus, "rejected"),
					gte(workPeriod.startTime, sql`${utcIso(query.from)}::timestamp`),
					lt(workPeriod.startTime, sql`${utcIso(query.to)}::timestamp`),
					query.employeeId ? eq(workPeriod.employeeId, query.employeeId) : undefined,
					after
						? sql`(${startMillis}, ${workPeriod.id}) > (${utcIso(String(after[0]))}::timestamp, ${String(after[1])}::uuid)`
						: undefined,
				),
			)
			.orderBy(asc(startMillis), asc(workPeriod.id))
			.limit(query.limit + 1);

		const page = pageOf(
			rows,
			query.limit,
			(row) => ({
				id: row.id,
				employeeId: row.employeeId,
				projectId: row.projectId,
				start: {
					at: row.startTime.toISOString(),
					utcOffset: offsetMinutesToTimeZoneId(row.startOffset),
				},
				end:
					row.endTime && row.endOffset !== null
						? { at: row.endTime.toISOString(), utcOffset: offsetMinutesToTimeZoneId(row.endOffset) }
						: null,
				durationMinutes: row.endTime ? row.durationMinutes : null,
				approvalStatus:
					row.approvalStatus === "pending" ? ("pending" as const) : ("approved" as const),
			}),
			(row) => [row.startTime.toISOString(), row.id],
		);
		return { ok: true, body: page, rowCount: page.data.length };
	},
});
