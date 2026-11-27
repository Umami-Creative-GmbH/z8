import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	CHAT_INSTALLATION_PROVIDERS,
	type ChatConversationReachabilityStatus,
	type ChatInstallationProvider,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationSwitchControl,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} from "@/db/schema";
import { backfillOrganizationChatInstallations } from "./backfill";
import {
	buildBlockerFromInstallation,
	deriveProviderConnectionState,
	detectTeamsTenantSettingsDisagreements,
	isKnownLegacySetupStatus,
} from "./legacy-analysis";
import type {
	ActiveChatInstallationResolution,
	ChatEffectiveSettings,
	ChatInstallationSummary,
	ChatInstallationsRuntimeDeps,
	ChatMigrationBlocker,
	ChatProviderInventory,
	LegacyTeamsTenantInventoryItem,
	OrganizationChatInstallationsInventory,
	SwitchEligibilityResult,
	TeamsSettingsDisagreement,
} from "./types";

function toInstallationSummary(row: typeof chatInstallation.$inferSelect): ChatInstallationSummary {
	return {
		id: row.id,
		organizationId: row.organizationId,
		provider: row.provider,
		credentialSource: row.credentialSource,
		status: row.status,
		routeId: row.routeId,
		externalAppId: row.externalAppId,
		externalBotId: row.externalBotId,
		externalBotUsername: row.externalBotUsername,
		externalDisplayName: row.externalDisplayName,
		externalSpaceId: row.externalSpaceId,
		externalSpaceName: row.externalSpaceName,
		receiverScope: row.receiverScope,
		legacyTable: row.legacyTable,
		legacyRecordId: row.legacyRecordId,
		legacyStatus: row.legacyStatus,
		remediationReason: row.remediationReason,
		remediationDetails: row.remediationDetails,
		verificationState: row.verificationState,
		verificationEvidence: row.verificationEvidence,
		lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
		retirementDeadlineAt: row.retirementDeadlineAt?.toISOString() ?? null,
		retiredAt: row.retiredAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		endpointGeneration: row.endpointGeneration,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toEffectiveSettings(row: {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}): ChatEffectiveSettings {
	return {
		enableApprovals: row.enableApprovals,
		enableCommands: row.enableCommands,
		enableDailyDigest: row.enableDailyDigest,
		enableEscalations: row.enableEscalations,
		digestTime: row.digestTime,
		digestTimezone: row.digestTimezone,
		escalationTimeoutHours: row.escalationTimeoutHours,
	};
}

/**
 * Lists every discovered legacy Teams tenant for an organization alongside its
 * effective settings, unexpected-status flag, and cross-tenant setting disagreements.
 */
export async function listLegacyTeamsTenantsForOrganization(
	organizationId: string,
	options?: ChatInstallationsRuntimeDeps & { syncLegacy?: boolean },
): Promise<{
	tenants: LegacyTeamsTenantInventoryItem[];
	disagreements: TeamsSettingsDisagreement[];
}> {
	const db = options?.db ?? defaultDb;
	if (options?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(organizationId, options);
	}

	const [legacyRows, installationRows] = await Promise.all([
		db
			.select()
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId))
			.orderBy(asc(teamsTenantConfig.createdAt), asc(teamsTenantConfig.tenantId)),
		db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, "teams"),
					eq(chatInstallation.legacyTable, "teams_tenant_config"),
				),
			),
	]);

	const installationByLegacyId = new Map(
		installationRows
			.filter((row): row is typeof row & { legacyRecordId: string } => Boolean(row.legacyRecordId))
			.map((row) => [row.legacyRecordId, row]),
	);

	const tenants: LegacyTeamsTenantInventoryItem[] = legacyRows.map((row) => {
		const linked = installationByLegacyId.get(row.id) ?? null;
		const blocker = linked ? buildBlockerFromInstallation(linked) : null;
		return {
			id: row.id,
			tenantId: row.tenantId,
			tenantName: row.tenantName,
			setupStatus: row.setupStatus,
			isUnexpectedStatus: !isKnownLegacySetupStatus("teams", row.setupStatus),
			installationId: linked?.id ?? null,
			installationStatus: linked?.status ?? null,
			credentialSource: linked?.credentialSource ?? "deployment_managed",
			receiverScope: linked?.receiverScope ?? null,
			verificationState: linked?.verificationState ?? "unverified",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			serviceUrlRecorded: Boolean(row.serviceUrl?.trim()),
			effectiveSettings: toEffectiveSettings(row),
			blockers: blocker ? [blocker] : [],
		};
	});

	const disagreements = detectTeamsTenantSettingsDisagreements(
		tenants.map((tenant) => ({
			tenantId: tenant.tenantId,
			tenantName: tenant.tenantName,
			setupStatus: tenant.setupStatus,
			settings: tenant.effectiveSettings,
		})),
	);

	return { tenants, disagreements };
}

