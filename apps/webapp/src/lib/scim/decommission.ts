import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { SCIMManagedAuthApi } from "./managed-control-plane";

const LEASE_SECONDS = 5 * 60;
const MAX_RETRY_SECONDS = 60 * 60;

export interface SCIMDecommissionClaim {
	organizationId: string;
	connectionId: string;
	actorId: string;
	retryAt: Date;
}

export interface SCIMDecommissionStore {
	claimDue(now?: Date): Promise<SCIMDecommissionClaim | null>;
	claimDueFor?(
		organizationId: string,
		connectionId: string,
		now?: Date,
	): Promise<SCIMDecommissionClaim | null>;
	complete(claim: SCIMDecommissionClaim, now?: Date): Promise<void>;
	defer(
		claim: SCIMDecommissionClaim,
		retryAt: Date,
		error: string | null,
	): Promise<void>;
}

type SCIMDecommissionAuthApi = Pick<
	SCIMManagedAuthApi,
	"decommissionSCIMManagedConnection"
>;

function retryAtAfter(now: Date, seconds: number): Date {
	return new Date(
		Temporal.Instant.fromEpochMilliseconds(now.getTime()).add({ seconds })
			.epochMilliseconds,
	);
}

export async function runDueSCIMDecommission(input: {
	store: SCIMDecommissionStore;
	auth: { api: SCIMDecommissionAuthApi };
	now?: Date;
}): Promise<"skipped" | "completed" | "deferred"> {
	const now = input.now ?? new Date();
	const claim = await input.store.claimDue(now);
	if (!claim) return "skipped";
	try {
		const result = await input.auth.api.decommissionSCIMManagedConnection({
			body: {
				connectionId: claim.connectionId,
				provisioningDomainId: claim.organizationId,
				actorId: claim.actorId,
			},
		});
		if (result.decommission.status === "reconciling") {
			await input.store.defer(
				claim,
				result.decommission.retryAfter ?? retryAtAfter(now, 30),
				null,
			);
			return "deferred";
		}
		await input.store.complete(claim, now);
		return "completed";
	} catch {
		await input.store.defer(
			claim,
			retryAtAfter(now, 30),
			"SCIM decommission failed",
		);
		return "deferred";
	}
}

export interface SCIMDecommissionDatabase {
	execute(
		query: ReturnType<typeof sql>,
	): Promise<{ rows: Record<string, unknown>[] }>;
}

function assertOne(rows: Record<string, unknown>[]): void {
	if (rows.length !== 1)
		throw new Error("SCIM decommission lease is no longer owned");
}

export function createSCIMDecommissionStore(
	database: SCIMDecommissionDatabase,
): SCIMDecommissionStore {
	return {
		async claimDue(now = new Date()) {
			const leaseUntil = retryAtAfter(now, LEASE_SECONDS);
			const result = await database.execute(sql`
				WITH due AS (
					SELECT organization_id, connection_id, COALESCE(updated_by_user_id, created_by_user_id) AS actor_id
					FROM scim_provider_config
					WHERE state = 'decommissioning' AND connection_id IS NOT NULL
						AND decommission_retry_at <= ${now}
					ORDER BY decommission_retry_at, id
					FOR UPDATE SKIP LOCKED LIMIT 1
				)
				UPDATE scim_provider_config AS config SET decommission_retry_at = ${leaseUntil}, decommission_attempt_count = config.decommission_attempt_count + 1
				FROM due WHERE config.organization_id = due.organization_id AND config.connection_id = due.connection_id
					AND config.state = 'decommissioning' AND config.decommission_retry_at <= ${now}
				RETURNING config.organization_id AS "organizationId", config.connection_id AS "connectionId", due.actor_id AS "actorId", config.decommission_retry_at AS "retryAt"
			`);
			const row = result.rows[0];
			if (!row) return null;
			return {
				organizationId: String(row.organizationId),
				connectionId: String(row.connectionId),
				actorId: String(row.actorId),
				retryAt:
					row.retryAt instanceof Date
						? row.retryAt
						: new Date(String(row.retryAt)),
			};
		},
		async claimDueFor(organizationId, connectionId, now = new Date()) {
			const leaseUntil = retryAtAfter(now, LEASE_SECONDS);
			const result = await database.execute(sql`
				UPDATE scim_provider_config SET decommission_retry_at = ${leaseUntil}, decommission_attempt_count = decommission_attempt_count + 1
				WHERE organization_id = ${organizationId} AND connection_id = ${connectionId}
					AND state = 'decommissioning' AND decommission_retry_at <= ${now}
				RETURNING organization_id AS "organizationId", connection_id AS "connectionId", COALESCE(updated_by_user_id, created_by_user_id) AS "actorId", decommission_retry_at AS "retryAt"
			`);
			const row = result.rows[0];
			if (!row) return null;
			return {
				organizationId: String(row.organizationId),
				connectionId: String(row.connectionId),
				actorId: String(row.actorId),
				retryAt:
					row.retryAt instanceof Date
						? row.retryAt
						: new Date(String(row.retryAt)),
			};
		},
		async complete(claim, now = new Date()) {
			const result = await database.execute(sql`
				UPDATE scim_provider_config SET state = 'decommissioned', decommission_completed_at = ${now}, decommission_retry_at = NULL, decommission_last_error = NULL
				WHERE organization_id = ${claim.organizationId} AND connection_id = ${claim.connectionId}
					AND state = 'decommissioning' AND decommission_retry_at = ${claim.retryAt}
				RETURNING id
			`);
			assertOne(result.rows);
		},
		async defer(claim, retryAt, error) {
			const result = await database.execute(sql`
				UPDATE scim_provider_config SET decommission_retry_at = ${retryAt}, decommission_last_error = ${error}
				WHERE organization_id = ${claim.organizationId} AND connection_id = ${claim.connectionId}
					AND state = 'decommissioning' AND decommission_retry_at = ${claim.retryAt}
				RETURNING id
			`);
			assertOne(result.rows);
		},
	};
}

async function beginSCIMDecommission(input: {
	database: SCIMDecommissionDatabase;
	organizationId: string;
	connectionId: string;
	actorId: string;
	now?: Date;
}): Promise<boolean> {
	const now = input.now ?? new Date();
	const result = await input.database.execute(sql`
		UPDATE scim_provider_config SET state = 'decommissioning', decommission_started_at = ${now}, decommission_retry_at = ${now}, decommission_attempt_count = 0, decommission_last_error = NULL, updated_by_user_id = ${input.actorId}
		WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId} AND state = 'active'
		RETURNING id
	`);
	return result.rows.length === 1;
}

/** The Task10-facing trusted entrypoint. It durably fences the connection first. */
export async function decommissionSCIMConnection(input: {
	database: SCIMDecommissionDatabase;
	store: SCIMDecommissionStore;
	auth: { api: SCIMDecommissionAuthApi };
	organizationId: string;
	connectionId: string;
	actorId: string;
	now?: Date;
}): Promise<"skipped" | "completed" | "deferred"> {
	const started = await beginSCIMDecommission(input);
	if (!started) return "skipped";
	return runDueSCIMDecommission({
		store: {
			...input.store,
			claimDue: (now) =>
				input.store.claimDueFor?.(
					input.organizationId,
					input.connectionId,
					now,
				) ?? Promise.resolve(null),
		},
		auth: input.auth,
		now: input.now,
	});
}
