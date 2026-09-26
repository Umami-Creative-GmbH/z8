import { and, asc, eq, inArray, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { employee, workBalanceRebuildIntent } from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { requestEmployeeWorkBalanceFullRebuild, type WorkBalanceDbClient } from "./service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * What a rebuild covers in its organization: every projection after an
 * organization timezone change, or one user's employees after that user's
 * timezone change (#312).
 */
export type WorkBalanceRebuildScope =
	| { reason: "organization_timezone" }
	| { reason: "user_timezone"; userId: string };

export type WorkBalanceRebuildReason = WorkBalanceRebuildScope["reason"];

export interface WorkBalanceRebuildResult {
	organizationsRebuilt: number;
	failures: Array<{ organizationId: string; error: string }>;
}

class RebuildScopeChanged extends Error {
	constructor() {
		super("Work balance rebuild scope changed while it was locked");
		this.name = "RebuildScopeChanged";
	}
}

/**
 * Records, in the caller's transaction, that the scoped balance projections of
 * the organization must be rebuilt. The configuration change and its intent
 * commit or roll back together; the rebuild itself runs separately.
 */
export async function recordWorkBalanceRebuildIntent(
	client: Pick<Transaction, "insert">,
	input: WorkBalanceRebuildScope & {
		organizationId: string;
		requestedBy: string | null;
		requestedAt: Date;
	},
) {
	await client.insert(workBalanceRebuildIntent).values({
		organizationId: input.organizationId,
		reason: input.reason,
		userId: input.reason === "user_timezone" ? input.userId : null,
		requestedBy: input.requestedBy,
		requestedAt: input.requestedAt,
	});
}

/**
 * The employees the claimed intents cover: the whole organization when any
 * intent is organization-wide, otherwise the named users' employees in it.
 */
async function scopedEmployeeIds(
	transaction: Transaction,
	organizationId: string,
	userIds: readonly string[] | null,
) {
	const rows = await transaction
		.select({ id: employee.id })
		.from(employee)
		.where(
			userIds === null
				? eq(employee.organizationId, organizationId)
				: and(eq(employee.organizationId, organizationId), inArray(employee.userId, [...userIds])),
		)
		.orderBy(asc(employee.id));
	return rows.map(({ id }) => id);
}

/**
 * One organization's rebuild: claim its pending intents (a concurrent worker
 * skips them), route the complete covered employee scope at execution, reset each
 * projection under its sorted work-balance lock, revalidate the scope, then
 * consume the claimed intents. Process loss rolls everything back and leaves the
 * intents pending. Intents committed after the claim stay pending for the next run.
 */
async function rebuildOrganization(organizationId: string, now: Date): Promise<boolean> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await db.transaction(async (transaction) => {
				const claimed = await transaction
					.select({ id: workBalanceRebuildIntent.id, userId: workBalanceRebuildIntent.userId })
					.from(workBalanceRebuildIntent)
					.where(eq(workBalanceRebuildIntent.organizationId, organizationId))
					.orderBy(asc(workBalanceRebuildIntent.requestedAt), asc(workBalanceRebuildIntent.id))
					.for("update", { skipLocked: true });
				const intentIds = claimed.map(({ id }) => id);
				if (intentIds.length === 0) return false;

				const userIds = claimed.some(({ userId }) => userId === null)
					? null
					: [...new Set(claimed.flatMap(({ userId }) => (userId ? [userId] : [])))].sort();
				const scope = await scopedEmployeeIds(transaction, organizationId, userIds);
				for (const employeeId of scope) {
					await requestEmployeeWorkBalanceFullRebuild(
						{ employeeId, organizationId },
						{ dbClient: transaction as WorkBalanceDbClient, requestedAt: now },
					);
				}
				const current = await scopedEmployeeIds(transaction, organizationId, userIds);
				if (JSON.stringify(current) !== JSON.stringify(scope)) {
					throw new RebuildScopeChanged();
				}

				await transaction
					.delete(workBalanceRebuildIntent)
					.where(inArray(workBalanceRebuildIntent.id, intentIds));
				return true;
			});
		} catch (error) {
			if (!(error instanceof RebuildScopeChanged) || attempt >= 2) throw error;
		}
	}
}

/** The database's own message, without the failed statement and its parameters. */
export function failureMessage(error: unknown): string {
	let current = error;
	while (current instanceof Error && current.cause instanceof Error) current = current.cause;
	return current instanceof Error ? current.message : String(current);
}

async function recordFailure(organizationId: string, error: string, now: Date) {
	await db.execute(
		sql`update ${workBalanceRebuildIntent} set attempts = attempts + 1, last_attempt_at = ${now}, last_error = ${error}
			where id in (select id from ${workBalanceRebuildIntent} where organization_id = ${organizationId} for update skip locked)`,
	);
}

/**
 * Executes pending rebuild intents, oldest organization first. Called after a
 * committed configuration change for its organization and by the balance worker
 * for recovery. A failure is recorded on the intent and never thrown, so it
 * cannot turn the committed change into a failure.
 */
export async function processWorkBalanceRebuildIntents(
	options: { organizationId?: string } = {},
): Promise<WorkBalanceRebuildResult> {
	const organizations = await db
		.select({ organizationId: workBalanceRebuildIntent.organizationId })
		.from(workBalanceRebuildIntent)
		.where(
			options.organizationId
				? eq(workBalanceRebuildIntent.organizationId, options.organizationId)
				: undefined,
		)
		.groupBy(workBalanceRebuildIntent.organizationId)
		.orderBy(asc(min(workBalanceRebuildIntent.requestedAt)))
		.limit(100);

	const result: WorkBalanceRebuildResult = { organizationsRebuilt: 0, failures: [] };
	for (const { organizationId } of organizations) {
		const now = dateFromInstant(systemClock.nowInstant());
		try {
			if (await rebuildOrganization(organizationId, now)) result.organizationsRebuilt += 1;
		} catch (error) {
			const message = failureMessage(error);
			result.failures.push({ organizationId, error: message });
			try {
				await recordFailure(organizationId, message, now);
			} catch {
				// The intent stays pending either way; the next run retries it.
			}
		}
	}
	return result;
}
