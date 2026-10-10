import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { auditLog, closedMonth, closedMonthAutoCloseRun, closedMonthSetting } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction/ranks";
import { notifyAutomaticClose, notifyBlockedAutomaticClose } from "./notifications";
import {
	type ClosedMonthKey,
	firstDayOfMonth,
	latestAutoCloseMonth,
	monthOfFirstDay,
} from "./rules";
import { CLOSED_MONTH_AUDIT_ENTITY_TYPE, closeMonth } from "./store";

/**
 * Automatic close (#762): an organization setting, off by default, that closes
 * the month before organization-wide once N days have passed since it ended
 * on the organization's calendar. A blocker stops the close: everyone allowed
 * to close is told, and the next day tries again, also after later months came
 * due. Each organization day attempts each month once
 * (`closed_month_auto_close_run`). Only months that were never closed are
 * closed, so a reopened month is never closed automatically again.
 */

const logger = createLogger("ClosedMonthAutomaticClose");

type Database = typeof appDb;

export const DEFAULT_AUTO_CLOSE_AFTER_DAYS = 5;

export interface ClosedMonthSettings {
	autoCloseEnabled: boolean;
	autoCloseAfterDays: number;
}

export async function loadClosedMonthSettings(
	database: Pick<Database, "select">,
	organizationId: string,
): Promise<ClosedMonthSettings> {
	const [row] = await database
		.select({
			autoCloseEnabled: closedMonthSetting.autoCloseEnabled,
			autoCloseAfterDays: closedMonthSetting.autoCloseAfterDays,
		})
		.from(closedMonthSetting)
		.where(eq(closedMonthSetting.organizationId, organizationId))
		.limit(1);
	return row ?? { autoCloseEnabled: false, autoCloseAfterDays: DEFAULT_AUTO_CLOSE_AFTER_DAYS };
}

/**
 * Saves the automatic close setting as organization configuration, audited in
 * the same transaction. `autoCloseAfterDays` must be a whole number of days
 * from 1 to 60.
 */
export async function saveClosedMonthSettings(
	database: Pick<Database, "transaction">,
	input: { organizationId: string; actorUserId: string; settings: ClosedMonthSettings },
): Promise<ClosedMonthSettings | { invalid: "after_days" }> {
	const { autoCloseEnabled, autoCloseAfterDays } = input.settings;
	if (!Number.isInteger(autoCloseAfterDays) || autoCloseAfterDays < 1 || autoCloseAfterDays > 60) {
		return { invalid: "after_days" };
	}
	return withOrganizationConfigurationMutation(database, input.organizationId, async (tx) => {
		const before = await loadClosedMonthSettings(tx, input.organizationId);
		await tx
			.insert(closedMonthSetting)
			.values({
				organizationId: input.organizationId,
				autoCloseEnabled,
				autoCloseAfterDays,
				updatedBy: input.actorUserId,
			})
			.onConflictDoUpdate({
				target: closedMonthSetting.organizationId,
				set: { autoCloseEnabled, autoCloseAfterDays, updatedBy: input.actorUserId },
			});
		await tx.insert(auditLog).values({
			id: randomUUID(),
			organizationId: input.organizationId,
			entityType: CLOSED_MONTH_AUDIT_ENTITY_TYPE,
			// The organization has no uuid; the setting is audited under a fresh id.
			entityId: randomUUID(),
			action: AuditAction.CLOSED_MONTH_SETTINGS_CHANGED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({ from: before, to: { autoCloseEnabled, autoCloseAfterDays } }),
		});
		return { autoCloseEnabled, autoCloseAfterDays };
	});
}

export type AutomaticCloseOutcome =
	| { kind: "already_attempted"; month: ClosedMonthKey }
	| { kind: "closed_before"; month: ClosedMonthKey }
	| { kind: "closed"; month: ClosedMonthKey; employeeCount: number }
	| { kind: "nothing_to_close"; month: ClosedMonthKey }
	| { kind: "blocked"; month: ClosedMonthKey; blockerCount: number };

/**
 * One organization's automatic close attempts for its current day: the latest
 * month due, and every earlier month an attempt found blocked, oldest first.
 */
