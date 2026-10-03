import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db } from "@/db";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { AutoClockOutTaskClaim, AutoClockOutTaskKind } from "./types";

const logger = createLogger("AutomaticClockOutOutbox");
function reportExhausted(scope: { organizationId: string; taskId: string; operationId: string }) {
	logger.error(
		{ ...scope, reason: "attempts_exhausted" },
		"Automatic clock-out task exhausted its attempts",
	);
}

export class AutoClockOutTaskLeaseNotOwnedError extends Error {
	constructor() {
		super("Automatic clock-out task lease is no longer owned");
		this.name = "AutoClockOutTaskLeaseNotOwnedError";
	}
}

/** A globally scanned system outbox; all individual mutations retain tenant and claim ownership. */
export function createAutoClockOutTaskOutbox(database: Pick<typeof db, "execute">) {
	const owned = (claim: AutoClockOutTaskClaim) =>
		sql`organization_id = ${claim.organizationId} AND employee_id = ${claim.employeeId}::uuid AND operation_id = ${claim.operationId}::uuid AND id = ${claim.id}::uuid AND status = 'processing' AND claim_token = ${claim.claimToken}::uuid`;
	return {
		async claimDue(now: Instant, limit: number): Promise<AutoClockOutTaskClaim[]> {
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
				throw new Error("invalid_task_limit");
			const at = dateFromInstant(now);
			// A worker that repeatedly crashes before defer must also stop at eight attempts.
			const exhausted = await database.execute<{
				id: string;
				organization_id: string;
				operation_id: string;
			}>(
				sql`UPDATE automatic_clock_out_task SET status = 'failed', claim_token = NULL, lease_expires_at = NULL, last_error = 'attempts_exhausted', updated_at = ${at} WHERE status = 'processing' AND lease_expires_at <= ${at} AND attempt_count >= 8 RETURNING id, organization_id, operation_id`,
			);
			for (const task of exhausted.rows)
				reportExhausted({
					organizationId: task.organization_id,
					taskId: task.id,
					operationId: task.operation_id,
				});
			const result = await database.execute<{
				id: string;
				organization_id: string;
				employee_id: string;
				operation_id: string;
				kind: AutoClockOutTaskKind;
				payload: Record<string, unknown>;
				claim_token: string;
				attempt_count: number;
			}>(sql`
				WITH due AS (SELECT id, organization_id FROM automatic_clock_out_task
				WHERE (status = 'pending' AND available_at <= ${at}) OR (status = 'processing' AND lease_expires_at <= ${at} AND attempt_count < 8)
				ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT ${limit})
				UPDATE automatic_clock_out_task task SET status = 'processing', claim_token = ${randomUUID()}::uuid,
				lease_expires_at = ${dateFromInstant(now.add({ minutes: 5 }))}, attempt_count = task.attempt_count + 1, updated_at = ${at}
				FROM due WHERE task.id = due.id AND task.organization_id = due.organization_id
				RETURNING task.*`);
			return result.rows.map((r) => ({
				id: r.id,
				organizationId: r.organization_id,
				employeeId: r.employee_id,
				operationId: r.operation_id,
				kind: r.kind,
				payload: r.payload,
				claimToken: r.claim_token,
				attemptCount: r.attempt_count,
			}));
		},
		async complete(claim: AutoClockOutTaskClaim, now: Instant): Promise<void> {
			const result = await database.execute(
				sql`UPDATE automatic_clock_out_task SET status = 'completed', claim_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ${dateFromInstant(now)} WHERE ${owned(claim)} RETURNING id`,
			);
			if (result.rows.length !== 1) throw new AutoClockOutTaskLeaseNotOwnedError();
		},
		async recordProgress(
			claim: AutoClockOutTaskClaim,
			now: Instant,
			patch: Record<string, unknown>,
		): Promise<void> {
			const result = await database.execute(
				sql`UPDATE automatic_clock_out_task SET payload = payload || ${JSON.stringify(patch)}::jsonb, lease_expires_at = ${dateFromInstant(now.add({ minutes: 5 }))}, updated_at = ${dateFromInstant(now)} WHERE ${owned(claim)} RETURNING id`,
			);
			if (result.rows.length !== 1) throw new AutoClockOutTaskLeaseNotOwnedError();
			Object.assign(claim.payload, patch);
		},
		async defer(
			claim: AutoClockOutTaskClaim,
			now: Instant,
			error: unknown,
		): Promise<"deferred" | "failed"> {
			const failed = claim.attemptCount >= 8;
			const seconds = Math.min(30 * 2 ** Math.max(0, claim.attemptCount - 1), 3600);
			// Transport exceptions can embed tokens, URLs, SQL and private content.
			// Persist a bounded classification only, never an untrusted error message.
			const errorText =
				error instanceof AutoClockOutTaskLeaseNotOwnedError
					? "lease_not_owned"
					: "automatic_clock_out_task_failed";
			const result = await database.execute(
				sql`UPDATE automatic_clock_out_task SET status = ${failed ? "failed" : "pending"}, claim_token = NULL, lease_expires_at = NULL, available_at = ${dateFromInstant(now.add({ seconds }))}, last_error = ${errorText}, updated_at = ${dateFromInstant(now)} WHERE ${owned(claim)} RETURNING id`,
			);
			if (result.rows.length !== 1) throw new AutoClockOutTaskLeaseNotOwnedError();
			if (failed)
				reportExhausted({
					organizationId: claim.organizationId,
					taskId: claim.id,
					operationId: claim.operationId,
				});
			return failed ? "failed" : "deferred";
		},
	};
}
