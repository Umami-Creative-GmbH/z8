import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { createLogger } from "@/lib/logger";

const CLAIM_LIMIT = 50;
const LEASE_DURATION = Temporal.Duration.from({ minutes: 5 });
const MAX_RETRY_SECONDS = 60 * 60;
const MAX_ATTEMPTS = 8;
const MAX_ERROR_LENGTH = 256;
const TERMINAL_RETRY_ERROR = "scim_seat_sync_retry_exhausted";
const logger = createLogger("SCIMSeatSyncOutbox");

export class SCIMSeatSyncOutboxLeaseNotOwnedError extends Error {
	constructor() {
		super("SCIM seat sync outbox lease is no longer owned");
	}
}

export type SCIMSeatSyncDeferOutcome = "deferred" | "exhausted";

export interface SCIMSeatSyncOutboxResult {
	claimed: number;
	completed: number;
	deferred: number;
	exhausted: number;
	persistenceFailures: number;
}

export interface SCIMSeatSyncClaim {
	id: string;
	organizationId: string;
	claimToken: string;
	attemptCount: number;
}

export interface SCIMSeatSyncOutboxStore {
	claimDue(now?: Temporal.Instant): Promise<SCIMSeatSyncClaim[]>;
	complete(claim: SCIMSeatSyncClaim, now?: Temporal.Instant): Promise<void>;
	defer(
		claim: SCIMSeatSyncClaim,
		now: Temporal.Instant,
		error: string,
	): Promise<SCIMSeatSyncDeferOutcome>;
}

interface SCIMSeatSyncDatabase {
	execute(
		query: ReturnType<typeof sql>,
	): Promise<{ rows: Record<string, unknown>[] }>;
}

function assertLeaseUpdated(rows: Array<{ id: string }>): void {
	if (rows.length !== 1) throw new SCIMSeatSyncOutboxLeaseNotOwnedError();
}

function toClaim(row: {
	id: string;
	organizationId: string;
	claimToken: string | null;
	attemptCount: number;
}): SCIMSeatSyncClaim {
	if (!row.claimToken)
		throw new Error("SCIM seat sync outbox claim token is missing");
	return {
		id: row.id,
		organizationId: row.organizationId,
		claimToken: row.claimToken,
		attemptCount: row.attemptCount,
	};
}

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

export function createSCIMSeatSyncOutboxStore(
	database: SCIMSeatSyncDatabase,
): SCIMSeatSyncOutboxStore {
	return {
		async claimDue(now = Temporal.Now.instant()) {
			const claimToken = randomUUID();
			const claimedAt = new Date(now.epochMilliseconds);
			const leaseUntil = new Date(now.add(LEASE_DURATION).epochMilliseconds);
			const result = await database.execute(sql`
				WITH due AS (
					SELECT id, organization_id
					FROM scim_billing_seat_sync_outbox
					WHERE status <> 'completed'
						AND available_at <= ${claimedAt}
						AND (status = 'pending' OR status = 'processing')
					ORDER BY available_at, created_at, id
					FOR UPDATE SKIP LOCKED
					LIMIT ${CLAIM_LIMIT}
				)
				UPDATE scim_billing_seat_sync_outbox AS outbox
				SET status = 'processing',
					available_at = ${leaseUntil},
					claimed_at = ${claimedAt},
					claim_token = ${claimToken}::uuid,
					attempt_count = outbox.attempt_count + 1,
					last_error = NULL,
					updated_at = ${claimedAt}
				FROM due
				WHERE outbox.id = due.id
					AND outbox.organization_id = due.organization_id
				RETURNING outbox.id, outbox.organization_id AS "organizationId",
					outbox.claim_token AS "claimToken", outbox.attempt_count AS "attemptCount"
			`);
			return result.rows.map((row) =>
				toClaim({
					id: String(row.id),
					organizationId: String(row.organizationId),
					claimToken:
						typeof row.claimToken === "string" ? row.claimToken : null,
					attemptCount: Number(row.attemptCount),
				}),
			);
		},

		async complete(claim, now = Temporal.Now.instant()) {
			const result = await database.execute(sql`
				UPDATE scim_billing_seat_sync_outbox
				SET status = 'completed', claim_token = NULL, claimed_at = NULL,
					processed_at = ${new Date(now.epochMilliseconds)}, updated_at = ${new Date(now.epochMilliseconds)}
				WHERE id = ${claim.id}
					AND organization_id = ${claim.organizationId}
					AND status = 'processing'
					AND claim_token = ${claim.claimToken}::uuid
				RETURNING id
			`);
			assertLeaseUpdated(result.rows as Array<{ id: string }>);
		},

		async defer(claim, now, error) {
			const backoffSeconds = Math.min(
				30 * 2 ** Math.max(claim.attemptCount - 1, 0),
				MAX_RETRY_SECONDS,
			);
			const exhausted = claim.attemptCount >= MAX_ATTEMPTS;
			const safeError = exhausted ? TERMINAL_RETRY_ERROR : safeErrorText(error);
			const result = await database.execute(sql`
				UPDATE scim_billing_seat_sync_outbox
				SET status = ${exhausted ? "completed" : "pending"},
					available_at = ${new Date(now.add({ seconds: backoffSeconds }).epochMilliseconds)},
					claimed_at = NULL, claim_token = NULL, last_error = ${safeError},
					processed_at = ${exhausted ? new Date(now.epochMilliseconds) : null},
					updated_at = ${new Date(now.epochMilliseconds)}
				WHERE id = ${claim.id}
					AND organization_id = ${claim.organizationId}
					AND status = 'processing'
					AND claim_token = ${claim.claimToken}::uuid
				RETURNING id
			`);
			assertLeaseUpdated(result.rows as Array<{ id: string }>);
			return exhausted ? "exhausted" : "deferred";
		},
	};
}

export async function runSCIMSeatSyncOutbox(input: {
	store: SCIMSeatSyncOutboxStore;
	reconcile: (
		organizationId: string,
		options: { strict: true },
	) => Promise<void>;
	now?: Temporal.Instant;
}): Promise<SCIMSeatSyncOutboxResult> {
	const now = input.now ?? Temporal.Now.instant();
	const claims = await input.store.claimDue(now);
	let completed = 0;
	let deferred = 0;
	let exhausted = 0;
	let persistenceFailures = 0;

	for (const claim of claims) {
		try {
			await input.reconcile(claim.organizationId, { strict: true });
			try {
				await input.store.complete(claim, now);
				completed++;
			} catch (error) {
				persistenceFailures++;
				logger.error(
					{
						claimId: claim.id,
						organizationId: claim.organizationId,
						errorType: error instanceof Error ? error.name : "UnknownError",
					},
					"Failed to persist SCIM seat sync completion",
				);
			}
		} catch {
			try {
				const outcome = await input.store.defer(
					claim,
					now,
					"Seat reconciliation failed",
				);
				if (outcome === "exhausted") {
					exhausted++;
					logger.error(
						{ claimId: claim.id, organizationId: claim.organizationId },
						"SCIM seat sync retries exhausted",
					);
				} else {
					deferred++;
				}
			} catch (error) {
				if (error instanceof SCIMSeatSyncOutboxLeaseNotOwnedError) continue;
				persistenceFailures++;
				logger.error(
					{
						claimId: claim.id,
						organizationId: claim.organizationId,
						errorType: error instanceof Error ? error.name : "UnknownError",
					},
					"Failed to persist SCIM seat sync retry",
				);
			}
		}
	}

	return {
		claimed: claims.length,
		completed,
		deferred,
		exhausted,
		persistenceFailures,
	};
}