/**
 * Returns the complete organization-scoped inventory of chat installations across
 * Slack, Microsoft Teams, Telegram, and Discord, including credential source,
 * verification evidence, legacy Teams tenants, settings disagreements, and migration blockers.
 */
export async function getOrganizationChatInstallationsInventory(
	organizationId: string,
	options?: ChatInstallationsRuntimeDeps & { syncLegacy?: boolean },
): Promise<OrganizationChatInstallationsInventory> {
	const db = options?.db ?? defaultDb;
	const now = options?.now ? options.now() : new Date();

	if (options?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(organizationId, options);
	}

	const [
		installations,
		providerSettingsRows,
		switchControlRows,
		slackRow,
		teamsRows,
		telegramRow,
		discordRow,
	] = await Promise.all([
		db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.organizationId, organizationId))
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id)),
		db
			.select()
			.from(chatProviderSettings)
			.where(eq(chatProviderSettings.organizationId, organizationId)),
		db
			.select()
			.from(chatInstallationSwitchControl)
			.where(eq(chatInstallationSwitchControl.organizationId, organizationId)),
		db
			.select()
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId))
			.orderBy(asc(teamsTenantConfig.createdAt), asc(teamsTenantConfig.tenantId)),
		db
			.select()
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);

	const settingsByProvider = new Map(providerSettingsRows.map((row) => [row.provider, row]));
	const enabledSwitchProviders = new Set(switchControlRows.map((row) => row.provider));
	const teamsInstallationByLegacyId = new Map(
		installations
			.filter(
				(row): row is typeof row & { legacyRecordId: string } =>
					row.provider === "teams" &&
					row.legacyTable === "teams_tenant_config" &&
					Boolean(row.legacyRecordId),
			)
			.map((row) => [row.legacyRecordId, row]),
	);

	const teamsTenants: LegacyTeamsTenantInventoryItem[] = teamsRows.map((row) => {
		const linked = teamsInstallationByLegacyId.get(row.id) ?? null;
		const blocker = linked ? buildBlockerFromInstallation(linked) : null;
		return {
			id: row.id,
			tenantId: row.tenantId,
			tenantName: row.tenantName,
			setupStatus: row.setupStatus,
			isUnexpectedStatus: !isKnownLegacySetupStatus("teams", row.setupStatus),
			installationId: linked?.id ?? null,
			installationStatus: linked?.status ?? null,
			credentialSource: linked?.credentialSource ?? "deployment_managed",
			receiverScope: linked?.receiverScope ?? null,
			verificationState: linked?.verificationState ?? "unverified",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			serviceUrlRecorded: Boolean(row.serviceUrl?.trim()),
			effectiveSettings: toEffectiveSettings(row),
			blockers: blocker ? [blocker] : [],
		};
	});

	const teamsSettingsDisagreements = detectTeamsTenantSettingsDisagreements(
		teamsTenants.map((tenant) => ({
			tenantId: tenant.tenantId,
			tenantName: tenant.tenantName,
			setupStatus: tenant.setupStatus,
			settings: tenant.effectiveSettings,
		})),
	);

	const providers = {} as Record<ChatInstallationProvider, ChatProviderInventory>;

	const primaryTeams =
		teamsRows.find((row) => row.setupStatus === "active") ??
		teamsRows.find((row) => row.setupStatus !== "disconnected") ??
		null;
	for (const provider of CHAT_INSTALLATION_PROVIDERS) {
		const providerRows = installations.filter((row) => row.provider === provider);
		const summaries = providerRows.map(toInstallationSummary);

		const currentInstallations = summaries.filter(
			(row) =>
				row.status === "active" ||
				row.status === "legacy_active" ||
				row.status === "remediation_required",
		);
		const candidateInstallations = summaries.filter((row) => row.status === "candidate");
		const retiringInstallations = summaries.filter((row) => row.status === "retiring");

		const blockers: ChatMigrationBlocker[] = [];
		for (const inst of currentInstallations) {
			const blocker = buildBlockerFromInstallation(inst);
			if (blocker) {
				blockers.push(blocker);
			}
		}

		if (provider === "teams" && teamsSettingsDisagreements.length > 0) {
			blockers.push({
				code: "teams_tenant_settings_disagreement",
				provider: "teams",
				installationId: null,
				legacyRecordId: null,
				legacyStatus: null,
				externalLabel: null,
				missingField: null,
				blocksSwitchAndEndpointMutation: false,
			});
		}

		const persistedSettings = settingsByProvider.get(provider);
		let effectiveSettings: ChatEffectiveSettings | null = null;
		if (persistedSettings?.isAuthoritative) {
			effectiveSettings = toEffectiveSettings(persistedSettings);
		} else if (provider === "slack" && slackRow && slackRow.setupStatus !== "disconnected") {
			effectiveSettings = toEffectiveSettings(slackRow);
		} else if (
			provider === "telegram" &&
			telegramRow &&
			telegramRow.setupStatus !== "disconnected"
		) {
			effectiveSettings = toEffectiveSettings(telegramRow);
		} else if (provider === "discord" && discordRow && discordRow.setupStatus !== "disconnected") {
			effectiveSettings = toEffectiveSettings(discordRow);
		} else if (provider === "teams") {
			effectiveSettings = primaryTeams ? toEffectiveSettings(primaryTeams) : null;
		} else if (persistedSettings) {
			effectiveSettings = toEffectiveSettings(persistedSettings);
		}

		const connectionState = deriveProviderConnectionState({
			installations: currentInstallations,
			blockers,
		});

		const hasHardBlocker = blockers.some((b) => b.blocksSwitchAndEndpointMutation);

		providers[provider] = {
			provider,
			connectionState,
			switchEnabled: enabledSwitchProviders.has(provider),
			canSwitchOrMutateEndpoint: !hasHardBlocker,
			currentInstallations,
			candidateInstallations,
			retiringInstallations,
			blockers,
			effectiveSettings,
			teamsTenants: provider === "teams" ? teamsTenants : [],
			teamsSettingsDisagreements: provider === "teams" ? teamsSettingsDisagreements : [],
		};
	}

	return {
		organizationId,
		providers,
		generatedAt: now.toISOString(),
	};
}

