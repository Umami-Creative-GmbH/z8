import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte, ne } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	organizationTimeTrackingSettings,
	timeEntry,
	userSettings,
	workPeriod,
} from "@/db/schema";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { effectiveAutoClockOutSettings } from "./automatic-clock-out/policy";
import { loadAutoClockOutSettings } from "./automatic-clock-out/settings";
import { canonicalJson } from "./canonical-json";
import { ClockingConflictError } from "./clocking-core";
import {
	AUTOMATIC_CLOCK_OUT_WRITER,
	CompletedWorkCollisionError,
	closeActiveWork,
	closeActiveWorkGraph,
	replayCloseActiveWork,
} from "./close-active-work";
import { monthClosedRefusalOf } from "./closed-months/refusal";
import { createOrdinaryApprovalRuntime } from "./ordinary-approval-runtime";
import { TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import { resolveFallbackTimezoneCapture } from "./timezone-capture";
import { withWebClockOutTransaction } from "./web-clock-out-transaction";
import { WorkIntervalError } from "./work-duration";

export type OpenPeriodCloseReason =
	| "break_in_progress"
	| "next_period_start"
	| "policy_cap"
	| "now_cap";

export type ResolvedOpenPeriodClose =
	| { ok: true; closeAt: Instant; reason: OpenPeriodCloseReason }
	| { ok: false; reason: "invalid_interval" };

export interface OpenWorkPeriodCloseEntry {
	workPeriodId: string;
	employeeId: string;
	startAt: string;
	closeAt: string;
	durationMinutes: number;
	closeReason: OpenPeriodCloseReason;
	timezone: string;
	operationId: string;
	replayed?: boolean;
}

export interface OpenWorkPeriodSkipEntry {
	workPeriodId: string;
	employeeId: string;
	startAt: string;
	reason: string;
}

export interface OpenWorkPeriodFailureEntry {
	workPeriodId: string;
	employeeId: string;
	startAt: string;
	error: string;
}

export interface OrganizationOpenWorkPeriodReport {
	organizationId: string;
	scanned: number;
	closed: OpenWorkPeriodCloseEntry[];
	skipped: OpenWorkPeriodSkipEntry[];
	failed: OpenWorkPeriodFailureEntry[];
}

export interface CloseOpenWorkPeriodsOptions {
	/** When false (default), inspects and plans closures without writing anything. */
	apply: boolean;
	/** Restrict cleanup to these organizations; omit to scan all active organizations. */
	organizationIds?: readonly string[];
	/** Close open periods whose start_time <= startedBefore. */
	startedBefore: Instant;
	/**
	 * Optional cap on closed shift duration in minutes. When omitted, each
	 * organization's configured automatic clock-out cap (default 720 min) is used.
	 */
	maxDurationMinutes?: number | null;
	clock?: Clock;
}

/**
 * Pure closure timestamp calculation for a stale open work period:
 * 1. Never closes in the future (`min(start + maxDurationMinutes, now)`).
 * 2. If a break in progress started before that cap (ADR 0007), ends work at
 *    the break start so break time never counts as work.
 * 3. If the employee already has a later work period starting before the
 *    proposed close instant, caps at that next period's start to prevent
 *    creating overlapping work intervals.
 */
export function resolveOpenPeriodCloseInstant(input: {
	start: Instant;
	breakStartedAt: Instant | null;
	nextWorkStart: Instant | null;
	maxDurationMinutes: number;
	now: Instant;
}): ResolvedOpenPeriodClose {
	const { start, breakStartedAt, nextWorkStart, maxDurationMinutes, now } = input;
	if (!Number.isSafeInteger(maxDurationMinutes) || maxDurationMinutes < 1) {
		throw new RangeError("maxDurationMinutes must be a positive integer");
	}
	const policyCap = start.add({ minutes: maxDurationMinutes });
	const cap = compareInstants(now, policyCap) < 0 ? now : policyCap;
	const capReason: OpenPeriodCloseReason =
		compareInstants(now, policyCap) < 0 ? "now_cap" : "policy_cap";

	const validNextStart =
		nextWorkStart !== null && compareInstants(nextWorkStart, start) > 0 ? nextWorkStart : null;
	const validBreakStart =
		breakStartedAt !== null &&
		compareInstants(breakStartedAt, start) > 0 &&
		compareInstants(breakStartedAt, cap) <= 0
			? breakStartedAt
			: null;

	if (validBreakStart !== null) {
		if (validNextStart !== null && compareInstants(validNextStart, validBreakStart) < 0) {
			return { ok: true, closeAt: validNextStart, reason: "next_period_start" };
		}
		return { ok: true, closeAt: validBreakStart, reason: "break_in_progress" };
	}

	if (validNextStart !== null && compareInstants(validNextStart, cap) <= 0) {
		return { ok: true, closeAt: validNextStart, reason: "next_period_start" };
	}

	if (compareInstants(cap, start) <= 0) {
		return { ok: false, reason: "invalid_interval" };
	}

	return { ok: true, closeAt: cap, reason: capReason };
}

/** Deterministic UUID v5 operation identity so retries of the cleanup script are idempotent. */
export function deriveOpenWorkPeriodCleanupOperationId(input: {
	organizationId: string;
	employeeId: string;
	workPeriodId: string;
	start: Instant;
	closeAt: Instant;
}): string {
	const identity = canonicalJson({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		workPeriodId: input.workPeriodId,
		start: instantToCanonicalString(input.start),
		closeAt: instantToCanonicalString(input.closeAt),
	});
	const bytes = new Uint8Array(
		createHash("sha1")
			.update(`z8:close-open-work-periods:v1\0${identity}`)
			.digest()
			.subarray(0, 16),
	);
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function durationMinutesBetween(start: Instant, end: Instant): number {
	return Math.max(0, Math.round((end.epochMilliseconds - start.epochMilliseconds) / 60_000));
}

function classifySkipError(error: unknown): string | null {
	const closed = monthClosedRefusalOf(error);
	if (closed) return `month_closed (${closed.month})`;
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		const reasons = error.requirement.reasons.map((reason) => reason.kind).join(", ");
		return reasons ? `append_review_required (${reasons})` : "append_review_required";
	}
	if (error instanceof ClockingConflictError) return "not_live";
	if (error instanceof WorkIntervalError) return "invalid_interval";
	if (error instanceof CompletedWorkCollisionError) return "collision";
	return null;
}

async function findNextWorkStart(
	client: Pick<typeof db, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		startTime: Date;
	},
): Promise<Instant | null> {
	const [nextPeriod] = await client
		.select({ startTime: workPeriod.startTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				ne(workPeriod.id, input.workPeriodId),
				isNull(workPeriod.deletedAt),
				gt(workPeriod.startTime, input.startTime),
			),
		)
		.orderBy(asc(workPeriod.startTime), asc(workPeriod.id))
		.limit(1);
	return nextPeriod ? instantFromDate(nextPeriod.startTime) : null;
}

