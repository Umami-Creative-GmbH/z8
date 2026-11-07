import "server-only";

import { asc, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDeactivation } from "@/db/schema";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type FormerEmployeeReportsWithoutManagerNotice,
	notifyFormerEmployeeReportsWithoutManager,
} from "@/lib/notifications/former-employee-reports-without-manager";
import { currentOrganizationAdminUserIds } from "@/lib/notifications/manager-notice-recipients";
import {
	completePendingDeactivation,
	reportsStillWithoutCurrentManager,
} from "./non-interactive";

/**
 * The follow-up deactivation (#1629, spec #1590, Organization ADR 0011): it
 * completes the pending deactivations member removal and SCIM deprovisioning
 * record (`follow-up-record.ts`) with the non-interactive runner, or withdraws
 * one whose person came back first. The employee departure maintenance runs it
 * every minute, with the release gate open or closed.
 */

type Database = typeof appDb;

const logger = createLogger("FollowUpDeactivation");

/** Pending deactivations completed per run; the rest wait for the next one. */
const FOLLOW_UP_BATCH = 50;

/** One pending deactivation the follow-up completes. */
export type PendingDeactivation = {
	organizationId: string;
	employeeId: string;
	deactivationId: string;
};

/** Pending deactivations, oldest first, across organizations. */
export async function listPendingDeactivations(
	reader: Pick<Database, "select">,
	options: { limit?: number } = {},
): Promise<PendingDeactivation[]> {
	return reader
		.select({
			organizationId: employeeDeactivation.organizationId,
			employeeId: employeeDeactivation.employeeId,
			deactivationId: employeeDeactivation.id,
		})
		.from(employeeDeactivation)
		.where(eq(employeeDeactivation.status, "pending"))
		.orderBy(
			asc(employeeDeactivation.createdAt),
			asc(employeeDeactivation.organizationId),
			asc(employeeDeactivation.id),
		)
		.limit(options.limit ?? FOLLOW_UP_BATCH);
}

export type FollowUpDeactivationResult = {
	processed: number;
	applied: number;
	withdrawn: number;
	skipped: number;
	failed: number;
	errors: Array<PendingDeactivation & { error: string }>;
};

export const emptyFollowUpDeactivationResult: FollowUpDeactivationResult = {
	processed: 0,
	applied: 0,
	withdrawn: 0,
	skipped: 0,
	failed: 0,
	errors: [],
};

/**
 * The follow-up deactivation: completes every pending deactivation, each in
 * its own transaction (`completePendingDeactivation`), so one failure never
 * blocks the others. A failed one stays pending and is retried on the next
 * run; a completed one is never repeated. After a deactivation applied, the
 * organization's current admins hear about the reports still left with no
 * current manager (keyed by the list, so a repeat sends nothing new).
 */
export async function runFollowUpDeactivations(
	database: Database,
	options: {
		clock?: Clock;
		limit?: number;
		notify?: (
			notice: FormerEmployeeReportsWithoutManagerNotice,
		) => Promise<void>;
	} = {},
): Promise<FollowUpDeactivationResult> {
	const clock = options.clock ?? systemClock;
	const notify = options.notify ?? notifyFormerEmployeeReportsWithoutManager;
	const result: FollowUpDeactivationResult = {
		...emptyFollowUpDeactivationResult,
		errors: [],
	};
	for (const pending of await listPendingDeactivations(database, options)) {
		result.processed += 1;
		try {
			const outcome = await completePendingDeactivation(database, {
				...pending,
				clock,
			});
			result[outcome.kind] += 1;
			if (
				outcome.kind !== "applied" ||
				outcome.reportsWithoutManager.length === 0
			)
				continue;
			const now = clock.nowInstant();
			const reports = await reportsStillWithoutCurrentManager(database, {
				organizationId: pending.organizationId,
				reports: outcome.reportsWithoutManager,
				at: now,
			});
			if (reports.length === 0) continue;
			const recipientUserIds = await currentOrganizationAdminUserIds(database, {
				organizationId: pending.organizationId,
				now,
			});
			if (recipientUserIds.length === 0) continue;
			await notify({
				organizationId: pending.organizationId,
				reports,
				recipientUserIds,
			});
		} catch (error) {
			result.failed += 1;
			result.errors.push({
				...pending,
				error: error instanceof Error ? error.message : String(error),
			});
			logger.error(
				{ error, ...pending },
				"Follow-up deactivation failed; it is retried",
			);
		}
	}
	return result;
}
