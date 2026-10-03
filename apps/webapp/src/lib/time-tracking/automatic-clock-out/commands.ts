import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	automaticClockOutExecution,
	automaticClockOutTask,
	employee,
	timeEntry,
	userSettings,
	workPeriod,
} from "@/db/schema";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { createClocking } from "../clocking/clocking";
import { type ClosedLiveWork, durableFollowUps } from "../clocking/follow-ups";
import { automaticClockOutTransactions } from "../clocking/transactions";
import { runWorkTransaction, type WorkTransactionClient } from "../work-transaction";
import { deriveAutoClockOutOperationId } from "./identity";
import { autoClockOutCutoff } from "./policy";
import { loadAutoClockOutSettings } from "./settings";
import type { AutoClockOutCandidate, AutoClockOutDecision, AutoClockOutOutcome } from "./types";

function targetFilter(candidate: AutoClockOutCandidate) {
	return and(
		eq(workPeriod.organizationId, candidate.organizationId),
		eq(workPeriod.employeeId, candidate.employeeId),
		eq(workPeriod.id, candidate.workPeriodId),
	);
}

/** Scope routing reads no policy: changing a user or source entry requires a new guard set. */
async function routeTarget(tx: WorkTransactionClient, candidate: AutoClockOutCandidate) {
	const [target] = await tx
		.select({
			userId: employee.userId,
			clockInId: workPeriod.clockInId,
			provenanceUserId: timeEntry.createdBy,
		})
		.from(employee)
		.leftJoin(workPeriod, and(eq(workPeriod.employeeId, employee.id), targetFilter(candidate)))
		.leftJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, candidate.organizationId),
				eq(timeEntry.employeeId, candidate.employeeId),
			),
		)
		.where(
			and(
				eq(employee.organizationId, candidate.organizationId),
				eq(employee.id, candidate.employeeId),
			),
		)
		.limit(1);
	return {
		users: [target?.userId, target?.provenanceUserId].filter(
			(id): id is string => typeof id === "string",
		),
		employees: [candidate.employeeId],
		writeTargets: [candidate.employeeId],
		snapshot: target ?? null,
	};
}

