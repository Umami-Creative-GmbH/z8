/**
 * Teams Bot Adapter
 *
 * Wraps the Bot Framework CloudAdapter for handling Teams bot messages.
 * This is a multi-tenant bot that serves all Z8 customers.
 */

import {
	type Activity,
	type Attachment,
	CloudAdapter,
	ConfigurationBotFrameworkAuthentication,
	ConfigurationServiceClientCredentialFactory,
	type ConversationReference,
	type TurnContext,
} from "botbuilder";
import { env } from "@/env";
import {
	type ChatDispatchTargetHint,
	type ChatRuntimeTargetDeps,
	readInstallationRevisionSecret,
	resolveSwitchedActiveChatInstallation,
} from "@/lib/chat-installations/runtime-target";
import { createLogger } from "@/lib/logger";
import { type TeamsCallFailure, teamsCallFailureFromError } from "./delivery-outcome";
import { TeamsError } from "./types";

const logger = createLogger("TeamsBotAdapter");

// Legacy deployment-managed singleton adapter instance (for untouched legacy tenants only)
let adapterInstance: CloudAdapter | null = null;

/**
 * Installation-and-revision-scoped adapter cache for organization-owned single-tenant Teams apps.
 * Keyed strictly by `${installationId}:${credentialRevisionId}` so credentials are never mixed
 * across installations or credential revisions.
 */
const installationAdapterCache = new Map<string, CloudAdapter>();

export interface TeamsInstallationBotAdapterConfig {
	installationId: string;
	credentialRevisionId: string;
	appId: string;
	appPassword: string;
	tenantId: string;
}

function installationAdapterCacheKey(installationId: string, credentialRevisionId: string): string {
	return `${installationId}:${credentialRevisionId}`;
}

/**
 * Get or create an installation-and-revision-scoped Bot Framework CloudAdapter
 * configured exclusively for SingleTenant authentication against the organization's Entra tenant.
 */
export function getTeamsInstallationBotAdapter(
	config: TeamsInstallationBotAdapterConfig,
): CloudAdapter {
	const installationId = config.installationId.trim();
	const credentialRevisionId = config.credentialRevisionId.trim();
	const appId = config.appId.trim();
	const appPassword = config.appPassword;
	const tenantId = config.tenantId.trim();

	if (!installationId || !credentialRevisionId || !appId || !appPassword || !tenantId) {
		throw new TeamsError(
			"Single-tenant Teams installation adapter requires installationId, credentialRevisionId, appId, appPassword, and tenantId.",
			"BOT_ERROR",
		);
	}

	const cacheKey = installationAdapterCacheKey(installationId, credentialRevisionId);
	const cached = installationAdapterCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
		MicrosoftAppId: appId,
		MicrosoftAppPassword: appPassword,
		MicrosoftAppType: "SingleTenant",
		MicrosoftAppTenantId: tenantId,
	});

	const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
	const adapter = new CloudAdapter(botFrameworkAuth);

	adapter.onTurnError = async (context: TurnContext, error: Error) => {
		logger.error(
			{
				error: error.message,
				installationId,
				credentialRevisionId,
				activityId: context.activity.id,
				conversationType: context.activity.conversation?.conversationType,
			},
			"Single-tenant Teams bot turn error",
		);
	};

	installationAdapterCache.set(cacheKey, adapter);

	logger.info(
		{ installationId, credentialRevisionId, appId, tenantId, appType: "SingleTenant" },
		"Initialized installation-scoped single-tenant Teams bot adapter",
	);

	return adapter;
}

/**
 * Evicts cached installation-scoped Teams bot adapters during credential rotation or revocation.
 * When `credentialRevisionId` is omitted, evicts all revisions for `installationId`.
 */
