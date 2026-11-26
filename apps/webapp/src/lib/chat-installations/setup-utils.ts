import { randomBytes } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { env } from "@/env";
import { type AuditAction, logAudit } from "@/lib/audit-logger";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ChatInstallationSetupUtils");

export interface ChatSetupAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

/**
 * Generates an unguessable non-secret URL-safe route identifier for an
 * organization-owned chat installation endpoint.
 */
export function generateRouteId(): string {
	return randomBytes(18).toString("base64url");
}

/**
 * Resolves the canonical public application URL without trailing slashes.
 */
export function resolveAppUrl(override?: string): string {
	const raw = (override || env.APP_URL || "https://z8-time.app").trim();
	return raw.replace(/\/+$/, "");
}

/**
 * Computes an ISO-8601 expiry timestamp `ttlMs` after `now` using Temporal.
 */
export function computeExpiryIso(now: Date, ttlMs: number): string {
	return instantFromDate(now).add({ milliseconds: ttlMs }).toString();
}

/**
 * Checks whether a verification proof timestamp is still within both its `ttlMs`
 * window and any explicit `expiresAtIso` deadline using Temporal.
 */
export function isFreshTimestamp(
	verifiedAtIso: string | null | undefined,
	expiresAtIso: string | null | undefined,
	now: Date,
	ttlMs: number,
): boolean {
	if (!verifiedAtIso) return false;
	let verifiedInstant: Temporal.Instant;
	try {
		verifiedInstant = Temporal.Instant.from(verifiedAtIso);
	} catch {
		return false;
	}
	const nowInstant = instantFromDate(now);
	const elapsedMs = nowInstant.since(verifiedInstant).total({ unit: "milliseconds" });
	if (elapsedMs > ttlMs) return false;

	if (expiresAtIso) {
		try {
			const expiresInstant = Temporal.Instant.from(expiresAtIso);
			if (Temporal.Instant.compare(nowInstant, expiresInstant) > 0) {
				return false;
			}
		} catch {
			// Ignore malformed optional expiresAtIso and rely on verifiedAt + ttlMs.
		}
	}
	return true;
}

/**
 * Default audit logger adapter shared by chat installation setup modules.
 */
export async function defaultRecordAudit(event: ChatSetupAuditEvent): Promise<void> {
	try {
		await logAudit({
			action: event.action,
			actorId: event.actorId,
			organizationId: event.organizationId,
			targetId: event.targetId,
			targetType: "chat_installation",
			metadata: event.metadata,
			timestamp: new Date(),
		});
	} catch (error) {
		logger.warn(
			{ error, organizationId: event.organizationId, installationId: event.targetId },
			"Failed to record redacted chat installation audit log",
		);
	}
}
