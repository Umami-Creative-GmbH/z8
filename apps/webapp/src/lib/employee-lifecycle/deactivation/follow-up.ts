import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { db as appDb } from "@/db";
import { employeeDeactivation } from "@/db/schema";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type FormerEmployeeReportsWithoutManagerNotice,
	notifyFormerEmployeeReportsWithoutManager,
} from "@/lib/notifications/former-employee-reports-without-manager";
import { currentOrganizationAdminUserIds } from "@/lib/notifications/manager-notice-recipients";
import { completePendingDeactivation, reportsStillWithoutCurrentManager } from "./non-interactive";

/**
 * The follow-up deactivation (#1629, spec #1590, Organization ADR 0011): it
 * completes the pending deactivations member removal and SCIM deprovisioning
 * record (`follow-up-record.ts`) with the non-interactive runner, or withdraws
 * one whose person came back first. The employee departure maintenance runs it
 * every minute, with the release gate open or closed.
 */

type Database = typeof appDb;

const logger = createLogger("FollowUpDeactivation");

/** Pending deactivations (and owed notices) handled per run; the rest wait for the next one. */
const FOLLOW_UP_BATCH = 50;

/** One pending deactivation the follow-up completes. */
export type PendingDeactivation = {
	organizationId: string;
	employeeId: string;
	deactivationId: string;
};

/**
 * Pending deactivations, oldest first. Across organizations by design: the
 * follow-up is a system job, and each row is then completed under its own
 * organization's locks.
 */
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
	/** Notices about reports left with no current manager the admins got (or no longer need). */
	reportsNotices: number;
	failed: number;
	errors: Array<PendingDeactivation & { error: string }>;
};

export const emptyFollowUpDeactivationResult: FollowUpDeactivationResult = {
	processed: 0,
	applied: 0,
	withdrawn: 0,
	skipped: 0,
	reportsNotices: 0,
	failed: 0,
	errors: [],
};

type Notify = (notice: FormerEmployeeReportsWithoutManagerNotice) => Promise<void>;

/** A failed send throws, so the owed notice is retried; its key keeps each inbox single. */
const notifyOrThrow: Notify = (notice) =>
	notifyFormerEmployeeReportsWithoutManager(notice, { throwOnError: true });

/**
 * The follow-up deactivation: completes every pending deactivation, each in
 * its own transaction (`completePendingDeactivation`), so one failure never
 * blocks the others. A failed one stays pending and is retried on the next
 * run; a completed one is never repeated. Then it sends the notices still
 * owed (`sendOwedReportsNotices`): an applied deactivation that left reports
 * with no current manager tells the organization's current admins, retried on
 * every run until it is sent, and keyed by the list so it is sent once.
 */
export async function runFollowUpDeactivations(
	database: Database,
	options: { clock?: Clock; limit?: number; notify?: Notify } = {},
): Promise<FollowUpDeactivationResult> {
	const clock = options.clock ?? systemClock;
	const result: FollowUpDeactivationResult = {
		...emptyFollowUpDeactivationResult,
		errors: [],
	};
	for (const pending of await listPendingDeactivations(database, options)) {
		result.processed += 1;
		try {
			const outcome = await completePendingDeactivation(database, { ...pending, clock });
			result[outcome.kind] += 1;
		} catch (error) {
			recordFailure(result, pending, error, "Follow-up deactivation failed; it is retried");
		}
	}
	for (const owed of await listOwedReportsNotices(database, options)) {
		try {
			await sendReportsNotice(database, owed, { clock, notify: options.notify ?? notifyOrThrow });
			result.reportsNotices += 1;
		} catch (error) {
			recordFailure(
				result,
				owed,
				error,
				"Telling admins about reports without a manager failed; it is retried",
			);
		}
	}
	return result;
}

function recordFailure(
	result: FollowUpDeactivationResult,
	row: PendingDeactivation,
	error: unknown,
	message: string,
) {
	const { organizationId, employeeId, deactivationId } = row;
	result.failed += 1;
	result.errors.push({
		organizationId,
		employeeId,
		deactivationId,
		error: error instanceof Error ? error.message : String(error),
	});
	logger.error({ error, organizationId, employeeId, deactivationId }, message);
}

type OwedReportsNotice = PendingDeactivation & { result: unknown };

/** Applied follow-up deactivations whose admins' notice is still owed, oldest first, across organizations (a system job). */
async function listOwedReportsNotices(
	reader: Pick<Database, "select">,
	options: { limit?: number },
): Promise<OwedReportsNotice[]> {
	return reader
		.select({
			organizationId: employeeDeactivation.organizationId,
			employeeId: employeeDeactivation.employeeId,
			deactivationId: employeeDeactivation.id,
			result: employeeDeactivation.result,
		})
		.from(employeeDeactivation)
		.where(eq(employeeDeactivation.reportsNoticePending, true))
		.orderBy(
			asc(employeeDeactivation.createdAt),
			asc(employeeDeactivation.organizationId),
			asc(employeeDeactivation.id),
		)
		.limit(options.limit ?? FOLLOW_UP_BATCH);
}

/** The reports the deactivation's stored result lists as kept with no current manager. */
const storedReportsSchema = z.object({
	reportsWithoutManager: z.array(z.object({ employeeId: z.string(), name: z.string() })),
});

/**
 * Tells the organization's current admins about the reports the deactivation
 * left still without a current manager, then clears the row's marker. Throws
 * when the notice failed, keeping the marker for the next run.
 */
async function sendReportsNotice(
	database: Database,
	owed: OwedReportsNotice,
	dependencies: { clock: Clock; notify: Notify },
): Promise<void> {
	const { organizationId } = owed;
	const stored = storedReportsSchema.safeParse(owed.result);
	const now = dependencies.clock.nowInstant();
	const reports = await reportsStillWithoutCurrentManager(database, {
		organizationId,
		reports: stored.success ? stored.data.reportsWithoutManager : [],
		at: now,
	});
	if (reports.length > 0) {
		const recipientUserIds = await currentOrganizationAdminUserIds(database, {
			organizationId,
			now,
		});
		if (recipientUserIds.length > 0) {
			await dependencies.notify({ organizationId, reports, recipientUserIds });
		}
	}
	await database
		.update(employeeDeactivation)
		.set({ reportsNoticePending: false })
		.where(
			and(
				eq(employeeDeactivation.organizationId, organizationId),
				eq(employeeDeactivation.id, owed.deactivationId),
			),
		);
}
