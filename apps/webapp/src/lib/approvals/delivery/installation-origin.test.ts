import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DAYS,
	buildRedactedReconciliationContext,
	type ChatInstallationOriginRecord,
	evaluateInboundOriginEligibility,
	isUncertainWorkExpiredForUnknownClosure,
	resolveOriginFromInstallations,
	shouldQuarantineAcrossSwitch,
} from "./installation-origin";

const NOW = Temporal.Instant.from("2030-06-15T12:00:00Z");

function makeInstallation(
	overrides: Partial<ChatInstallationOriginRecord> = {},
): ChatInstallationOriginRecord {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		organizationId: "org-1",
		provider: "telegram",
		credentialSource: "deployment_managed",
		status: "legacy_active",
		routeId: "route-legacy-1",
		externalAppId: null,
		externalBotId: "1001",
		externalSpaceId: null,
		receiverScope: "telegram-bot:1001",
		activeCredentialRevisionId: null,
		legacyTable: "telegram_bot_config",
		legacyRecordId: "22222222-2222-4222-8222-222222222222",
		retirementDeadlineAt: null,
		retiredAt: null,
		revokedAt: null,
		...overrides,
	};
}

describe("approval delivery installation origin resolution", () => {
	it("returns legacy_untracked when the organization has no chat_installation rows for the provider", () => {
		const result = resolveOriginFromInstallations({
			installations: [],
			installationId: null,
			receiverScope: "telegram-bot:1001",
			now: NOW,
		});
		expect(result).toEqual({ kind: "legacy_untracked" });
	});

	it("resolves a recorded installationId first even when another active installation exists", () => {
		const retiring = makeInstallation({
			id: "11111111-1111-4111-8111-111111111111",
			status: "retiring",
			receiverScope: "telegram-bot:1001",
			retirementDeadlineAt: new Date("2030-07-01T00:00:00Z"),
		});
		const active = makeInstallation({
			id: "33333333-3333-4333-8333-333333333333",
			status: "active",
			credentialSource: "organization_owned",
			receiverScope: "telegram-bot:2002",
			legacyTable: null,
			legacyRecordId: null,
		});

		const result = resolveOriginFromInstallations({
			installations: [retiring, active],
			installationId: retiring.id,
			receiverScope: "telegram-bot:1001",
			now: NOW,
		});

		expect(result).toEqual({
			kind: "serviceable",
			installation: retiring,
			matchedBy: "installation_id",
			isRetiring: true,
		});
	});

	it("resolves historical cards without installationId via unique evidenced receiverScope", () => {
		const retiring = makeInstallation({
			status: "retiring",
			receiverScope: "telegram-bot:1001",
			retirementDeadlineAt: new Date("2030-07-01T00:00:00Z"),
		});
		const active = makeInstallation({
			id: "33333333-3333-4333-8333-333333333333",
			status: "active",
			credentialSource: "organization_owned",
			receiverScope: "telegram-bot:2002",
			legacyTable: null,
			legacyRecordId: null,
		});

		const result = resolveOriginFromInstallations({
			installations: [retiring, active],
			installationId: null,
			receiverScope: "telegram-bot:1001",
			now: NOW,
		});

		expect(result).toEqual({
			kind: "serviceable",
			installation: retiring,
			matchedBy: "receiver_scope",
			isRetiring: true,
		});
	});

	it("normalizes Teams conversation-scoped receiverScope to match tenant installation scope", () => {
		const teamsTenant = makeInstallation({
			provider: "teams",
			status: "retiring",
			receiverScope: "teams-bot:app-1:tenant:tenant-1",
			retirementDeadlineAt: new Date("2030-07-01T00:00:00Z"),
			legacyTable: "teams_tenant_config",
		});

		const result = resolveOriginFromInstallations({
			installations: [teamsTenant],
			installationId: null,
			receiverScope: "teams-bot:app-1:tenant:tenant-1:conversation:conv-42",
			now: NOW,
		});

		expect(result).toEqual({
			kind: "serviceable",
			installation: teamsTenant,
			matchedBy: "receiver_scope",
			isRetiring: true,
		});
	});

	it("falls back to Z8 inbox when historical receiverScope matches multiple non-candidate installations", () => {
		const slackOld = makeInstallation({
			id: "11111111-1111-4111-8111-111111111111",
			provider: "slack",
			status: "retiring",
			receiverScope: "slack-team:T123",
			retirementDeadlineAt: new Date("2030-07-01T00:00:00Z"),
			legacyTable: "slack_workspace_config",
		});
		const slackNew = makeInstallation({
			id: "33333333-3333-4333-8333-333333333333",
			provider: "slack",
			status: "active",
			credentialSource: "organization_owned",
			receiverScope: "slack-team:T123",
			legacyTable: null,
			legacyRecordId: null,
		});

		const result = resolveOriginFromInstallations({
			installations: [slackOld, slackNew],
			installationId: null,
			receiverScope: "slack-team:T123",
			now: NOW,
		});

		expect(result).toEqual({
			kind: "ambiguous_inbox_fallback",
			reason: "multiple_matching_installations",
			fallback: "z8_inbox",
		});
	});

	it("ignores candidate installations when matching historical receiverScope", () => {
		const live = makeInstallation({
			id: "11111111-1111-4111-8111-111111111111",
			provider: "slack",
			status: "legacy_active",
			receiverScope: "slack-team:T123",
			legacyTable: "slack_workspace_config",
		});
		const candidate = makeInstallation({
			id: "33333333-3333-4333-8333-333333333333",
			provider: "slack",
			status: "candidate",
			credentialSource: "organization_owned",
			receiverScope: "slack-team:T123",
			legacyTable: null,
			legacyRecordId: null,
		});

		const result = resolveOriginFromInstallations({
			installations: [live, candidate],
			installationId: null,
			receiverScope: "slack-team:T123",
			now: NOW,
		});

		expect(result).toEqual({
			kind: "serviceable",
			installation: live,
			matchedBy: "receiver_scope",
			isRetiring: false,
		});
	});

	it("returns ambiguous_inbox_fallback when historical receiverScope is unrecognized or missing", () => {
		const active = makeInstallation({ status: "active", receiverScope: "telegram-bot:2002" });

		expect(
			resolveOriginFromInstallations({
				installations: [active],
				installationId: null,
				receiverScope: "telegram-bot:9999",
				now: NOW,
			}),
		).toEqual({
			kind: "ambiguous_inbox_fallback",
			reason: "unrecognized_receiver_scope",
			fallback: "z8_inbox",
		});

		expect(
			resolveOriginFromInstallations({
				installations: [active],
				installationId: null,
				receiverScope: null,
				now: NOW,
			}),
		).toEqual({
			kind: "ambiguous_inbox_fallback",
			reason: "missing_origin_evidence",
			fallback: "z8_inbox",
		});
	});

	it("returns revoked when the originating installation is revoked", () => {
		const revokedAt = new Date("2030-06-14T10:00:00Z");
		const revoked = makeInstallation({
			status: "revoked",
			revokedAt,
		});

		const result = resolveOriginFromInstallations({
			installations: [revoked],
			installationId: revoked.id,
			receiverScope: revoked.receiverScope,
			now: NOW,
		});

		expect(result).toEqual({
			kind: "revoked",
			installationId: revoked.id,
			revokedAt,
			fallback: "z8_inbox",
		});
	});

	it("returns retirement_expired when a retiring installation reaches or passes its deadline", () => {
		const deadline = new Date("2030-06-15T12:00:00Z");
		const expired = makeInstallation({
			status: "retiring",
			retirementDeadlineAt: deadline,
		});

		const result = resolveOriginFromInstallations({
			installations: [expired],
			installationId: expired.id,
			receiverScope: expired.receiverScope,
			now: NOW,
		});

		expect(result).toEqual({
			kind: "retirement_expired",
			installationId: expired.id,
			retirementDeadlineAt: deadline,
			retiredAt: null,
			fallback: "z8_inbox",
		});
	});

	it("enforces inbound origin eligibility for retiring, mismatched, revoked, and expired installations", () => {
		const retiring = makeInstallation({
			id: "11111111-1111-4111-8111-111111111111",
			status: "retiring",
			retirementDeadlineAt: new Date("2030-07-01T00:00:00Z"),
		});
		const active = makeInstallation({
			id: "33333333-3333-4333-8333-333333333333",
			status: "active",
			receiverScope: "telegram-bot:2002",
		});

		expect(
			evaluateInboundOriginEligibility({
				origin: {
					kind: "serviceable",
					installation: retiring,
					matchedBy: "installation_id",
					isRetiring: true,
				},
				incomingInstallationId: retiring.id,
			}),
		).toEqual({ allowed: true, installationId: retiring.id, isRetiring: true });

		expect(
			evaluateInboundOriginEligibility({
				origin: {
					kind: "serviceable",
					installation: retiring,
					matchedBy: "installation_id",
					isRetiring: true,
				},
				incomingInstallationId: active.id,
			}),
		).toEqual({ allowed: false, reason: "installation_mismatch", fallback: "z8_inbox" });

		expect(
			evaluateInboundOriginEligibility({
				origin: {
					kind: "revoked",
					installationId: retiring.id,
					revokedAt: new Date("2030-06-14T00:00:00Z"),
					fallback: "z8_inbox",
				},
				incomingInstallationId: retiring.id,
			}),
		).toEqual({ allowed: false, reason: "installation_revoked", fallback: "z8_inbox" });
	});
});

