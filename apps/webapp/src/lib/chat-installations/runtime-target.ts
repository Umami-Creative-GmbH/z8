import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatCredentialSource,
	type ChatInstallationProvider,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatProviderSettings,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ChatEffectiveSettings } from "./types";

const logger = createLogger("ChatInstallationRuntimeTarget");

export interface ChatDispatchTargetHint {
	installationId?: string | null;
	credentialRevisionId?: string | null;
}

export interface ChatRuntimeTargetDeps {
	db?: Pick<typeof defaultDb, "select">;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
}

export interface SwitchedActiveChatInstallation {
	installationId: string;
	organizationId: string;
	provider: ChatInstallationProvider;
	credentialSource: ChatCredentialSource;
	credentialRevisionId: string | null;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	routeId: string;
	effectiveSettings: ChatEffectiveSettings;
}

export type ChatDeliveryTargetResolution =
	| {
			kind: "organization_owned_active";
			target: SwitchedActiveChatInstallation;
	  }
	| {
			kind: "legacy_fallback";
			installationId: string | null;
	  };

const DEFAULT_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

function canQuerySelect(db: unknown): db is Pick<typeof defaultDb, "select"> {
	return (
		typeof db === "object" &&
		db !== null &&
		"select" in db &&
		typeof (db as { select?: unknown }).select === "function"
	);
}

function toEffectiveSettings(
	row: typeof chatProviderSettings.$inferSelect | undefined | null,
): ChatEffectiveSettings {
	if (!row) return { ...DEFAULT_EFFECTIVE_SETTINGS };
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

function toSwitchedActiveTarget(
	inst: typeof chatInstallation.$inferSelect,
	settingsRow: typeof chatProviderSettings.$inferSelect | undefined | null,
	credentialRevisionIdOverride?: string | null,
): SwitchedActiveChatInstallation {
	return {
		installationId: inst.id,
		organizationId: inst.organizationId,
		provider: inst.provider,
		credentialSource: inst.credentialSource,
		credentialRevisionId: credentialRevisionIdOverride ?? inst.activeCredentialRevisionId ?? null,
		externalAppId: inst.externalAppId,
		externalBotId: inst.externalBotId,
		externalBotUsername: inst.externalBotUsername,
		externalDisplayName: inst.externalDisplayName,
		externalSpaceId: inst.externalSpaceId,
		externalSpaceName: inst.externalSpaceName,
		receiverScope: inst.receiverScope,
		routeId: inst.routeId,
		effectiveSettings: toEffectiveSettings(settingsRow),
	};
}

/**
 * Resolves the active switched organization-owned chat installation for `(organizationId, provider)`,
 * or an explicitly targeted installation from a recorded durable dispatch intent.
 *
 * Returns `{ kind: "legacy_fallback" }` when no switched org-owned installation is active
 * (or when running against partial unit-test DB mocks without `.select`).
 */
export async function resolveSwitchedActiveChatInstallation(
	organizationId: string,
	provider: ChatInstallationProvider,
	options?: ChatDispatchTargetHint & ChatRuntimeTargetDeps,
): Promise<ChatDeliveryTargetResolution> {
	const db = options?.db ?? defaultDb;
	if (!canQuerySelect(db)) {
		return { kind: "legacy_fallback", installationId: null };
	}

	let inst: typeof chatInstallation.$inferSelect | undefined;
	if (options?.installationId) {
		const [explicitRow] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, options.installationId),
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, provider),
				),
			)
			.limit(1);
		inst = explicitRow;
	} else {
		const [activeRow] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, provider),
					eq(chatInstallation.status, "active"),
				),
			)
			.limit(1);
		inst = activeRow;
	}

	if (!inst) {
		return { kind: "legacy_fallback", installationId: null };
	}

	const revisionId = options?.credentialRevisionId ?? inst.activeCredentialRevisionId ?? null;
	// A legacy installation without an immutable credential revision continues using legacy config.
	if (inst.credentialSource !== "organization_owned" || !revisionId) {
		return { kind: "legacy_fallback", installationId: inst.id };
	}

	const [settingsRow] = await db
		.select()
		.from(chatProviderSettings)
		.where(
			and(
				eq(chatProviderSettings.organizationId, organizationId),
				eq(chatProviderSettings.provider, provider),
			),
		)
		.limit(1);

	return {
		kind: "organization_owned_active",
		target: toSwitchedActiveTarget(inst, settingsRow, revisionId),
	};
}

/**
 * Lists all switched `active` organization-owned chat installations for a provider,
 * used by non-ledger scheduled daily digest jobs so future runs follow the active
 * installation without replaying prior runs.
 */
export async function listSwitchedActiveChatInstallationsForProvider(
	provider: ChatInstallationProvider,
	deps?: ChatRuntimeTargetDeps,
): Promise<SwitchedActiveChatInstallation[]> {
	const db = deps?.db ?? defaultDb;
	if (!canQuerySelect(db)) {
		return [];
	}

	const installations = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.provider, provider),
				eq(chatInstallation.status, "active"),
				eq(chatInstallation.credentialSource, "organization_owned"),
				isNotNull(chatInstallation.activeCredentialRevisionId),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	if (installations.length === 0) return [];

	const settingsRows = await db
		.select()
		.from(chatProviderSettings)
		.where(eq(chatProviderSettings.provider, provider));

	const settingsByOrg = new Map(settingsRows.map((row) => [row.organizationId, row]));

	return installations.map((inst) =>
		toSwitchedActiveTarget(inst, settingsByOrg.get(inst.organizationId)),
	);
}

