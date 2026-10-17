import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

export interface MfaSession {
	id: string;
	userId: string;
	impersonatedBy?: string | null;
}
export interface LocalMfaProof {
	sessionId: string;
	userId: string;
	method: "totp" | "passkey";
	factorId: string;
	verifiedAt: string;
}
export type MfaAccessDecision =
	| { allowed: true; reason: "disabled" | "grace" | "local" | "sso" }
	| { allowed: false; reason: "MFA_REQUIRED"; deadline: string | null };

/** Enrollment is deliberately absent: only live, server-verified session proof qualifies. */
export function evaluateOrganizationMfaAccess(input: {
	enabled: boolean;
	deadline: string | null;
	now: Instant;
	session: MfaSession | null;
	localProof: LocalMfaProof | null;
	ssoExempt: boolean;
}): MfaAccessDecision {
	const denied = {
		allowed: false,
		reason: "MFA_REQUIRED",
		deadline: input.deadline,
	} as const;
	if (!input.session?.id || !input.session.userId) return denied;
	if (!input.enabled) return { allowed: true, reason: "disabled" };
	const inGrace =
		!!input.deadline &&
		Temporal.Instant.compare(input.now, Temporal.Instant.from(input.deadline)) <
			0;
	if (input.session.impersonatedBy)
		return inGrace ? { allowed: true, reason: "grace" } : denied;
	if (input.ssoExempt) return { allowed: true, reason: "sso" };
	const proof = input.localProof;
	if (
		proof &&
		proof.sessionId === input.session.id &&
		proof.userId === input.session.userId &&
		Temporal.Instant.compare(
			Temporal.Instant.from(proof.verifiedAt),
			input.now,
		) <= 0
	)
		return { allowed: true, reason: "local" };
	return inGrace ? { allowed: true, reason: "grace" } : denied;
}