export function evictTeamsInstallationBotAdapter(
	installationId: string,
	credentialRevisionId?: string,
): number {
	const trimmedInstallationId = installationId.trim();
	if (!trimmedInstallationId) return 0;

	if (credentialRevisionId !== undefined) {
		const key = installationAdapterCacheKey(trimmedInstallationId, credentialRevisionId.trim());
		return installationAdapterCache.delete(key) ? 1 : 0;
	}

	const prefix = `${trimmedInstallationId}:`;
	let evicted = 0;
	for (const key of installationAdapterCache.keys()) {
		if (key.startsWith(prefix)) {
			installationAdapterCache.delete(key);
			evicted += 1;
		}
	}
	return evicted;
}

/**
 * Sends a synthetic proactive private test message scoped strictly to the supplied
 * installation-and-revision CloudAdapter, appId, and stored personal conversation reference.
 */
export async function sendTeamsProactiveTestMessage(
	adapter: CloudAdapter,
	appId: string,
	conversationReference: ConversationReference,
	message: string,
): Promise<TeamsSendResult> {
	const trimmedAppId = appId.trim();
	if (!trimmedAppId) {
		return { kind: "failed", status: 400, code: "missing_app_id" };
	}

	try {
		let activityId: string | null = null;
		await withinTimeout(
			adapter.continueConversationAsync(
				trimmedAppId,
				conversationReference,
				async (turnContext) => {
					const response = await turnContext.sendActivity({
						type: "message",
						text: message,
					});
					activityId = response?.id ?? null;
				},
			),
		);
		return { kind: "ok", activityId };
	} catch (error) {
		logger.warn(
			{ error, appId: trimmedAppId, conversationId: conversationReference.conversation?.id },
			"Teams proactive private test message failed",
		);
		return teamsCallFailureFromError(error);
	}
}

/**
 * Get or create the Bot Framework adapter
 *
 * Uses environment variables for bot credentials:
 * - MICROSOFT_APP_ID
 * - MICROSOFT_APP_PASSWORD
 * - MICROSOFT_APP_TYPE (default: "MultiTenant")
 */
export function getBotAdapter(): CloudAdapter {
	if (adapterInstance) {
		return adapterInstance;
	}

	const appId = env.MICROSOFT_APP_ID;
	const appPassword = env.MICROSOFT_APP_PASSWORD;
	const appType = (env.MICROSOFT_APP_TYPE as "MultiTenant" | "SingleTenant") || "MultiTenant";

	if (!appId || !appPassword) {
		throw new TeamsError(
			"Teams bot credentials not configured. Set MICROSOFT_APP_ID and MICROSOFT_APP_PASSWORD.",
			"BOT_ERROR",
		);
	}

	const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
		MicrosoftAppId: appId,
		MicrosoftAppPassword: appPassword,
		MicrosoftAppType: appType,
	});

	const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
	adapterInstance = new CloudAdapter(botFrameworkAuth);

	// Global error handler
	adapterInstance.onTurnError = async (context: TurnContext, error: Error) => {
		logger.error(
			{
				error: error.message,
				stack: error.stack,
				activityId: context.activity.id,
				conversationType: context.activity.conversation?.conversationType,
			},
			"Bot turn error",
		);

		// Send error message to user
		try {
			await context.sendActivity(
				"Sorry, something went wrong processing your request. Please try again.",
			);
		} catch (sendError) {
			logger.error({ error: sendError }, "Failed to send error message to user");
		}
	};

	logger.info({ appId, appType }, "Bot adapter initialized");

	return adapterInstance;
}

export interface TeamsOutboundTransport {
	adapter: CloudAdapter;
	appId: string;
}

export type TeamsOutboundTransportResolution =
	| {
			kind: "ok";
			source: "organization_owned" | "deployment_managed";
			adapter: CloudAdapter;
			appId: string;
			installationId: string | null;
			credentialRevisionId: string | null;
	  }
	| {
			kind: "unavailable";
			reason:
				| "bot_unavailable"
				| "missing_installation_credentials"
				| "missing_installation_identity";
	  };

