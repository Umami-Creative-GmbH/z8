import { describe, expect, it } from "vitest";
import {
	buildLegacyReceiverScope,
	deriveProviderConnectionState,
	detectTeamsTenantSettingsDisagreements,
	extractTelegramNumericBotId,
	isKnownLegacySetupStatus,
} from "./legacy-analysis";

describe("chat-installations legacy analysis", () => {
	describe("extractTelegramNumericBotId", () => {
		it("extracts the numeric bot id from a valid BotFather token", () => {
			expect(extractTelegramNumericBotId("123456789:AAH_mock-Token123")).toBe("123456789");
		});

		it("returns null for vault sentinels, blank strings, or malformed tokens", () => {
			expect(extractTelegramNumericBotId("vault:managed")).toBeNull();
			expect(extractTelegramNumericBotId("")).toBeNull();
			expect(extractTelegramNumericBotId("   ")).toBeNull();
			expect(extractTelegramNumericBotId("abc:def")).toBeNull();
			expect(extractTelegramNumericBotId(null)).toBeNull();
		});
	});

	describe("buildLegacyReceiverScope", () => {
		it("preserves exact historical receiver scopes across all four providers", () => {
			expect(
				buildLegacyReceiverScope({
					provider: "slack",
					slackTeamId: "T01234567",
				}),
			).toBe("slack-team:T01234567");

			expect(
				buildLegacyReceiverScope({
					provider: "teams",
					microsoftAppId: "11111111-2222-3333-4444-555555555555",
					tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				}),
			).toBe(
				"teams-bot:11111111-2222-3333-4444-555555555555:tenant:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			);

			expect(
				buildLegacyReceiverScope({
					provider: "telegram",
					numericBotId: "987654321",
				}),
			).toBe("telegram-bot:987654321");

			expect(
				buildLegacyReceiverScope({
					provider: "discord",
					applicationId: "123456789012345678",
				}),
			).toBe("discord-app:123456789012345678");
		});

		it("returns null when required external identity is missing or invalid", () => {
			expect(buildLegacyReceiverScope({ provider: "slack", slackTeamId: "  " })).toBeNull();
			expect(
				buildLegacyReceiverScope({
					provider: "teams",
					microsoftAppId: undefined,
					tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				}),
			).toBeNull();
			expect(
				buildLegacyReceiverScope({
					provider: "teams",
					microsoftAppId: "not-a-guid",
					tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				}),
			).toBeNull();
			expect(buildLegacyReceiverScope({ provider: "telegram", numericBotId: "abc" })).toBeNull();
			expect(
				buildLegacyReceiverScope({ provider: "discord", applicationId: "not-snowflake" }),
			).toBeNull();
		});
	});

	describe("isKnownLegacySetupStatus", () => {
		it("recognizes documented statuses and flags unexpected historical statuses like disabled", () => {
			expect(isKnownLegacySetupStatus("teams", "active")).toBe(true);
			expect(isKnownLegacySetupStatus("teams", "pending")).toBe(true);
			expect(isKnownLegacySetupStatus("teams", "suspended")).toBe(true);
			expect(isKnownLegacySetupStatus("teams", "disconnected")).toBe(true);
			expect(isKnownLegacySetupStatus("teams", "disabled")).toBe(false);
			expect(isKnownLegacySetupStatus("teams", "legacy_broken")).toBe(false);
			expect(isKnownLegacySetupStatus("slack", "active")).toBe(true);
			expect(isKnownLegacySetupStatus("slack", "weird")).toBe(false);
		});
	});

	describe("detectTeamsTenantSettingsDisagreements", () => {
		const baseSettings = {
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 24,
		};

		it("returns no disagreements for zero or one tenant or matching tenants", () => {
			expect(detectTeamsTenantSettingsDisagreements([])).toEqual([]);
			expect(
				detectTeamsTenantSettingsDisagreements([
					{ tenantId: "t-1", tenantName: "Alpha", setupStatus: "active", settings: baseSettings },
				]),
			).toEqual([]);
			expect(
				detectTeamsTenantSettingsDisagreements([
					{ tenantId: "t-1", tenantName: "Alpha", setupStatus: "active", settings: baseSettings },
					{
						tenantId: "t-2",
						tenantName: "Beta",
						setupStatus: "active",
						settings: { ...baseSettings },
					},
				]),
			).toEqual([]);
		});

		it("reports every setting field where non-disconnected legacy Teams tenants disagree", () => {
			const disagreements = detectTeamsTenantSettingsDisagreements([
				{ tenantId: "t-1", tenantName: "Alpha", setupStatus: "active", settings: baseSettings },
				{
					tenantId: "t-2",
					tenantName: "Beta",
					setupStatus: "disabled",
					settings: {
						...baseSettings,
						enableApprovals: false,
						digestTime: "09:30",
						escalationTimeoutHours: 12,
					},
				},
			]);

			expect(disagreements.map((item) => item.field)).toEqual([
				"enableApprovals",
				"digestTime",
				"escalationTimeoutHours",
			]);
			expect(disagreements[0]?.values).toEqual([
				{ tenantId: "t-1", tenantName: "Alpha", value: true },
				{ tenantId: "t-2", tenantName: "Beta", value: false },
			]);
		});

		it("ignores disconnected tenants when comparing active/remediation tenant settings", () => {
			const disagreements = detectTeamsTenantSettingsDisagreements([
				{ tenantId: "t-1", tenantName: "Alpha", setupStatus: "active", settings: baseSettings },
				{
					tenantId: "t-2",
					tenantName: "Old Disconnected",
					setupStatus: "disconnected",
					settings: { ...baseSettings, enableApprovals: false },
				},
			]);

			expect(disagreements).toEqual([]);
		});
	});

	describe("deriveProviderConnectionState", () => {
		it("distinguishes remediation_required, unknown_readiness, connected, and disconnected", () => {
			expect(
				deriveProviderConnectionState({
					installations: [],
					blockers: [],
				}),
			).toBe("disconnected");

			expect(
				deriveProviderConnectionState({
					installations: [
						{
							status: "remediation_required",
							verificationState: "unverified",
							verificationEvidence: null,
						},
					],
					blockers: [{ code: "unknown_bot_identity" }],
				}),
			).toBe("remediation_required");

			expect(
				deriveProviderConnectionState({
					installations: [
						{
							status: "legacy_active",
							verificationState: "unverified",
							verificationEvidence: {
								source: "legacy_metadata",
								secretStoreStatus: "unavailable",
							},
						},
					],
					blockers: [],
				}),
			).toBe("unknown_readiness");

			expect(
				deriveProviderConnectionState({
					installations: [
						{
							status: "legacy_active",
							verificationState: "unverified",
							verificationEvidence: {
								source: "legacy_metadata",
								secretStoreStatus: "available",
							},
						},
					],
					blockers: [],
				}),
			).toBe("connected");
		});
	});
});