export async function getProviderChatInstallationInventory(
	organizationId: string,
	provider: ChatInstallationProvider,
	options?: ChatInstallationsRuntimeDeps & { syncLegacy?: boolean },
): Promise<ChatProviderInventory> {
	const inventory = await getOrganizationChatInstallationsInventory(organizationId, options);
	return inventory.providers[provider];
}

/**
 * Organization-scoped installation resolver for runtime callers.
 * Prefers an `active` switched installation, falling back to `legacy_active` rows
 * before switch, and explicitly surfacing `remediation_required` when blocked.
 */
export async function resolveActiveChatInstallation(
	organizationId: string,
	provider: ChatInstallationProvider,
	options?: ChatInstallationsRuntimeDeps & { syncLegacy?: boolean },
): Promise<ActiveChatInstallationResolution> {
	const db = options?.db ?? defaultDb;
	if (options?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(organizationId, options);
	}

	const rows = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.provider, provider),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	const active = rows.find((row) => row.status === "active");
	if (active) {
		return { kind: "active", installation: toInstallationSummary(active) };
	}

	const legacyActive = rows.filter((row) => row.status === "legacy_active");
	if (legacyActive.length > 0) {
		return { kind: "legacy", installations: legacyActive.map(toInstallationSummary) };
	}

	const blocked = rows.filter((row) => row.status === "remediation_required");
	if (blocked.length > 0) {
		return { kind: "remediation_required", installations: blocked.map(toInstallationSummary) };
	}

	return { kind: "none" };
}