/**
 * Resolves the Bot Framework transport for outbound Teams delivery.
 * When an organization has an active organization-owned Teams installation (or an explicit
 * org-owned dispatch target is requested), resolves its installation+revision-scoped
 * SingleTenant CloudAdapter from Vault/Scaleway completely independently of deployment env vars.
 */
export async function resolveTeamsOutboundTransportForOrganization(
	organizationId: string,
	options?: ChatDispatchTargetHint &
		ChatRuntimeTargetDeps & {
			getAdapter?: (config: TeamsInstallationBotAdapterConfig) => CloudAdapter;
		},
): Promise<TeamsOutboundTransportResolution> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "teams", options);
	if (resolution.kind === "organization_owned_active") {
		const target = resolution.target;
		if (!target.externalAppId || !target.externalSpaceId || !target.credentialRevisionId) {
			return { kind: "unavailable", reason: "missing_installation_identity" };
		}
		const appPassword = await readInstallationRevisionSecret(
			{
				organizationId,
				installationId: target.installationId,
				credentialRevisionId: target.credentialRevisionId,
				secretKeyNames: ["microsoft_app_password"],
			},
			options,
		);
		if (!appPassword) {
			return { kind: "unavailable", reason: "missing_installation_credentials" };
		}
		const getAdapter = options?.getAdapter ?? getTeamsInstallationBotAdapter;
		const adapter = getAdapter({
			installationId: target.installationId,
			credentialRevisionId: target.credentialRevisionId,
			appId: target.externalAppId,
			appPassword,
			tenantId: target.externalSpaceId,
		});
		return {
			kind: "ok",
			source: "organization_owned",
			adapter,
			appId: target.externalAppId,
			installationId: target.installationId,
			credentialRevisionId: target.credentialRevisionId,
		};
	}

	if (!isBotConfigured() || !env.MICROSOFT_APP_ID) {
		return { kind: "unavailable", reason: "bot_unavailable" };
	}

	return {
		kind: "ok",
		source: "deployment_managed",
		adapter: getBotAdapter(),
		appId: env.MICROSOFT_APP_ID,
		installationId: resolution.installationId,
		credentialRevisionId: null,
	};
}

/**
 * Send a proactive message to a user
 *
 * @param conversationReference - Stored conversation reference
 * @param activity - Activity to send (message, card, etc.)
 * @param transport - Optional installation-scoped adapter + appId (bypasses deployment env vars)
 * @returns Activity ID of the sent message
 */