export async function closeMonthsAutomatically(
	database: Database,
	input: { organizationId: string; afterDays: number; timezone: string; now: Instant },
): Promise<AutomaticCloseOutcome[]> {
	const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
	const latest = latestAutoCloseMonth(today, input.afterDays);
	const blocked = await database
		.select({ month: closedMonthAutoCloseRun.month })
		.from(closedMonthAutoCloseRun)
		.where(
			and(
				eq(closedMonthAutoCloseRun.organizationId, input.organizationId),
				eq(closedMonthAutoCloseRun.outcome, "blocked"),
				lt(closedMonthAutoCloseRun.month, firstDayOfMonth(latest)),
			),
		);
	const months = [...new Set([...blocked.map((row) => monthOfFirstDay(row.month)), latest])].sort();
	const outcomes: AutomaticCloseOutcome[] = [];
	// Oldest first: a month is closed before the months after it.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const month of months) {
		outcomes.push(
			await closeMonthAutomatically(database, {
				organizationId: input.organizationId,
				month,
				runDate: today.toString(),
				now: input.now,
			}),
		);
	}
	return outcomes;
}

/** One automatic close attempt of one month, at most once per organization day. */
async function closeMonthAutomatically(
	database: Database,
	input: { organizationId: string; month: ClosedMonthKey; runDate: string; now: Instant },
): Promise<AutomaticCloseOutcome> {
	const { month, runDate } = input;
	const first = firstDayOfMonth(month);

	// Only a month that was never closed, for a team or the organization.
	const [closedBefore] = await database
		.select({ id: closedMonth.id })
		.from(closedMonth)
		.where(and(eq(closedMonth.organizationId, input.organizationId), eq(closedMonth.month, first)))
		.limit(1);
	if (closedBefore) return { kind: "closed_before", month };

	// One attempt per organization day: a rerun neither closes nor notifies twice.
	const [claimed] = await database
		.insert(closedMonthAutoCloseRun)
		.values({ organizationId: input.organizationId, month: first, runDate, outcome: "pending" })
		.onConflictDoNothing()
		.returning({ id: closedMonthAutoCloseRun.id });
	if (!claimed) return { kind: "already_attempted", month };

	const result = await closeMonth(database, {
		organizationId: input.organizationId,
		month,
		scope: { kind: "organization" },
		actor: { kind: "system" },
		now: input.now,
	});
	const record = (outcome: "closed" | "blocked" | "skipped") =>
		database
			.update(closedMonthAutoCloseRun)
			.set({ outcome })
			.where(
				and(
					eq(closedMonthAutoCloseRun.organizationId, input.organizationId),
					eq(closedMonthAutoCloseRun.id, claimed.id),
				),
			);

	switch (result.kind) {
		case "closed":
			await record("closed");
			await notifyAutomaticClose(database, {
				organizationId: input.organizationId,
				month,
				employeeCount: result.employeeIds.length,
			});
			return { kind: "closed", month, employeeCount: result.employeeIds.length };
		case "blocked":
			await record("blocked");
			await notifyBlockedAutomaticClose(database, {
				organizationId: input.organizationId,
				month,
				runDate,
				blockers: result.blockers,
			});
			return { kind: "blocked", month, blockerCount: result.blockers.length };
		default:
			await record("skipped");
			return { kind: "nothing_to_close", month };
	}
}

export interface AutomaticCloseRunResult {
	organizations: number;
	closed: number;
	blocked: number;
	failed: number;
}

/**
 * The daily job: every organization with automatic close on, one at a time,
 * so one organization's failure does not stop the others.
 */
export async function runAutomaticMonthClose(
	database: Database,
	options: { now?: Instant } = {},
): Promise<AutomaticCloseRunResult> {
	const now = options.now ?? systemClock.nowInstant();
	const organizations = await database
		.select({
			id: organization.id,
			timezone: organization.timezone,
			afterDays: closedMonthSetting.autoCloseAfterDays,
		})
		.from(closedMonthSetting)
		.innerJoin(organization, eq(organization.id, closedMonthSetting.organizationId))
		.where(eq(closedMonthSetting.autoCloseEnabled, true));
	const result: AutomaticCloseRunResult = { organizations: 0, closed: 0, blocked: 0, failed: 0 };
	// One tenant at a time keeps failures and the configuration guard isolated.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const org of organizations) {
		try {
			const outcomes = await closeMonthsAutomatically(database, {
				organizationId: org.id,
				afterDays: org.afterDays,
				timezone: resolveOrganizationTimezone(org.timezone).timezone,
				now,
			});
			result.organizations += 1;
			result.closed += outcomes.filter((outcome) => outcome.kind === "closed").length;
			result.blocked += outcomes.filter((outcome) => outcome.kind === "blocked").length;
		} catch (error) {
			result.failed += 1;
			logger.error({ error, organizationId: org.id }, "Automatic month close failed");
		}
	}
	return result;
}
