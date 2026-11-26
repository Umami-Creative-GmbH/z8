import type { db as appDb } from "@/db";
import type {
	ChatConversationReachabilityStatus,
	ChatCredentialRevisionStatus,
	ChatCredentialSource,
	ChatInstallationProvider,
	ChatInstallationStatus,
	ChatLegacyTableName,
	ChatOwnershipClaimKind,
	ChatRemediationDetails,
	ChatRemediationReason,
	ChatVerificationEvidence,
	ChatVerificationState,
} from "@/db/schema/chat-installations";

export {
	CHAT_CONVERSATION_REACHABILITY_STATUSES,
	CHAT_CREDENTIAL_REVISION_STATUSES,
	CHAT_CREDENTIAL_SOURCES,
	CHAT_INSTALLATION_PROVIDERS,
	CHAT_INSTALLATION_STATUSES,
	CHAT_LEGACY_TABLE_NAMES,
	CHAT_OWNERSHIP_CLAIM_KINDS,
	CHAT_REMEDIATION_REASONS,
	CHAT_VERIFICATION_STATES,
} from "@/db/schema/chat-installations";

export type {
	ChatConversationReachabilityStatus,
	ChatCredentialRevisionStatus,
	ChatCredentialSource,
	ChatInstallationProvider,
	ChatInstallationStatus,
	ChatLegacyTableName,
	ChatOwnershipClaimKind,
	ChatRemediationDetails,
	ChatRemediationReason,
	ChatVerificationEvidence,
	ChatVerificationState,
};

export type ChatInstallationsDb = Pick<
	typeof appDb,
	"select" | "selectDistinct" | "insert" | "update" | "delete" | "query"
>;

export interface ChatInstallationsDeploymentConfig {
	microsoftAppId?: string;
	microsoftAppPassword?: string;
	slackClientId?: string;
}

export interface ChatInstallationsRuntimeDeps {
	db?: ChatInstallationsDb;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deploymentConfig?: ChatInstallationsDeploymentConfig;
	now?: () => Date;
}

export interface ChatEffectiveSettings {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export type ChatEffectiveSettingField = keyof ChatEffectiveSettings;

export interface TeamsSettingsDisagreementValue {
	tenantId: string;
	tenantName: string | null;
	value: boolean | string | number;
}

export interface TeamsSettingsDisagreement {
	field: ChatEffectiveSettingField;
	values: TeamsSettingsDisagreementValue[];
}

export type ChatMigrationBlockerCode = ChatRemediationReason | "teams_tenant_settings_disagreement";

export interface ChatMigrationBlocker {
	code: ChatMigrationBlockerCode;
	provider: ChatInstallationProvider;
	installationId: string | null;
	legacyRecordId: string | null;
	legacyStatus: string | null;
	externalLabel: string | null;
	missingField: string | null;
	blocksSwitchAndEndpointMutation: boolean;
}

export type ChatProviderConnectionState =
	| "connected"
	| "disconnected"
	| "remediation_required"
	| "unknown_readiness";

export interface ChatInstallationSummary {
	id: string;
	organizationId: string;
	provider: ChatInstallationProvider;
	credentialSource: ChatCredentialSource;
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	legacyTable: ChatLegacyTableName | null;
	legacyRecordId: string | null;
	legacyStatus: string | null;
	remediationReason: ChatRemediationReason | null;
	remediationDetails: ChatRemediationDetails | null;
	verificationState: ChatVerificationState;
	verificationEvidence: ChatVerificationEvidence | null;
	lastVerifiedAt: string | null;
	retirementDeadlineAt: string | null;
	retiredAt: string | null;
	revokedAt: string | null;
	endpointGeneration: number;
	createdAt: string;
	updatedAt: string;
}

export interface LegacyTeamsTenantInventoryItem {
	id: string;
	tenantId: string;
	tenantName: string | null;
	setupStatus: string;
	isUnexpectedStatus: boolean;
	installationId: string | null;
	installationStatus: ChatInstallationStatus | null;
	credentialSource: ChatCredentialSource;
	receiverScope: string | null;
	verificationState: ChatVerificationState;
	configuredAt: string | null;
	serviceUrlRecorded: boolean;
	effectiveSettings: ChatEffectiveSettings;
	blockers: ChatMigrationBlocker[];
}

export interface ChatProviderInventory {
	provider: ChatInstallationProvider;
	connectionState: ChatProviderConnectionState;
	switchEnabled: boolean;
	canSwitchOrMutateEndpoint: boolean;
	currentInstallations: ChatInstallationSummary[];
	candidateInstallations: ChatInstallationSummary[];
	retiringInstallations: ChatInstallationSummary[];
	blockers: ChatMigrationBlocker[];
	effectiveSettings: ChatEffectiveSettings | null;
	teamsTenants: LegacyTeamsTenantInventoryItem[];
	teamsSettingsDisagreements: TeamsSettingsDisagreement[];
}

export interface OrganizationChatInstallationsInventory {
	organizationId: string;
	providers: Record<ChatInstallationProvider, ChatProviderInventory>;
	generatedAt: string;
}

export interface BackfillOrganizationResult {
	organizationId: string;
	createdCount: number;
	updatedCount: number;
	skippedCount: number;
	remediationCount: number;
}

export interface BackfillAllOrganizationsResult {
	processedOrganizationIds: string[];
	nextCursor: string | null;
	hasMore: boolean;
	totals: {
		createdCount: number;
		updatedCount: number;
		skippedCount: number;
		remediationCount: number;
	};
}

export type ActiveChatInstallationResolution =
	| { kind: "active"; installation: ChatInstallationSummary }
	| { kind: "legacy"; installations: ChatInstallationSummary[] }
	| { kind: "remediation_required"; installations: ChatInstallationSummary[] }
	| { kind: "none" };

export interface SwitchEligibilityResult {
	allowed: boolean;
	switchControlEnabled: boolean;
	blockers: ChatMigrationBlocker[];
}