export async function sendProactiveMessage(
	conversationReference: ConversationReference,
	activity: Partial<Activity>,
	transport?: TeamsOutboundTransport,
): Promise<string | undefined> {
	const adapter = transport ? transport.adapter : getBotAdapter();
	const appId = transport ? transport.appId : env.MICROSOFT_APP_ID;

	if (!appId) {
		throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
	}

	let activityId: string | undefined;

	try {
		await adapter.continueConversationAsync(appId, conversationReference, async (turnContext) => {
			const response = await turnContext.sendActivity(activity);
			activityId = response?.id;
		});

		logger.debug(
			{
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Sent proactive message",
		);

		return activityId;
	} catch (error) {
		logger.error(
			{
				error,
				conversationId: conversationReference.conversation?.id,
			},
			"Failed to send proactive message",
		);
		throw new TeamsError("Failed to send proactive message", "PROACTIVE_MESSAGE_FAILED", {
			originalError: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Send an Adaptive Card to a user
 *
 * @param conversationReference - Stored conversation reference
 * @param card - Adaptive Card payload
 * @param text - Fallback text for clients that don't support cards
 * @param transport - Optional installation-scoped adapter + appId
 * @returns Activity ID of the sent message
 */
export async function sendAdaptiveCard(
	conversationReference: ConversationReference,
	// oxlint-disable-next-line typescript/no-explicit-any -- Adaptive Cards are flexible JSON
	card: any,
	text?: string,
	transport?: TeamsOutboundTransport,
): Promise<string | undefined> {
	const attachment: Attachment = {
		contentType: "application/vnd.microsoft.card.adaptive",
		content: card,
	};

	return sendProactiveMessage(
		conversationReference,
		{
			type: "message",
			text: text || "",
			attachments: [attachment],
		},
		transport,
	);
}

/**
 * Update an existing message (e.g., update approval card after action)
 *
 * @param conversationReference - Stored conversation reference
 * @param activityId - ID of the activity to update
 * @param updatedActivity - New activity content
 * @param transport - Optional installation-scoped adapter + appId
 */
export async function updateMessage(
	conversationReference: ConversationReference,
	activityId: string,
	updatedActivity: Partial<Activity>,
	transport?: TeamsOutboundTransport,
): Promise<void> {
	const adapter = transport ? transport.adapter : getBotAdapter();
	const appId = transport ? transport.appId : env.MICROSOFT_APP_ID;

	if (!appId) {
		throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
	}

	try {
		await adapter.continueConversationAsync(appId, conversationReference, async (turnContext) => {
			await turnContext.updateActivity({
				...updatedActivity,
				id: activityId,
			});
		});

		logger.debug(
			{
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Updated message",
		);
	} catch (error) {
		logger.error(
			{
				error,
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Failed to update message",
		);
		throw new TeamsError("Failed to update message", "CARD_UPDATE_FAILED", {
			originalError: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Long enough for one connector call, well inside a delivery lease. */
const TEAMS_CALL_TIMEOUT_MS = 30_000;

async function withinTimeout<T>(work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(Object.assign(new Error("Teams call timed out"), { name: "TimeoutError" })),
			TEAMS_CALL_TIMEOUT_MS,
		);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export type TeamsSendResult = { kind: "ok"; activityId: string | null } | TeamsCallFailure;
export type TeamsUpdateResult = { kind: "ok" } | TeamsCallFailure;

/**
 * Proactive send with an explicit outcome for the approval delivery owner:
 * the remote activity ID on success, otherwise what the connector reported.
 * A timeout is `unknown` because Teams may still have posted the message.
 */
export async function sendActivityWithOutcome(
	conversationReference: ConversationReference,
	activity: Partial<Activity>,
	transport?: TeamsOutboundTransport,
): Promise<TeamsSendResult> {
	try {
		const adapter = transport ? transport.adapter : getBotAdapter();
		const appId = transport ? transport.appId : env.MICROSOFT_APP_ID;
		if (!appId) throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
		let activityId: string | null = null;
		await withinTimeout(
			adapter.continueConversationAsync(appId, conversationReference, async (turnContext) => {
				const response = await turnContext.sendActivity(activity);
				activityId = response?.id ?? null;
			}),
		);
		return { kind: "ok", activityId };
	} catch (error) {
		logger.warn(
			{ error, conversationId: conversationReference.conversation?.id },
			"Teams send failed",
		);
		return teamsCallFailureFromError(error);
	}
}

/** Updates one sent message in place, with an explicit outcome. */
export async function updateActivityWithOutcome(
	conversationReference: ConversationReference,
	activityId: string,
	activity: Partial<Activity>,
	transport?: TeamsOutboundTransport,
): Promise<TeamsUpdateResult> {
	try {
		const adapter = transport ? transport.adapter : getBotAdapter();
		const appId = transport ? transport.appId : env.MICROSOFT_APP_ID;
		if (!appId) throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
		await withinTimeout(
			adapter.continueConversationAsync(appId, conversationReference, async (turnContext) => {
				await turnContext.updateActivity({ ...activity, id: activityId });
			}),
		);
		return { kind: "ok" };
	} catch (error) {
		logger.warn(
			{ error, conversationId: conversationReference.conversation?.id, activityId },
			"Teams update failed",
		);
		return teamsCallFailureFromError(error);
	}
}

/**
 * Check if the bot adapter is properly configured
 */
export function isBotConfigured(): boolean {
	return !!(env.MICROSOFT_APP_ID && env.MICROSOFT_APP_PASSWORD);
}
