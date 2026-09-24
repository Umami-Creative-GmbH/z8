import { describe, expect, it } from "vitest";
import {
	DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS,
	deriveMigratedEscalationPolicy,
	describeChannelDeliveryPreferences,
	type EscalationPolicySourceInput,
} from "./policy";

function source(
	overrides: Partial<EscalationPolicySourceInput>,
): EscalationPolicySourceInput {
	return {
		channel: "slack",
		sourceId: "slack-1",
		displayName: null,
		setupStatus: "active",
		escalationEnabled: true,
		escalationTimeoutHours: 24,
		...overrides,
	};
}

describe("deriveMigratedEscalationPolicy", () => {
	it("starts disabled with the default window when no integration exists", () => {
		const policy = deriveMigratedEscalationPolicy([]);

		expect(policy).toMatchObject({
			enabled: false,
			responseWindowHours: DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS,
			conflictReviewStatus: "none",
			provenance: {
				outcome: "disabled_no_enabled_source",
				sources: [],
				conflicts: [],
			},
		});
	});

	it("starts disabled when active integrations all have escalation turned off", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({ escalationEnabled: false, escalationTimeoutHours: 4 }),
			source({
				channel: "teams",
				sourceId: "teams-1",
				escalationEnabled: false,
			}),
		]);

		expect(policy.enabled).toBe(false);
		expect(policy.responseWindowHours).toBe(
			DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS,
		);
		expect(policy.provenance.conflicts).toEqual([]);
	});

	it("ignores inactive integrations for enablement and flags their enabled setting", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({ setupStatus: "suspended", escalationTimeoutHours: 2 }),
			source({
				channel: "discord",
				sourceId: "discord-1",
				setupStatus: "pending",
			}),
		]);

		expect(policy.enabled).toBe(false);
		expect(policy.provenance.conflicts).toEqual([
			{ code: "inactive_source_enabled", sourceIds: ["slack-1", "discord-1"] },
		]);
		expect(policy.conflictReviewStatus).toBe("pending");
	});

	it("enables with the shortest timeout among active escalation-enabled sources", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({ escalationTimeoutHours: 48 }),
			source({
				channel: "telegram",
				sourceId: "telegram-1",
				escalationTimeoutHours: 12,
			}),
			source({
				channel: "teams",
				sourceId: "teams-1",
				setupStatus: "suspended",
				escalationTimeoutHours: 1,
			}),
		]);

		expect(policy.enabled).toBe(true);
		expect(policy.responseWindowHours).toBe(12);
		expect(policy.provenance.outcome).toBe("enabled_from_sources");
		expect(policy.provenance.conflicts).toEqual([
			{ code: "differing_timeouts", sourceIds: ["slack-1", "telegram-1"] },
			{ code: "inactive_source_enabled", sourceIds: ["teams-1"] },
		]);
	});

	it("records provenance for every source and which ones contributed", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({
				channel: "teams",
				sourceId: "teams-b",
				escalationTimeoutHours: 8,
				displayName: "B",
			}),
			source({
				channel: "teams",
				sourceId: "teams-a",
				escalationEnabled: false,
			}),
			source({ escalationTimeoutHours: 8 }),
		]);

		expect(
			policy.provenance.sources.map((entry) => [
				entry.sourceId,
				entry.contributed,
			]),
		).toEqual([
			["slack-1", true],
			["teams-a", false],
			["teams-b", true],
		]);
		expect(policy.provenance.conflicts).toEqual([
			{ code: "disabled_active_source", sourceIds: ["teams-a"] },
		]);
	});

	it("preserves each channel's toggle as delivery preference instead of enabling disabled channels", () => {
		const inputs = [
			source({ escalationTimeoutHours: 6 }),
			source({
				channel: "discord",
				sourceId: "discord-1",
				escalationEnabled: false,
				escalationTimeoutHours: 6,
			}),
		];
		const policy = deriveMigratedEscalationPolicy(inputs);
		const preferences = describeChannelDeliveryPreferences(inputs, policy);

		expect(
			preferences.map((entry) => [entry.channel, entry.deliversEscalations]),
		).toEqual([
			["slack", true],
			["discord", false],
		]);
		expect(policy.provenance.conflicts).toEqual([
			{ code: "disabled_active_source", sourceIds: ["discord-1"] },
		]);
	});

	it("does not let an invalid timeout become the response window", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({ escalationTimeoutHours: 0 }),
			source({
				channel: "telegram",
				sourceId: "telegram-1",
				escalationTimeoutHours: 36,
			}),
		]);

		expect(policy.enabled).toBe(true);
		expect(policy.responseWindowHours).toBe(36);
		expect(policy.provenance.conflicts).toEqual([
			{ code: "invalid_timeout", sourceIds: ["slack-1"] },
		]);
	});

	it("stays enabled with the default window when every enabled source has an invalid timeout", () => {
		const policy = deriveMigratedEscalationPolicy([
			source({ escalationTimeoutHours: -5 }),
		]);

		expect(policy.enabled).toBe(true);
		expect(policy.responseWindowHours).toBe(
			DEFAULT_ESCALATION_RESPONSE_WINDOW_HOURS,
		);
		expect(policy.conflictReviewStatus).toBe("pending");
	});
});

describe("describeChannelDeliveryPreferences", () => {
	it("flags enabled channels whose legacy timeout differs from the organization window", () => {
		const preferences = describeChannelDeliveryPreferences(
			[
				source({ escalationTimeoutHours: 24 }),
				source({
					channel: "telegram",
					sourceId: "telegram-1",
					escalationTimeoutHours: 12,
				}),
				source({
					channel: "teams",
					sourceId: "teams-1",
					escalationEnabled: false,
					escalationTimeoutHours: 1,
				}),
			],
			{ responseWindowHours: 12 },
		);

		expect(
			preferences.map((entry) => [entry.sourceId, entry.legacyTimeoutDiffers]),
		).toEqual([
			["slack-1", true],
			["telegram-1", false],
			["teams-1", false],
		]);
	});
});