/**
 * Evaluates whether a provider is eligible for app replacement / endpoint mutation.
 * Blocks when duplicate or unknown bot identities or unexpected legacy statuses remain unresolved,
 * or when the additive-default rollout switch control is not enabled.
 */
export async function checkSwitchEligibility(
	organizationId: string,
	provider: ChatInstallationProvider,
	options?: ChatInstallationsRuntimeDeps & { syncLegacy?: boolean },
): Promise<SwitchEligibilityResult> {
	const inventory = await getProviderChatInstallationInventory(organizationId, provider, options);
	return {
		allowed: inventory.switchEnabled && inventory.canSwitchOrMutateEndpoint,
		switchControlEnabled: inventory.switchEnabled,
		blockers: inventory.blockers,
	};
}

/**
 * Upserts an installation-scoped conversation record.
 * Conversations are keyed by (installationId, userId, conversationType) so existing and
 * replacement installations address the same user independently.
 */
export async function upsertInstallationConversation(
	input: {
		organizationId: string;
		installationId: string;
		userId: string;
		employeeId?: string | null;
		externalUserId?: string | null;
		externalConversationId: string;
		conversationType?: string;
		conversationReference?: Record<string, unknown> | null;
		reachabilityStatus?: ChatConversationReachabilityStatus;
		reachabilityReason?: string | null;
		verifiedAt?: Date | null;
		lastUsedAt?: Date | null;
		legacyRecordId?: string | null;
	},
	deps?: Pick<ChatInstallationsRuntimeDeps, "db" | "now">,
): Promise<typeof chatInstallationConversation.$inferSelect> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	const conversationType = input.conversationType ?? "private";

	const [existing] = await db
		.select()
		.from(chatInstallationConversation)
		.where(
			and(
				eq(chatInstallationConversation.organizationId, input.organizationId),
				eq(chatInstallationConversation.installationId, input.installationId),
				eq(chatInstallationConversation.userId, input.userId),
				eq(chatInstallationConversation.conversationType, conversationType),
			),
		)
		.limit(1);

	if (existing) {
		const [updated] = await db
			.update(chatInstallationConversation)
			.set({
				employeeId: input.employeeId ?? existing.employeeId,
				externalUserId: input.externalUserId ?? existing.externalUserId,
				externalConversationId: input.externalConversationId,
				conversationReference: input.conversationReference ?? existing.conversationReference,
				reachabilityStatus: input.reachabilityStatus ?? existing.reachabilityStatus,
				reachabilityReason: input.reachabilityReason ?? existing.reachabilityReason,
				verifiedAt: input.verifiedAt ?? existing.verifiedAt,
				lastUsedAt: input.lastUsedAt ?? now,
				isActive: true,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallationConversation.id, existing.id),
					eq(chatInstallationConversation.organizationId, input.organizationId),
				),
			)
			.returning();
		return updated;
	}

	const [inserted] = await db
		.insert(chatInstallationConversation)
		.values({
			organizationId: input.organizationId,
			installationId: input.installationId,
			userId: input.userId,
			employeeId: input.employeeId ?? null,
			externalUserId: input.externalUserId ?? null,
			externalConversationId: input.externalConversationId,
			conversationType,
			conversationReference: input.conversationReference ?? null,
			reachabilityStatus: input.reachabilityStatus ?? "unknown",
			reachabilityReason: input.reachabilityReason ?? null,
			verifiedAt: input.verifiedAt ?? null,
			lastUsedAt: input.lastUsedAt ?? now,
			isActive: true,
			legacyRecordId: input.legacyRecordId ?? null,
		})
		.returning();

	return inserted;
}

export async function listInstallationConversations(
	organizationId: string,
	installationId: string,
	deps?: Pick<ChatInstallationsRuntimeDeps, "db">,
): Promise<Array<typeof chatInstallationConversation.$inferSelect>> {
	const db = deps?.db ?? defaultDb;
	return db
		.select()
		.from(chatInstallationConversation)
		.where(
			and(
				eq(chatInstallationConversation.organizationId, organizationId),
				eq(chatInstallationConversation.installationId, installationId),
			),
		)
		.orderBy(asc(chatInstallationConversation.createdAt), asc(chatInstallationConversation.id));
}
