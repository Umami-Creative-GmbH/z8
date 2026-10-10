import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	auditLog,
	closedMonthAutoCloseRun,
	closedMonthReopening,
	closedMonthSetting,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction/ranks";
import { notifyAutomaticClose, notifyBlockedAutomaticClose } from "./notifications";
import { autoCloseMonthDue, type ClosedMonthKey, firstDayOfMonth } from "./rules";
import { CLOSED_MONTH_AUDIT_ENTITY_TYPE, closeMonth } from "./store";

/**
 * Automatic close (#762): an organization setting, off by default, that closes
 * the month before organization-wide once N days have passed since it ended
 * on the organization's calendar. A blocker stops the close: everyone allowed
 * to close is told, and the next day tries again. Each organization day is
 * attempted once (`closed_month_auto_close_run`). A month that was ever
 * reopened is never closed automatically again.
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
	| { kind: "not_due" }
	| { kind: "already_attempted"; month: ClosedMonthKey }
	| { kind: "reopened_before"; month: ClosedMonthKey }
	| { kind: "closed"; month: ClosedMonthKey; employeeCount: number }
	| { kind: "nothing_to_close"; month: ClosedMonthKey }
	| { kind: "blocked"; month: ClosedMonthKey; blockerCount: number };

/** One organization's automatic close attempt for its current day. */
export async function closeMonthAutomatically(
	database: Database,
	input: { organizationId: string; afterDays: number; timezone: string; now: Instant },
): Promise<AutomaticCloseOutcome> {
	const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
	const month = autoCloseMonthDue(today, input.afterDays);
	if (!month) return { kind: "not_due" };
	const first = firstDayOfMonth(month);

	const [reopened] = await database
		.select({ id: closedMonthReopening.id })
		.from(closedMonthReopening)
		.where(
			and(
				eq(closedMonthReopening.organizationId, input.organizationId),
				eq(closedMonthReopening.month, first),
			),
		)
		.limit(1);
	if (reopened) return { kind: "reopened_before", month };

	// One attempt per organization day: a rerun neither closes nor notifies twice.
	const runDate = today.toString();
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
			const outcome = await closeMonthAutomatically(database, {
				organizationId: org.id,
				afterDays: org.afterDays,
				timezone: resolveOrganizationTimezone(org.timezone).timezone,
				now,
			});
			result.organizations += 1;
			if (outcome.kind === "closed") result.closed += 1;
			if (outcome.kind === "blocked") result.blocked += 1;
		} catch (error) {
			result.failed += 1;
			logger.error({ error, organizationId: org.id }, "Automatic month close failed");
		}
	}
	return result;
}