/**
 * Resolves the exact secret store key for a named secret inside an immutable
 * `chat_installation_credential_revision` record and reads it from Vault/Scaleway.
 */
export async function readInstallationRevisionSecret(
	input: {
		organizationId: string;
		installationId: string;
		credentialRevisionId: string;
		secretKeyNames: readonly string[];
	},
	deps?: ChatRuntimeTargetDeps,
): Promise<string | null> {
	const db = deps?.db ?? defaultDb;
	if (!canQuerySelect(db)) return null;

	const [revision] = await db
		.select()
		.from(chatInstallationCredentialRevision)
		.where(
			and(
				eq(chatInstallationCredentialRevision.id, input.credentialRevisionId),
				eq(chatInstallationCredentialRevision.installationId, input.installationId),
				eq(chatInstallationCredentialRevision.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!revision) {
		logger.warn(
			{
				organizationId: input.organizationId,
				installationId: input.installationId,
				credentialRevisionId: input.credentialRevisionId,
			},
			"Chat installation credential revision not found",
		);
		return null;
	}

	const prefix = revision.secretKeyPrefix.replace(/\/+$/, "");
	let resolvedKey: string | null = null;

	const storedKeys = new Set(revision.secretKeys);
	for (const candidate of input.secretKeyNames) {
		const exactFullMatch = revision.secretKeys.find(
			(key) => key === `${prefix}/${candidate}` || key.endsWith(`/${candidate}`),
		);
		if (exactFullMatch) {
			resolvedKey = exactFullMatch;
			break;
		}
		if (storedKeys.has(candidate)) {
			resolvedKey = `${prefix}/${candidate}`;
			break;
		}
	}

	if (!resolvedKey) {
		logger.warn(
			{
				organizationId: input.organizationId,
				installationId: input.installationId,
				credentialRevisionId: input.credentialRevisionId,
			},
			"Requested secret key name not present in credential revision metadata",
		);
		return null;
	}

	const readSecret = deps?.readSecret ?? getOrgSecret;
	return readSecret(input.organizationId, resolvedKey);
}

/**
 * Resolves the active installation-scoped conversation for a user.
 * Keeps conversations strictly scoped to the selected installation so an existing
 * installation and its replacement address the same user independently.
 */
export async function resolveInstallationConversationForUser(
	input: {
		organizationId: string;
		installationId: string;
		userId: string;
		conversationTypes?: readonly string[];
	},
	deps?: Pick<ChatRuntimeTargetDeps, "db">,
): Promise<{
	externalConversationId: string;
	conversationReference: Record<string, unknown> | null;
	externalUserId: string | null;
} | null> {
	const db = deps?.db ?? defaultDb;
	if (!canQuerySelect(db)) return null;

	const rows = await db
		.select({
			externalConversationId: chatInstallationConversation.externalConversationId,
			conversationReference: chatInstallationConversation.conversationReference,
			externalUserId: chatInstallationConversation.externalUserId,
			conversationType: chatInstallationConversation.conversationType,
		})
		.from(chatInstallationConversation)
		.where(
			and(
				eq(chatInstallationConversation.organizationId, input.organizationId),
				eq(chatInstallationConversation.installationId, input.installationId),
				eq(chatInstallationConversation.userId, input.userId),
				eq(chatInstallationConversation.isActive, true),
			),
		)
		.orderBy(
			desc(chatInstallationConversation.lastUsedAt),
			desc(chatInstallationConversation.createdAt),
		);

	const conversationTypes = new Set(input.conversationTypes);
	const matched =
		conversationTypes.size > 0
			? rows.find((row) => conversationTypes.has(row.conversationType))
			: rows[0];

	if (!matched) return null;
	return {
		externalConversationId: matched.externalConversationId,
		conversationReference: matched.conversationReference,
		externalUserId: matched.externalUserId,
	};
}

/**
 * Lists all active user conversations belonging to one specific chat installation.
 */
export async function listInstallationActiveConversations(
	input: {
		organizationId: string;
		installationId: string;
		conversationTypes?: readonly string[];
	},
	deps?: Pick<ChatRuntimeTargetDeps, "db">,
): Promise<
	Array<{
		userId: string;
		externalConversationId: string;
		conversationReference: Record<string, unknown> | null;
	}>
> {
	const db = deps?.db ?? defaultDb;
	if (!canQuerySelect(db)) return [];

	const rows = await db
		.select({
			userId: chatInstallationConversation.userId,
			externalConversationId: chatInstallationConversation.externalConversationId,
			conversationReference: chatInstallationConversation.conversationReference,
			conversationType: chatInstallationConversation.conversationType,
		})
		.from(chatInstallationConversation)
		.where(
			and(
				eq(chatInstallationConversation.organizationId, input.organizationId),
				eq(chatInstallationConversation.installationId, input.installationId),
				eq(chatInstallationConversation.isActive, true),
				isNotNull(chatInstallationConversation.userId),
			),
		)
		.orderBy(asc(chatInstallationConversation.createdAt), asc(chatInstallationConversation.id));

	const conversationTypes = new Set(input.conversationTypes);
	return rows
		.filter(
			(row): row is typeof row & { userId: string } =>
				row.userId !== null &&
				(conversationTypes.size === 0 || conversationTypes.has(row.conversationType)),
		)
		.map((row) => ({
			userId: row.userId,
			externalConversationId: row.externalConversationId,
			conversationReference: row.conversationReference,
		}));
}