export function createAutoClockOutCommands(deps: { database: typeof db; clock: Clock }): {
	close(candidate: AutoClockOutCandidate): Promise<AutoClockOutOutcome>;
} {
	return {
		close(candidate) {
			return runWorkTransaction<
				Awaited<ReturnType<typeof routeTarget>>,
				never,
				AutoClockOutOutcome
			>(
				{
					database: deps.database,
					organizationId: candidate.organizationId,
					route: (tx) => routeTarget(tx, candidate),
					lockRows: async (tx, route) => {
						await tx
							.select({ id: employee.id })
							.from(employee)
							.where(
								and(
									eq(employee.organizationId, candidate.organizationId),
									eq(employee.id, candidate.employeeId),
								),
							)
							.for("update");
						await tx
							.select({ id: workPeriod.id })
							.from(workPeriod)
							.where(targetFilter(candidate))
							.for("update");
						if (route.snapshot?.clockInId)
							await tx
								.select({ id: timeEntry.id })
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.organizationId, candidate.organizationId),
										eq(timeEntry.employeeId, candidate.employeeId),
										eq(timeEntry.id, route.snapshot.clockInId),
									),
								)
								.for("update");
					},
				},
				async (scope): Promise<AutoClockOutOutcome> => {
					const tx = scope.db;
					const [target] = await tx
						.select({
							person: employee,
							organizationTimezone: organization.timezone,
							userTimezone: userSettings.timezone,
						})
						.from(employee)
						.innerJoin(organization, eq(organization.id, employee.organizationId))
						.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
						.where(
							and(
								eq(employee.organizationId, candidate.organizationId),
								eq(employee.id, candidate.employeeId),
								isNull(organization.deletedAt),
							),
						)
						.limit(1);
					if (!target) return { status: "skipped", reason: "not_found" };
					// Committed evidence answers retries even after configuration changes or later edits.
					const [committed] = await tx
						.select()
						.from(automaticClockOutExecution)
						.where(
							and(
								eq(automaticClockOutExecution.organizationId, candidate.organizationId),
								eq(automaticClockOutExecution.employeeId, candidate.employeeId),
								eq(automaticClockOutExecution.workPeriodId, candidate.workPeriodId),
							),
						)
						.limit(1);
					if (committed)
						return {
							status: "replayed",
							operationId: committed.id,
							clockOutEntryId: committed.clockOutEntryId,
						};
					const [period] = await tx
						.select()
						.from(workPeriod)
						.where(targetFilter(candidate))
						.limit(1);
					if (!period || period.deletedAt) return { status: "skipped", reason: "not_found" };
					if (!period.isActive || period.endTime || period.clockOutId)
						return { status: "skipped", reason: "not_live" };
					const settings = await loadAutoClockOutSettings(tx, candidate.organizationId);
					const start = instantFromDate(period.startTime);
					const cutoff = autoClockOutCutoff(start, settings);
					if (!cutoff) return { status: "skipped", reason: "disabled" };
					if (compareInstants(deps.clock.nowInstant(), cutoff) < 0)
						return { status: "skipped", reason: "not_due" };
					const [opening] = await tx
						.select()
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, candidate.organizationId),
								eq(timeEntry.employeeId, candidate.employeeId),
								eq(timeEntry.id, period.clockInId),
							),
						)
						.limit(1);
					if (opening?.type !== "clock_in") return { status: "deferred", reason: "collision" };
					const confirmed = {
						...candidate,
						settings,
						start,
						cutoff,
						timezone: resolveEffectiveTimezone(target.userTimezone, target.organizationTimezone),
						provenanceUserId: opening.createdBy,
					};
					const decision: AutoClockOutDecision = {
						...confirmed,
						operationId: deriveAutoClockOutOperationId(confirmed),
					};
					let staged = false;
					async function stage(closure: ClosedLiveWork) {
						const [entry] = await tx
							.select()
							.from(timeEntry)
							.where(
								and(
									eq(timeEntry.organizationId, candidate.organizationId),
									eq(timeEntry.employeeId, candidate.employeeId),
									eq(timeEntry.id, decision.operationId),
								),
							)
							.limit(1);
						if (entry?.type !== "clock_out")
							throw new Error("Automatic closure has no clock-out evidence");
						const capture = (row: typeof timeEntry.$inferSelect) => ({
							timezone: row.timezone,
							utcOffsetMinutes: row.utcOffsetMinutes,
							timezoneSource: row.timezoneSource,
						});
						const processedAt = dateFromInstant(deps.clock.nowInstant());
						await tx.insert(automaticClockOutExecution).values({
							id: decision.operationId,
							...candidate,
							startTime: dateFromInstant(start),
							cutoffTime: dateFromInstant(decision.cutoff),
							maxUninterruptedMinutes: settings.maxUninterruptedMinutes,
							settingsRevision: settings.revision,
							timezone: decision.timezone,
							utcOffsetMinutes: entry.utcOffsetMinutes,
							recipientUserId: target.person.userId,
							provenanceUserId: decision.provenanceUserId,
							clockOutEntryId: entry.id,
							processedAt,
							closurePayload: {
								...closure,
								version: 1,
								reason: "automatic_clock_out",
								start: closure.start.toString(),
								end: closure.end.toString(),
								clockOutEntryId: entry.id,
								workCategoryId: period.workCategoryId,
								startCapture: capture(opening),
								endCapture: capture(entry),
							},
						});
						await tx.insert(automaticClockOutTask).values(
							(["follow_up", "plan_notification"] as const).map((kind) => ({
								organizationId: candidate.organizationId,
								employeeId: candidate.employeeId,
								operationId: decision.operationId,
								kind,
								dedupeKey: `${kind}:${decision.operationId}`,
								payload: { version: 1, operationId: decision.operationId },
								availableAt: processedAt,
								createdAt: processedAt,
								updatedAt: processedAt,
							})),
						);
						staged = true;
					}
					const outcome = await createClocking({
						clock: deps.clock,
						transactions: automaticClockOutTransactions(scope, decision),
						followUps: durableFollowUps(stage),
					}).run({
						organizationId: candidate.organizationId,
						principal: {
							kind: "automatic_clock_out",
							userId: decision.provenanceUserId,
							operationId: decision.operationId,
							workPeriodId: candidate.workPeriodId,
						},
						subject: { employeeId: candidate.employeeId },
						identity: { origin: "derived", id: decision.operationId },
						channel: "automatic-clock-out",
						at: { kind: "occurred", instant: cutoff },
						zone: { device: null, fallback: decision.timezone },
						body: {
							kind: "clock_out",
							target: { kind: "period", workPeriodId: candidate.workPeriodId },
							project: { kind: "preserve" },
							workCategory: { kind: "preserve" },
						},
					});
					if (outcome.outcome === "refused") {
						if (outcome.failure.code === "unconfirmed" || outcome.failure.code === "failed")
							throw outcome.failure.cause;
						return { status: "deferred", reason: outcome.failure.code };
					}
					if (!staged)
						throw new Error("Automatic clock-out did not stage durable execution evidence");
					return {
						status: "closed",
						operationId: decision.operationId,
						clockOutEntryId: outcome.result.id,
					};
				},
			);
		},
	};
}