describe("cross-switch uncertain dispatch quarantine and 7-day unknown closure", () => {
	it("quarantines intent_recorded work when active installation switched or attempted installation is no longer live", () => {
		expect(
			shouldQuarantineAcrossSwitch({
				dispatchAttemptState: "intent_recorded",
				attemptedInstallationId: "inst-old",
				attemptedInstallationStatus: "retiring",
				activeInstallationId: "inst-new",
			}),
		).toBe(true);

		expect(
			shouldQuarantineAcrossSwitch({
				dispatchAttemptState: "intent_recorded",
				attemptedInstallationId: "inst-old",
				attemptedInstallationStatus: "revoked",
				activeInstallationId: null,
			}),
		).toBe(true);
	});

	it("allows retry when no switch occurred and allows reroute when confirmed_unsent", () => {
		expect(
			shouldQuarantineAcrossSwitch({
				dispatchAttemptState: "intent_recorded",
				attemptedInstallationId: "inst-old",
				attemptedInstallationStatus: "active",
				activeInstallationId: "inst-old",
			}),
		).toBe(false);

		expect(
			shouldQuarantineAcrossSwitch({
				dispatchAttemptState: "confirmed_unsent",
				attemptedInstallationId: "inst-old",
				attemptedInstallationStatus: "retiring",
				activeInstallationId: "inst-new",
			}),
		).toBe(false);

		expect(
			shouldQuarantineAcrossSwitch({
				dispatchAttemptState: "none",
				attemptedInstallationId: null,
				attemptedInstallationStatus: null,
				activeInstallationId: "inst-new",
			}),
		).toBe(false);
	});

	it("builds redacted reconciliation context with Z8 inbox fallback and no raw secrets", () => {
		const ctx = buildRedactedReconciliationContext({
			reason: "lease_expired_across_switch",
			provider: "telegram",
			effect: "initial",
			attemptedInstallationId: "inst-old",
			attemptedCredentialRevisionId: "rev-1",
			activeInstallationId: "inst-new",
			dispatchIntentAt: Temporal.Instant.from("2030-06-15T11:55:00Z"),
			detectedAt: NOW,
			attemptCount: 1,
		});

		expect(ctx).toEqual({
			reason: "lease_expired_across_switch",
			provider: "telegram",
			effect: "initial",
			attemptedInstallationId: "inst-old",
			attemptedCredentialRevisionId: "rev-1",
			activeInstallationId: "inst-new",
			dispatchIntentAt: "2030-06-15T11:55:00Z",
			detectedAt: "2030-06-15T12:00:00Z",
			attemptCount: 1,
			fallback: "z8_inbox",
		});
	});

	it("closes uncertain work as unknown strictly after 7 full days", () => {
		expect(APPROVAL_DELIVERY_UNCERTAIN_CLOSURE_DAYS).toBe(7);
		const requiredAt = Temporal.Instant.from("2030-06-01T10:00:00Z");

		expect(
			isUncertainWorkExpiredForUnknownClosure({
				reconciliationRequiredAt: requiredAt,
				now: requiredAt.add({ hours: 7 * 24 }).subtract({ seconds: 1 }),
			}),
		).toBe(false);

		expect(
			isUncertainWorkExpiredForUnknownClosure({
				reconciliationRequiredAt: requiredAt,
				now: requiredAt.add({ hours: 7 * 24 }),
			}),
		).toBe(true);
	});
});