/**
 * Inspects and (when `apply` is true) canonically closes open `work_period`
 * rows started on or before `startedBefore`, one work period per coordinated
 * work transaction.
 */
export async function closeOpenWorkPeriods(
	database: typeof db,
	options: CloseOpenWorkPeriodsOptions,
): Promise<OrganizationOpenWorkPeriodReport[]> {
	const clock = options.clock ?? systemClock;
	const now = clock.nowInstant();
	const cutoffDate = dateFromInstant(options.startedBefore);

	const organizations = await database
		.select({
			id: organization.id,
			timezone: organization.timezone,
			autoClockOutEnabled: organizationTimeTrackingSettings.autoClockOutEnabled,
			maxUninterruptedMinutes: organizationTimeTrackingSettings.maxUninterruptedMinutes,
			settingsRevision: organizationTimeTrackingSettings.revision,
		})
		.from(organization)
		.leftJoin(
			organizationTimeTrackingSettings,
			eq(organizationTimeTrackingSettings.organizationId, organization.id),
		)
		.where(
			and(
				isNull(organization.deletedAt),
				options.organizationIds && options.organizationIds.length > 0
					? inArray(organization.id, [...options.organizationIds])
					: undefined,
			),
		)
		.orderBy(asc(organization.id));

	const reports: OrganizationOpenWorkPeriodReport[] = [];

	for (const org of organizations) {
		const orgSettings = effectiveAutoClockOutSettings(
			org.autoClockOutEnabled !== null &&
				org.maxUninterruptedMinutes !== null &&
				org.settingsRevision !== null
				? {
						autoClockOutEnabled: org.autoClockOutEnabled,
						maxUninterruptedMinutes: org.maxUninterruptedMinutes,
						revision: org.settingsRevision,
					}
				: null,
		);

		const openRows = await database
			.select({
				id: workPeriod.id,
				employeeId: workPeriod.employeeId,
				clockInId: workPeriod.clockInId,
				startTime: workPeriod.startTime,
				isActive: workPeriod.isActive,
				clockOutId: workPeriod.clockOutId,
				breakStartedAt: workPeriod.breakStartedAt,
				teamId: employee.teamId,
				employeeUserId: employee.userId,
				userTimezone: userSettings.timezone,
				clockInType: timeEntry.type,
				clockInCreatedBy: timeEntry.createdBy,
			})
			.from(workPeriod)
			.innerJoin(
				employee,
				and(
					eq(employee.id, workPeriod.employeeId),
					eq(employee.organizationId, workPeriod.organizationId),
				),
			)
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.leftJoin(
				timeEntry,
				and(
					eq(timeEntry.id, workPeriod.clockInId),
					eq(timeEntry.organizationId, workPeriod.organizationId),
					eq(timeEntry.employeeId, workPeriod.employeeId),
				),
			)
			.where(
				and(
					eq(workPeriod.organizationId, org.id),
					isNull(workPeriod.deletedAt),
					isNull(workPeriod.endTime),
					lte(workPeriod.startTime, cutoffDate),
				),
			)
			.orderBy(asc(workPeriod.employeeId), asc(workPeriod.startTime), asc(workPeriod.id));

		const report: OrganizationOpenWorkPeriodReport = {
			organizationId: org.id,
			scanned: openRows.length,
			closed: [],
			skipped: [],
			failed: [],
		};

		for (const row of openRows) {
			const start = instantFromDate(row.startTime);
			const startAt = instantToCanonicalString(start);

			if (!row.isActive || row.clockOutId !== null) {
				report.skipped.push({
					workPeriodId: row.id,
					employeeId: row.employeeId,
					startAt,
					reason: !row.isActive
						? "anomalous_inactive_without_end_time"
						: "anomalous_clock_out_linked_without_end_time",
				});
				continue;
			}

			if (row.clockInType !== "clock_in" || !row.clockInCreatedBy) {
				report.skipped.push({
					workPeriodId: row.id,
					employeeId: row.employeeId,
					startAt,
					reason: "missing_clock_in_entry",
				});
				continue;
			}

			const maxDurationMinutes =
				options.maxDurationMinutes ?? orgSettings.maxUninterruptedMinutes;
			const nextWorkStart = await findNextWorkStart(database, {
				organizationId: org.id,
				employeeId: row.employeeId,
				workPeriodId: row.id,
				startTime: row.startTime,
			});
			const resolved = resolveOpenPeriodCloseInstant({
				start,
				breakStartedAt: row.breakStartedAt ? instantFromDate(row.breakStartedAt) : null,
				nextWorkStart,
				maxDurationMinutes,
				now,
			});

			if (!resolved.ok) {
				report.skipped.push({
					workPeriodId: row.id,
					employeeId: row.employeeId,
					startAt,
					reason: resolved.reason,
				});
				continue;
			}

			const timezone = resolveEffectiveTimezone(row.userTimezone, org.timezone);
			const operationId = deriveOpenWorkPeriodCleanupOperationId({
				organizationId: org.id,
				employeeId: row.employeeId,
				workPeriodId: row.id,
				start,
				closeAt: resolved.closeAt,
			});

			if (!options.apply) {
				report.closed.push({
					workPeriodId: row.id,
					employeeId: row.employeeId,
					startAt,
					closeAt: instantToCanonicalString(resolved.closeAt),
					durationMinutes: durationMinutesBetween(start, resolved.closeAt),
					closeReason: resolved.reason,
					timezone,
					operationId,
				});
				continue;
			}

			try {
				const outcome = await withWebClockOutTransaction(
					{
						organizationId: org.id,
						employeeId: row.employeeId,
						userId: row.clockInCreatedBy,
						ownerUserId: row.employeeUserId,
						submissionId: operationId,
						workPeriodId: row.id,
						endTime: resolved.closeAt,
					},
					createOrdinaryApprovalRuntime,
					async (coordination) => {
						const tx = coordination.db;
						const [locked] = await tx
							.select({
								id: workPeriod.id,
								clockInId: workPeriod.clockInId,
								startTime: workPeriod.startTime,
								endTime: workPeriod.endTime,
								isActive: workPeriod.isActive,
								clockOutId: workPeriod.clockOutId,
								deletedAt: workPeriod.deletedAt,
								breakStartedAt: workPeriod.breakStartedAt,
							})
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.id, row.id),
									eq(workPeriod.organizationId, org.id),
									eq(workPeriod.employeeId, row.employeeId),
								),
							)
							.limit(1);

						if (!locked || locked.deletedAt || !locked.isActive || locked.endTime || locked.clockOutId) {
							return { kind: "skipped" as const, reason: "not_live" };
						}

						const liveSettings =
							options.maxDurationMinutes ??
							(await loadAutoClockOutSettings(tx, org.id)).maxUninterruptedMinutes;
						const lockedStart = instantFromDate(locked.startTime);
						const lockedNextStart = await findNextWorkStart(tx, {
							organizationId: org.id,
							employeeId: row.employeeId,
							workPeriodId: row.id,
							startTime: locked.startTime,
						});
						const lockedResolved = resolveOpenPeriodCloseInstant({
							start: lockedStart,
							breakStartedAt: locked.breakStartedAt
								? instantFromDate(locked.breakStartedAt)
								: null,
							nextWorkStart: lockedNextStart,
							maxDurationMinutes: liveSettings,
							now: clock.nowInstant(),
						});
						if (!lockedResolved.ok) {
							return { kind: "skipped" as const, reason: lockedResolved.reason };
						}

						const committedOperationId = deriveOpenWorkPeriodCleanupOperationId({
							organizationId: org.id,
							employeeId: row.employeeId,
							workPeriodId: row.id,
							start: lockedStart,
							closeAt: lockedResolved.closeAt,
						});
						const command = {
							version: 1,
							operationId: committedOperationId,
							workPeriodId: row.id,
							requestedInstant: instantToCanonicalString(lockedResolved.closeAt),
							timezone,
							project: { kind: "preserve" as const },
							workCategory: { kind: "preserve" as const },
						};

						const replayed = await replayCloseActiveWork(coordination, {
							organizationId: org.id,
							employeeId: row.employeeId,
							command,
							writer: AUTOMATIC_CLOCK_OUT_WRITER.writer,
						});
						if (replayed) {
							return {
								kind: "closed" as const,
								entry: {
									workPeriodId: row.id,
									employeeId: row.employeeId,
									startAt: replayed.result.segment.startAt,
									closeAt: replayed.result.segment.endAt,
									durationMinutes: replayed.result.segment.durationMinutes,
									closeReason: lockedResolved.reason,
									timezone,
									operationId: committedOperationId,
									replayed: true,
								},
							};
						}

						const capture = resolveFallbackTimezoneCapture({
							timestamp: dateFromInstant(lockedResolved.closeAt),
							timezone,
							timezoneSource: "system_target_user_setting",
						});
						const closureInput = {
							organizationId: org.id,
							employeeId: row.employeeId,
							teamId: row.teamId,
							actorUserId: row.clockInCreatedBy as string,
							completingActor: {
								kind: "system" as const,
								process: "automatic_clock_out" as const,
							},
							workPeriodId: row.id,
							command,
							writer: AUTOMATIC_CLOCK_OUT_WRITER,
							eventInstant: lockedResolved.closeAt,
							capture,
							marksMissingTask: true,
						};
						const closed =
							coordination.admission === "append"
								? await closeActiveWork(coordination, closureInput)
								: await closeActiveWorkGraph(coordination, closureInput, committedOperationId);

						return {
							kind: "closed" as const,
							entry: {
								workPeriodId: row.id,
								employeeId: row.employeeId,
								startAt: closed.result.segment.startAt,
								closeAt: closed.result.segment.endAt,
								durationMinutes: closed.result.segment.durationMinutes,
								closeReason: lockedResolved.reason,
								timezone,
								operationId: committedOperationId,
							},
						};
					},
				);

				if (outcome.kind === "skipped") {
					report.skipped.push({
						workPeriodId: row.id,
						employeeId: row.employeeId,
						startAt,
						reason: outcome.reason,
					});
				} else {
					report.closed.push(outcome.entry);
				}
			} catch (error) {
				const skipReason = classifySkipError(error);
				if (skipReason) {
					report.skipped.push({
						workPeriodId: row.id,
						employeeId: row.employeeId,
						startAt,
						reason: skipReason,
					});
				} else {
					report.failed.push({
						workPeriodId: row.id,
						employeeId: row.employeeId,
						startAt,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}

		reports.push(report);
	}

	return reports;
}
