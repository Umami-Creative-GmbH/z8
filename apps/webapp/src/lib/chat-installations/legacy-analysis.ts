import type {
	ChatEffectiveSettingField,
	ChatEffectiveSettings,
	ChatInstallationProvider,
	ChatInstallationStatus,
	ChatMigrationBlocker,
	ChatProviderConnectionState,
	ChatRemediationDetails,
	ChatRemediationReason,
	ChatVerificationEvidence,
	ChatVerificationState,
	TeamsSettingsDisagreement,
} from "./types";

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCORD_SNOWFLAKE_PATTERN = /^\d{1,20}$/;
const TELEGRAM_BOT_TOKEN_PATTERN = /^(\d+):[A-Za-z0-9_-]+$/;
const TELEGRAM_NUMERIC_ID_PATTERN = /^\d+$/;

const KNOWN_LEGACY_SETUP_STATUSES: Record<ChatInstallationProvider, ReadonlySet<string>> = {
	slack: new Set(["active", "suspended", "disconnected"]),
	teams: new Set(["pending", "active", "suspended", "disconnected"]),
	telegram: new Set(["pending", "active", "suspended", "disconnected"]),
	discord: new Set(["pending", "active", "suspended", "disconnected"]),
};

const COMPARED_TEAMS_SETTINGS_FIELDS: readonly ChatEffectiveSettingField[] = [
	"enableApprovals",
	"enableCommands",
	"enableDailyDigest",
	"enableEscalations",
	"digestTime",
	"digestTimezone",
	"escalationTimeoutHours",
];

export function isValidGuid(value: string | null | undefined): value is string {
	return typeof value === "string" && GUID_PATTERN.test(value.trim());
}

export function isValidDiscordSnowflake(value: string | null | undefined): value is string {
	return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value.trim());
}

export function extractTelegramNumericBotId(token: string | null | undefined): string | null {
	if (!token) return null;
	const trimmed = token.trim();
	if (!trimmed || trimmed === "vault:managed") return null;
	const match = TELEGRAM_BOT_TOKEN_PATTERN.exec(trimmed);
	return match?.[1] ?? null;
}

export type LegacyReceiverScopeInput =
	| { provider: "slack"; slackTeamId: string | null | undefined }
	| {
			provider: "teams";
			microsoftAppId: string | null | undefined;
			tenantId: string | null | undefined;
	  }
	| { provider: "telegram"; numericBotId: string | null | undefined }
	| { provider: "discord"; applicationId: string | null | undefined };

export function buildLegacyReceiverScope(input: LegacyReceiverScopeInput): string | null {
	switch (input.provider) {
		case "slack": {
			const teamId = input.slackTeamId?.trim();
			return teamId ? `slack-team:${teamId}` : null;
		}
		case "teams": {
			if (!isValidGuid(input.microsoftAppId) || !isValidGuid(input.tenantId)) {
				return null;
			}
			return `teams-bot:${input.microsoftAppId.trim()}:tenant:${input.tenantId.trim()}`;
		}
		case "telegram": {
			const botId = input.numericBotId?.trim();
			if (!botId || !TELEGRAM_NUMERIC_ID_PATTERN.test(botId)) {
				return null;
			}
			return `telegram-bot:${botId}`;
		}
		case "discord": {
			if (!isValidDiscordSnowflake(input.applicationId)) {
				return null;
			}
			return `discord-app:${input.applicationId.trim()}`;
		}
	}
}

export function isKnownLegacySetupStatus(
	provider: ChatInstallationProvider,
	status: string,
): boolean {
	return KNOWN_LEGACY_SETUP_STATUSES[provider].has(status);
}

export function detectTeamsTenantSettingsDisagreements(
	tenants: ReadonlyArray<{
		tenantId: string;
		tenantName: string | null;
		setupStatus: string;
		settings: ChatEffectiveSettings;
	}>,
): TeamsSettingsDisagreement[] {
	const comparable = tenants.filter((tenant) => tenant.setupStatus !== "disconnected");
	if (comparable.length < 2) {
		return [];
	}

	const disagreements: TeamsSettingsDisagreement[] = [];

	for (const field of COMPARED_TEAMS_SETTINGS_FIELDS) {
		const distinctValues = new Set(comparable.map((tenant) => tenant.settings[field]));
		if (distinctValues.size > 1) {
			disagreements.push({
				field,
				values: comparable.map((tenant) => ({
					tenantId: tenant.tenantId,
					tenantName: tenant.tenantName,
					value: tenant.settings[field],
				})),
			});
		}
	}

	return disagreements;
}

export function buildBlockerFromInstallation(installation: {
	id: string;
	provider: ChatInstallationProvider;
	status: ChatInstallationStatus;
	legacyRecordId: string | null;
	legacyStatus: string | null;
	externalDisplayName: string | null;
	externalSpaceName: string | null;
	externalSpaceId: string | null;
	externalAppId: string | null;
	externalBotUsername: string | null;
	remediationReason: ChatRemediationReason | null;
	remediationDetails: ChatRemediationDetails | null;
}): ChatMigrationBlocker | null {
	if (installation.status !== "remediation_required" || !installation.remediationReason) {
		return null;
	}

	const externalLabel =
		installation.externalDisplayName ??
		installation.externalSpaceName ??
		(installation.externalBotUsername ? `@${installation.externalBotUsername}` : null) ??
		installation.externalSpaceId ??
		installation.externalAppId ??
		installation.remediationDetails?.externalIdentityLabel ??
		null;

	return {
		code: installation.remediationReason,
		provider: installation.provider,
		installationId: installation.id,
		legacyRecordId: installation.legacyRecordId,
		legacyStatus: installation.legacyStatus,
		externalLabel,
		missingField: installation.remediationDetails?.missingField ?? null,
		blocksSwitchAndEndpointMutation: true,
	};
}

export function deriveProviderConnectionState(input: {
	installations: ReadonlyArray<{
		status: ChatInstallationStatus;
		verificationState: ChatVerificationState;
		verificationEvidence: ChatVerificationEvidence | null;
	}>;
	blockers: ReadonlyArray<{ code: string }>;
}): ChatProviderConnectionState {
	const liveOrBlocked = input.installations.filter(
		(inst) =>
			inst.status === "active" ||
			inst.status === "legacy_active" ||
			inst.status === "remediation_required",
	);

	if (liveOrBlocked.length === 0) {
		return "disconnected";
	}

	if (
		liveOrBlocked.some((inst) => inst.status === "remediation_required") ||
		input.blockers.some((blocker) => blocker.code !== "teams_tenant_settings_disagreement")
	) {
		return "remediation_required";
	}

	const hasUnknownReadiness = liveOrBlocked.some(
		(inst) =>
			inst.verificationState === "failed" ||
			inst.verificationState === "expired" ||
			inst.verificationEvidence?.secretStoreStatus === "unavailable" ||
			inst.verificationEvidence?.secretStoreStatus === "missing" ||
			inst.verificationEvidence?.deploymentBotConfigured === false,
	);
	if (hasUnknownReadiness) {
		return "unknown_readiness";
	}

	return "connected";
}
