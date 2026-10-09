import "server-only";

import { and, desc, eq, exists, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	type PositionStampAccessKind,
	positionStampAccessLog,
	positionStampAccessLogSubject,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { PositionCaptureClient } from "./store";

/**
 * The position stamp access log (#831, decision D4). Write one entry, in the
 * same transaction as the read, every time stamps are shown to someone other
 * than the employee: decide that with `positionStampAccess(...).logged`
 * (`./viewer`). The employee viewing their own stamps is never logged.
 */
export type PositionStampAccessInput = {
	organizationId: string;
	viewerUserId: string;
	accessedAt: Instant;
	/** The employees whose stamps were shown; each must belong to the organization. */
	subjectEmployeeIds: readonly string[];
} & (
	| { kind: "work_period_detail"; workPeriodIds: readonly string[] }
	| { kind: "data_export"; exportId: string }
);

export type PositionStampAccessEntry = {
	id: string;
	kind: PositionStampAccessKind;
	accessedAt: Instant;
	/** Null once the viewer's user account is deleted. */
	viewer: { userId: string; name: string } | null;
	subjectEmployeeIds: string[];
	/** The work periods shown; `startedAt` is null when the period no longer exists. */
	workPeriods: Array<{ id: string; startedAt: Instant | null; utcOffsetMinutes: number | null }>;
	exportId: string | null;
};

export async function recordPositionStampAccess(
	tx: Pick<PositionCaptureClient, "insert">,
	input: PositionStampAccessInput,
): Promise<{ id: string }> {
	const subjects = [...new Set(input.subjectEmployeeIds)];
	if (subjects.length === 0) {
		throw new Error("A position stamp access-log entry needs at least one employee.");
	}
	const [entry] = await tx
		.insert(positionStampAccessLog)
		.values({
			organizationId: input.organizationId,
			viewerUserId: input.viewerUserId,
			kind: input.kind,
			workPeriodIds: input.kind === "work_period_detail" ? [...new Set(input.workPeriodIds)] : [],
			exportId: input.kind === "data_export" ? input.exportId : null,
			accessedAt: dateFromInstant(input.accessedAt),
		})
		.returning({ id: positionStampAccessLog.id });
	if (!entry) throw new Error("The position stamp access-log entry was not written.");
	await tx.insert(positionStampAccessLogSubject).values(
		subjects.map((employeeId) => ({
			accessLogId: entry.id,
			organizationId: input.organizationId,
			employeeId,
		})),
	);
	return entry;
}

/**
 * The organization's access log, newest first; with `subjectEmployeeId`, only
 * the entries covering that employee (the employee's own settings section).
 * Returns ids and the viewer's account name; the works-council portal (#834)
 * applies its identity visibility to them.
 */
export async function listPositionStampAccessLog(
	db: Pick<PositionCaptureClient, "select">,
	input: { organizationId: string; subjectEmployeeId?: string; limit?: number },
): Promise<PositionStampAccessEntry[]> {
	const { organizationId, subjectEmployeeId } = input;
	const rows = await db
		.select({
			id: positionStampAccessLog.id,
			kind: positionStampAccessLog.kind,
			accessedAt: positionStampAccessLog.accessedAt,
			viewerUserId: positionStampAccessLog.viewerUserId,
			viewerName: user.name,
			workPeriodIds: positionStampAccessLog.workPeriodIds,
			exportId: positionStampAccessLog.exportId,
		})
		.from(positionStampAccessLog)
		.leftJoin(user, eq(user.id, positionStampAccessLog.viewerUserId))
		.where(
			and(
				eq(positionStampAccessLog.organizationId, organizationId),
				subjectEmployeeId
					? exists(
							db
								.select({ one: positionStampAccessLogSubject.accessLogId })
								.from(positionStampAccessLogSubject)
								.where(
									and(
										eq(positionStampAccessLogSubject.accessLogId, positionStampAccessLog.id),
										eq(positionStampAccessLogSubject.organizationId, organizationId),
										eq(positionStampAccessLogSubject.employeeId, subjectEmployeeId),
									),
								),
						)
					: undefined,
			),
		)
		.orderBy(desc(positionStampAccessLog.accessedAt), desc(positionStampAccessLog.id))
		.limit(input.limit ?? 200);
	if (rows.length === 0) return [];

	const logIds = rows.map((row) => row.id);
	const periodIds = [...new Set(rows.flatMap((row) => row.workPeriodIds))];
	const [subjects, periods] = await Promise.all([
		db
			.select({
				accessLogId: positionStampAccessLogSubject.accessLogId,
				employeeId: positionStampAccessLogSubject.employeeId,
			})
			.from(positionStampAccessLogSubject)
			.where(
				and(
					eq(positionStampAccessLogSubject.organizationId, organizationId),
					inArray(positionStampAccessLogSubject.accessLogId, logIds),
				),
			),
		periodIds.length === 0
			? Promise.resolve([])
			: db
					.select({
						id: workPeriod.id,
						startTime: workPeriod.startTime,
						utcOffsetMinutes: timeEntry.utcOffsetMinutes,
					})
					.from(workPeriod)
					.innerJoin(
						timeEntry,
						and(
							eq(timeEntry.id, workPeriod.clockInId),
							eq(timeEntry.organizationId, organizationId),
						),
					)
					.where(
						and(eq(workPeriod.organizationId, organizationId), inArray(workPeriod.id, periodIds)),
					),
	]);

	const subjectsByLog = new Map<string, string[]>();
	for (const subject of subjects) {
		const list = subjectsByLog.get(subject.accessLogId) ?? [];
		list.push(subject.employeeId);
		subjectsByLog.set(subject.accessLogId, list);
	}
	const periodById = new Map(periods.map((period) => [period.id, period]));

	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		accessedAt: instantFromDate(row.accessedAt),
		viewer:
			row.viewerUserId && row.viewerName !== null
				? { userId: row.viewerUserId, name: row.viewerName }
				: null,
		subjectEmployeeIds: (subjectsByLog.get(row.id) ?? []).sort(),
		workPeriods: row.workPeriodIds.map((id) => {
			const period = periodById.get(id);
			return {
				id,
				startedAt: period ? instantFromDate(period.startTime) : null,
				utcOffsetMinutes: period?.utcOffsetMinutes ?? null,
			};
		}),
		exportId: row.exportId,
	}));
}
