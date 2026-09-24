import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import type { DepartureTaskKind } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

const CLAIM_LIMIT = 50;
const LEASE_MINUTES = 5;
const FIRST_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 60 * 60;
const MAX_ATTEMPTS = 8;
const MAX_ERROR_LENGTH = 256;

export class DepartureTaskLeaseNotOwnedError extends Error {
	constructor() {
		super("Departure task lease is no longer owned");
		this.name = "DepartureTaskLeaseNotOwnedError";
	}
}

export type DepartureTaskClaim = {
	id: string;
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string;
	departureId: string | null;
	kind: DepartureTaskKind;
	payload: Record<string, unknown>;
	claimToken: string;
	attemptCount: number;
};

export type DepartureTaskDeferOutcome = "deferred" | "failed";

type OutboxDatabase = Pick<typeof rootDatabase, "execute">;

/**
 * PostgreSQL-owned leases for departure follow-up work. Workers claim with
 * SKIP LOCKED, so concurrent workers never share a task; a lease expires after
 * five minutes and may then be reclaimed. Completion and deferral require the
 * current claim token, so a stale worker cannot overwrite a newer outcome.
 * Exhausted work stays visible as failed for admin retry.
 */
export function createDepartureTaskOutbox(database: OutboxDatabase) {
	return {
		async claimDue(now: Instant): Promise<DepartureTaskClaim[]> {
			const claimToken = randomUUID();
			const claimedAt = dateFromInstant(now);
			const leaseUntil = dateFromInstant(now.add({ minutes: LEASE_MINUTES }));
			const result = await database.execute<{
				id: string;
				organization_id: string;
				employee_id: string;
				employment_period_id: string;
				departure_id: string | null;
				kind: DepartureTaskKind;
				payload: Record<string, unknown>;
				claim_token: string;
				attempt_count: number;
			}>(sql`
				WITH due AS (
					SELECT id, organization_id FROM employee_departure_task
					WHERE status IN ('pending', 'processing') AND available_at <= ${claimedAt}
					ORDER BY available_at, id
					FOR UPDATE SKIP LOCKED
					LIMIT ${CLAIM_LIMIT}
				)
				UPDATE employee_departure_task AS task
				SET status = 'processing', claim_token = ${claimToken}::uuid,
					available_at = ${leaseUntil}, attempt_count = task.attempt_count + 1,
					last_error = NULL, updated_at = ${claimedAt}
				FROM due
				WHERE task.id = due.id AND task.organization_id = due.organization_id
				RETURNING task.id, task.organization_id, task.employee_id, task.employment_period_id,
					task.departure_id, task.kind, task.payload, task.claim_token, task.attempt_count
			`);
			return result.rows.map((row) => ({
				id: row.id,
				organizationId: row.organization_id,
				employeeId: row.employee_id,
				employmentPeriodId: row.employment_period_id,
				departureId: row.departure_id,
				kind: row.kind,
				payload: row.payload ?? {},
				claimToken: row.claim_token,
				attemptCount: Number(row.attempt_count),
			}));
		},

		async complete(
			claim: DepartureTaskClaim,
			now: Instant,
			options: { clearPayload?: boolean } = {},
		): Promise<void> {
			const at = dateFromInstant(now);
			const result = await database.execute(sql`
				UPDATE employee_departure_task
				SET status = 'completed', claim_token = NULL, completed_at = ${at}, updated_at = ${at},
					payload = CASE WHEN ${options.clearPayload === true} THEN '{}'::jsonb ELSE payload END
				WHERE organization_id = ${claim.organizationId} AND id = ${claim.id}
					AND status = 'processing' AND claim_token = ${claim.claimToken}::uuid
				RETURNING id
			`);
			if (result.rows.length !== 1) throw new DepartureTaskLeaseNotOwnedError();
		},

		async recordProgress(
			claim: DepartureTaskClaim,
			now: Instant,
			patch: Record<string, unknown>,
		): Promise<void> {
			const result = await database.execute(sql`
				UPDATE employee_departure_task
				SET payload = payload || ${JSON.stringify(patch)}::jsonb, updated_at = ${dateFromInstant(now)}
				WHERE organization_id = ${claim.organizationId} AND id = ${claim.id}
					AND status = 'processing' AND claim_token = ${claim.claimToken}::uuid
				RETURNING id
			`);
			if (result.rows.length !== 1) throw new DepartureTaskLeaseNotOwnedError();
			Object.assign(claim.payload, patch);
		},

		/** Unsupported or unsafe work fails immediately instead of retrying. */
		async defer(
			claim: DepartureTaskClaim,
			now: Instant,
			error: unknown,
			options: { terminal?: boolean } = {},
		): Promise<DepartureTaskDeferOutcome> {
			const failed = options.terminal === true || claim.attemptCount >= MAX_ATTEMPTS;
			const backoffSeconds = Math.min(
				FIRST_RETRY_SECONDS * 2 ** Math.max(claim.attemptCount - 1, 0),
				MAX_RETRY_SECONDS,
			);
			const at = dateFromInstant(now);
			const result = await database.execute(sql`
				UPDATE employee_departure_task
				SET status = ${failed ? "failed" : "pending"}, claim_token = NULL,
					available_at = ${dateFromInstant(now.add({ seconds: backoffSeconds }))},
					last_error = ${safeErrorText(error)}, updated_at = ${at}
				WHERE organization_id = ${claim.organizationId} AND id = ${claim.id}
					AND status = 'processing' AND claim_token = ${claim.claimToken}::uuid
				RETURNING id
			`);
			if (result.rows.length !== 1) throw new DepartureTaskLeaseNotOwnedError();
			return failed ? "failed" : "deferred";
		},
	};
}

export type DepartureTaskOutbox = ReturnType<typeof createDepartureTaskOutbox>;

/** Error text only: task payloads may carry session tokens and are never logged here. */
function safeErrorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return Array.from(message)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_ERROR_LENGTH);
}
