import "server-only";

import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { publicApiRequestLog, subscription } from "@/db/schema";
import { evaluateBillingAccess } from "@/lib/effect/services/billing/billing-access";
import { identifyApiKey } from "./keys/principal";
import type {
	KeyVerification,
	OrganizationLimitCheck,
	PublicApiDependencies,
	RateLimitState,
} from "./pipeline";

type Database = typeof db;

/** What Better Auth's `verifyApiKey` returns, as far as the pipeline reads it. */
export interface BetterAuthKeyVerification {
	valid: boolean;
	error?: { code?: string; details?: { tryAgainIn?: number } } | null;
	key?: {
		rateLimitEnabled?: boolean | null;
		rateLimitMax?: number | null;
		rateLimitTimeWindow?: number | null;
		requestCount?: number | null;
		lastRequest?: Date | string | null;
	} | null;
}

/** The key's own limit after a verified request; null when the key has none. */
export function keyLimitOf(
	key: NonNullable<BetterAuthKeyVerification["key"]>,
	now: Date,
): RateLimitState | null {
	if (key.rateLimitEnabled === false || !key.rateLimitMax || !key.rateLimitTimeWindow) return null;
	const lastRequest = key.lastRequest ? new Date(key.lastRequest).getTime() : now.getTime();
	return {
		limit: key.rateLimitMax,
		remaining: key.rateLimitMax - (key.requestCount ?? 0),
		resetAt: lastRequest + key.rateLimitTimeWindow,
	};
}

export function keyVerificationOf(
	result: BetterAuthKeyVerification,
	rateLimitMax: number | null,
	now: Date,
): KeyVerification {
	if (result.valid && result.key) return { ok: true, limit: keyLimitOf(result.key, now) };
	if (result.error?.code === "RATE_LIMITED") {
		const tryAgainIn = Math.max(0, result.error.details?.tryAgainIn ?? 0);
		return {
			ok: false,
			reason: "rate_limited",
			retryAfterSeconds: Math.max(1, Math.ceil(tryAgainIn / 1000)),
			limit: rateLimitMax
				? { limit: rateLimitMax, remaining: 0, resetAt: now.getTime() + tryAgainIn }
				: null,
		};
	}
	return { ok: false, reason: "invalid_key" };
}

export interface PublicApiCollaborators {
	database: Database;
	verifyApiKey(key: string): Promise<BetterAuthKeyVerification>;
	/** The per-organization ceiling (the shared API limiter, keyed by organization). */
	checkOrganizationLimit(organizationId: string): Promise<OrganizationLimitCheck>;
	billingEnabled(): boolean;
	clientIp(request: Request): string | null;
	now?(): Date;
	onError?: PublicApiDependencies["onError"];
}

/** Binds the pipeline to a database, key verification and limiter. */
export function createPublicApiDependencies(
	collaborators: PublicApiCollaborators,
): PublicApiDependencies {
	const { database } = collaborators;
	const now = collaborators.now ?? (() => new Date());
	return {
		database,
		now,
		clientIp: collaborators.clientIp,
		onError: collaborators.onError,
		identifyKey: (key) => identifyApiKey(database, key),
		verifyKey: async (key, identified) =>
			keyVerificationOf(await collaborators.verifyApiKey(key), identified.rateLimitMax, now()),
		checkOrganizationLimit: collaborators.checkOrganizationLimit,
		async hasBillingAccess(organizationId) {
			if (!collaborators.billingEnabled()) return true;
			// Read only: the API never provisions a trial.
			const [row] = await database
				.select({
					status: subscription.status,
					trialEnd: subscription.trialEnd,
					cancelAt: subscription.cancelAt,
				})
				.from(subscription)
				.where(eq(subscription.organizationId, organizationId))
				.limit(1);
			return evaluateBillingAccess({
				billingEnabled: true,
				subscription: row ?? null,
				now: now(),
			}).canAccess;
		},
		async recordRequest(entry) {
			await database.insert(publicApiRequestLog).values(entry);
		},
	};
}
