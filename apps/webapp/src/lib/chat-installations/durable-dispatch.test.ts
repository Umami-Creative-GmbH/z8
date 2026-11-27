import { describe, expect, it } from "vitest";
import {
	computeDurableDispatchExpiryCutoff,
	DURABLE_DISPATCH_UNKNOWN_CLOSURE_HOURS,
	DurableDispatchConfirmedUnsentError,
	DurableDispatchUncertainError,
	evaluatePriorDurableDispatchState,
	isConfirmedUnsentError,
	isUncertainDispatchError,
	sanitizeRedactedDiagnostics,
} from "./durable-dispatch";

describe("durable chat notification dispatch pure state machine & redaction", () => {
	describe("sanitizeRedactedDiagnostics", () => {
		it("retains only allowlisted diagnostic keys and strips secret-like tokens, URLs, and arbitrary payloads", () => {
			const input = {
				reason: "provider_timeout with xoxb-123456-7890-abcdef and Bearer eyJhbGciOiJIUzI1NiJ9",
				errorCode: "ECONNRESET 123456789:AAH_super_secret_telegram_token",
				errorName: "FetchError https://hooks.slack.com/services/T00/B00/XXXX",
				httpStatus: 504,
				switchedFromInstallationId: "inst-old-1",
				activeInstallationIdAtCheck: "inst-new-2",
				installationStatusAtIntent: "active",
				receiverScope: "slack-team:T123",
				legacyRecordId: "leg-1",
				closedReason: null,
				// Disallowed sensitive fields that must never survive sanitization
				botToken: "123456789:AAH_must_not_leak",
				signingSecret: "deadbeefcafebabe1234567890abcdef",
				authorization: "Bearer secret-jwt",
				messageBody: "Private employee notification text",
				rawError: "full raw error stack",
			} as Record<string, unknown>;

			const sanitized = sanitizeRedactedDiagnostics(input);
			const serialized = JSON.stringify(sanitized);

			expect(sanitized).toEqual({
				reason: "provider_timeout with [redacted] and [redacted]",
				errorCode: "ECONNRESET [redacted]",
				errorName: "FetchError [redacted]",
				httpStatus: 504,
				switchedFromInstallationId: "inst-old-1",
				activeInstallationIdAtCheck: "inst-new-2",
				installationStatusAtIntent: "active",
				receiverScope: "slack-team:T123",
				legacyRecordId: "leg-1",
				closedReason: null,
			});
			expect(serialized).not.toContain("xoxb-");
			expect(serialized).not.toContain("AAH_");
			expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
			expect(serialized).not.toContain("hooks.slack.com");
			expect(serialized).not.toContain("deadbeefcafebabe");
			expect(serialized).not.toContain("Private employee notification text");
			expect(serialized).not.toContain("botToken");
			expect(serialized).not.toContain("signingSecret");
		});

		it("drops invalid httpStatus values and bounds overly long strings", () => {
			const sanitized = sanitizeRedactedDiagnostics({
				reason: "a".repeat(500),
				httpStatus: 9999,
			});
			expect(sanitized.httpStatus).toBeUndefined();
			expect(sanitized.reason?.length).toBeLessThanOrEqual(160);
		});
	});

	describe("evaluatePriorDurableDispatchState", () => {
		it("allows a fresh attempt when no prior attempt exists", () => {
			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: null,
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({ action: "create_attempt", nextAttemptNumber: 1 });
		});

		it("allows safe reroute under the existing dedupe key ONLY when prior attempt is confirmed_unsent", () => {
			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-1",
						status: "confirmed_unsent",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({
				action: "create_attempt",
				nextAttemptNumber: 2,
				reroutedFromAttemptId: "att-1",
				switchedFromInstallationId: "inst-old",
			});
		});

		it("quarantines an existing intent_recorded attempt to reconciliation_required and never allows resend", () => {
			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-1",
						status: "intent_recorded",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({
				action: "quarantine_uncertain",
				installationSwitched: true,
			});

			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-1",
						status: "intent_recorded",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-old",
				}),
			).toEqual({
				action: "quarantine_uncertain",
				installationSwitched: false,
			});
		});

		it("blocks resend for sent, reconciliation_required, and closed_unknown attempts", () => {
			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-1",
						status: "sent",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({ action: "already_sent" });

			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-2",
						status: "reconciliation_required",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({ action: "already_reconciliation_required", installationSwitched: true });

			expect(
				evaluatePriorDurableDispatchState({
					priorAttempt: {
						id: "att-3",
						status: "closed_unknown",
						attemptNumber: 1,
						installationId: "inst-old",
					},
					currentActiveInstallationId: "inst-new",
				}),
			).toEqual({ action: "already_closed_unknown" });
		});
	});

	describe("7-day expiry cutoff (Temporal)", () => {
		it("computes the exact 7-day (168h) UTC cutoff using Temporal", () => {
			expect(DURABLE_DISPATCH_UNKNOWN_CLOSURE_HOURS).toBe(168);
			const now = new Date("2026-11-26T12:00:00.000Z");
			const cutoff = computeDurableDispatchExpiryCutoff(now);
			expect(cutoff.toISOString()).toBe("2026-11-19T12:00:00.000Z");
		});
	});

	describe("error classification guards", () => {
		it("distinguishes confirmed-unsent pre-flight errors from uncertain provider-call errors", () => {
			const confirmed = new DurableDispatchConfirmedUnsentError("lookup offline", {
				reason: "availability_lookup_failed",
			});
			const uncertain = new DurableDispatchUncertainError("slack_delivery_unacknowledged", {
				reason: "provider_unacknowledged",
			});
			const plain = new Error("something broke");

			expect(isConfirmedUnsentError(confirmed)).toBe(true);
			expect(isUncertainDispatchError(confirmed)).toBe(false);
			expect(confirmed.message).toBe("lookup offline");

			expect(isUncertainDispatchError(uncertain)).toBe(true);
			expect(isConfirmedUnsentError(uncertain)).toBe(false);
			expect(uncertain.message).toBe("slack_delivery_unacknowledged");

			expect(isConfirmedUnsentError(plain)).toBe(false);
			expect(isUncertainDispatchError(plain)).toBe(false);
		});
	});
});
