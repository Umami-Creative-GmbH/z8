import { randomUUID } from "node:crypto";
import { and, eq, lte, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { scimProjectionRecovery } from "@/db/schema/scim";

const LEASE_DURATION = Temporal.Duration.from({ minutes: 5 });
const MAX_BACKOFF_SECONDS = 60 * 60;
const RECOVERY_ERROR_CODE = "projection_replay_failed";

export interface SCIMProjectionRecoveryClaim {
	id: string;
	organizationId: string;
	claimToken: string;
	attemptCount: number;
}

export interface SCIMProjectionRecoveryStore {
	begin(
		organizationId: string,
		now?: Temporal.Instant,
	): Promise<SCIMProjectionRecoveryClaim>;
	claimDue(
		organizationId: string,
		now?: Temporal.Instant,
	): Promise<SCIMProjectionRecoveryClaim | null>;
	complete(
		claim: SCIMProjectionRecoveryClaim,
		now?: Temporal.Instant,
	): Promise<void>;
	defer(
		claim: SCIMProjectionRecoveryClaim,
		now: Temporal.Instant,
	): Promise<void>;
}

type RecoveryDb = Pick<typeof db, "insert" | "update">;

function toClaim(
	row: typeof scimProjectionRecovery.$inferSelect,
): SCIMProjectionRecoveryClaim {
	if (!row.claimToken)
		throw new Error("SCIM projection recovery claim token is missing");
	return {
		id: row.id,
		organizationId: row.organizationId,
		claimToken: row.claimToken,
		attemptCount: row.attemptCount,
	};
}

export function createSCIMProjectionRecoveryStore(
	database: RecoveryDb,
): SCIMProjectionRecoveryStore {
	return {
		async begin(organizationId, now = Temporal.Now.instant()) {
			const claimToken = randomUUID();
			const leaseUntil = now.add(LEASE_DURATION);
			const [row] = await database
				.insert(scimProjectionRecovery)
				.values({
					organizationId,
					status: "processing",
					availableAt: new Date(leaseUntil.epochMilliseconds),
					attemptCount: 1,
					claimToken,
					claimedAt: new Date(now.epochMilliseconds),
					lastErrorCode: null,
					completedAt: null,
				})
				.onConflictDoUpdate({
					target: scimProjectionRecovery.organizationId,
					set: {
						status: "processing",
						availableAt: new Date(leaseUntil.epochMilliseconds),
						attemptCount: 1,
						claimToken,
						claimedAt: new Date(now.epochMilliseconds),
						lastErrorCode: null,
						completedAt: null,
						updatedAt: new Date(now.epochMilliseconds),
					},
				})
				.returning();
			if (!row) throw new Error("Failed to persist SCIM projection recovery");
			return toClaim(row);
		},

		async claimDue(organizationId, now = Temporal.Now.instant()) {
			const claimToken = randomUUID();
			const [row] = await database
				.update(scimProjectionRecovery)
				.set({
					status: "processing",
					availableAt: new Date(now.add(LEASE_DURATION).epochMilliseconds),
					attemptCount: sql`${scimProjectionRecovery.attemptCount} + 1`,
					claimToken,
					claimedAt: new Date(now.epochMilliseconds),
					lastErrorCode: null,
					updatedAt: new Date(now.epochMilliseconds),
				})
				.where(
					and(
						eq(scimProjectionRecovery.organizationId, organizationId),
						lte(
							scimProjectionRecovery.availableAt,
							new Date(now.epochMilliseconds),
						),
						or(
							eq(scimProjectionRecovery.status, "pending"),
							eq(scimProjectionRecovery.status, "processing"),
						),
					),
				)
				.returning();
			return row ? toClaim(row) : null;
		},

		async complete(claim, now = Temporal.Now.instant()) {
			await database
				.update(scimProjectionRecovery)
				.set({
					status: "completed",
					claimToken: null,
					claimedAt: null,
					completedAt: new Date(now.epochMilliseconds),
					updatedAt: new Date(now.epochMilliseconds),
				})
				.where(
					and(
						eq(scimProjectionRecovery.id, claim.id),
						eq(scimProjectionRecovery.organizationId, claim.organizationId),
						eq(scimProjectionRecovery.status, "processing"),
						eq(scimProjectionRecovery.claimToken, claim.claimToken),
					),
				);
		},

		async defer(claim, now) {
			const backoffSeconds = Math.min(
				30 * 2 ** Math.max(claim.attemptCount - 1, 0),
				MAX_BACKOFF_SECONDS,
			);
			await database
				.update(scimProjectionRecovery)
				.set({
					status: "pending",
					availableAt: new Date(
						now.add({ seconds: backoffSeconds }).epochMilliseconds,
					),
					claimToken: null,
					claimedAt: null,
					lastErrorCode: RECOVERY_ERROR_CODE,
					updatedAt: new Date(now.epochMilliseconds),
				})
				.where(
					and(
						eq(scimProjectionRecovery.id, claim.id),
						eq(scimProjectionRecovery.organizationId, claim.organizationId),
						eq(scimProjectionRecovery.status, "processing"),
						eq(scimProjectionRecovery.claimToken, claim.claimToken),
					),
				);
		},
	};
}

export async function retryDueSCIMProjectionRecovery(input: {
	organizationId: string;
	store: SCIMProjectionRecoveryStore;
	replay: (organizationId: string) => Promise<void>;
	now?: Temporal.Instant;
}): Promise<boolean> {
	const now = input.now ?? Temporal.Now.instant();
	const claim = await input.store.claimDue(input.organizationId, now);
	if (!claim) return false;

	try {
		await input.replay(claim.organizationId);
		await input.store.complete(claim, now);
		return true;
	} catch (error) {
		await input.store.defer(claim, now);
		throw error;
	}
}
