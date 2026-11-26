/**
 * Teams Bot Message Handler
 *
 * Main entry point for handling incoming Teams bot messages.
 * Routes messages to appropriate handlers based on activity type.
 */

import { type Activity, TurnContext } from "botbuilder";
import { env } from "@/env";
import { executeCommand, parseCommand } from "@/lib/bot-platform/command-registry";
import { type BotTranslateFn, getBotTranslate, getUserLocale } from "@/lib/bot-platform/i18n";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { handleApprovalAction, handleBoundApprovalInvoke } from "./approval-handler";
import { parseTeamsBoundApprovalInvoke } from "./bound-approval";
import { deactivateConversation, saveConversationReference } from "./conversation-manager";
import { handleShiftPickupAction } from "./shift-pickup-handler";
import { resolveTenant, updateTenantServiceUrl } from "./tenant-resolver";
import { type ResolvedTenant, TeamsError } from "./types";
import { resolveTeamsUser, resolveTeamsUserForInstallation } from "./user-resolver";
import { parseTeamsVehicleUseInvoke } from "./vehicle-use-card";

const logger = createLogger("TeamsBotHandler");

export interface InstallationBotActivityHooks {
	saveInstallationConversation?: (input: {
		context: TurnContext;
		userId: string;
		employeeId: string;
		externalUserId: string;
	}) => Promise<void>;
	deactivateInstallationConversation?: (conversationId: string) => Promise<void>;
	redeemLinkCode?: (input: {
		code: string;
		aadObjectId: string;
		displayName: string | null;
		conversationId: string;
		conversationRef: Record<string, unknown>;
	}) => Promise<{ status: "success" | "failed"; replyText: string }>;
}

/** Who a turn turned out to come from, as far as it got before a failure. */
interface TurnRecipient {
	organizationId?: string;
	userId?: string;
}

/**
 * An error reply's language: the recipient language once the tenant's
 * organization is known (the linked user's own, else the organization's
 * default), otherwise `en`. A failed lookup must not stop the reply.
 */
async function errorReplyLocale(recipient: TurnRecipient): Promise<string> {
	if (!recipient.organizationId) return DEFAULT_LANGUAGE;
	return getUserLocale({
		userId: recipient.userId ?? null,
		organizationId: recipient.organizationId,
	}).catch(() => DEFAULT_LANGUAGE);
}

/**
 * Handle incoming bot activity
 *
 * This is the main entry point called by the API route.
 *
 * @param context - Bot Framework turn context
 */
export async function handleBotActivity(context: TurnContext): Promise<void> {
	const activity = context.activity;

	logger.debug(
		{
			activityType: activity.type,
			activityId: activity.id,
			conversationType: activity.conversation?.conversationType,
		},
		"Received bot activity",
	);

	const recipient: TurnRecipient = {};
	try {
		switch (activity.type) {
			case "message":
				await handleMessage(context, recipient);
				break;

			case "invoke":
				await handleInvoke(context, recipient);
				break;

			case "conversationUpdate":
				await handleConversationUpdate(context);
				break;

			case "installationUpdate":
				await handleInstallationUpdate(context);
				break;

			default:
				logger.debug({ activityType: activity.type }, "Unhandled activity type");
		}
	} catch (error) {
		logger.error({ error, activityType: activity.type }, "Error handling bot activity");

		const t = await getBotTranslate(await errorReplyLocale(recipient));
		if (error instanceof TeamsError) {
			// Send user-friendly error message
			await context.sendActivity(getErrorMessage(error, t));
		} else {
			await context.sendActivity(
				t(
					"bot.static.genericError",
					"Sorry, something went wrong. Please try again or contact support.",
				),
			);
		}
	}
}

/**
 * Handle incoming bot activity for a pre-resolved installation-scoped Teams tenant
 * (`active`, `retiring`, or `revoked`/`retired` single-tenant org-owned Teams apps, #2050).
 */
export async function handleBotActivityForTenant(
	context: TurnContext,
	tenant: ResolvedTenant,
	hooks?: InstallationBotActivityHooks,
): Promise<void> {
	const activity = context.activity;
	const recipient: TurnRecipient = { organizationId: tenant.organizationId };

	if (tenant.installationStatus === "revoked" || tenant.installationStatus === "retired") {
		if (activity.type === "invoke") {
			await context.sendActivity({
				type: "invokeResponse",
				value: { status: 403 },
			});
		}
		return;
	}

	try {
		switch (activity.type) {
			case "message":
				await handleMessageForResolvedTenant(context, tenant, recipient, hooks);
				break;

			case "invoke":
				await handleInvokeForResolvedTenant(context, tenant, recipient);
				break;

			case "conversationUpdate":
				await handleConversationUpdateForResolvedTenant(context, tenant, hooks);
				break;

			case "installationUpdate":
				logger.info(
					{
						action: activity.action,
						organizationId: tenant.organizationId,
						installationId: tenant.installationId ?? null,
					},
					"Installation update for organization-owned Teams app",
				);
				break;

			default:
				logger.debug({ activityType: activity.type }, "Unhandled installation activity type");
		}
	} catch (error) {
		logger.error(
			{ error, activityType: activity.type, installationId: tenant.installationId ?? null },
			"Error handling installation-scoped Teams activity",
		);
		const t = await getBotTranslate(await errorReplyLocale(recipient));
		if (error instanceof TeamsError) {
			await context.sendActivity(getErrorMessage(error, t));
		} else {
			await context.sendActivity(
				t(
					"bot.static.genericError",
					"Sorry, something went wrong. Please try again or contact support.",
				),
			);
		}
	}
}

function extractActiveLinkCode(text: string): string | null {
	const match = /^(?:\/?link|\/?enroll)\s+([A-Za-z0-9-\s]+)$/i.exec(text.trim());
	return match?.[1]?.trim() || null;
}

async function handleMessageForResolvedTenant(
	context: TurnContext,
	tenant: ResolvedTenant,
	recipient: TurnRecipient,
	hooks?: InstallationBotActivityHooks,
): Promise<void> {
	const activity = context.activity;

	if (tenant.installationStatus === "retiring") {
		const t = await getBotTranslate(
			await getUserLocale({ userId: null, organizationId: tenant.organizationId }),
		);
		await context.sendActivity(
			t(
				"bot.static.retiringTeamsNotice",
				"This legacy Z8 Teams app is retiring. Existing approval cards remain actionable here, while new commands and notifications use your organization's active Z8 Teams app.",
			),
		);
		return;
	}

	const teamsUserId = activity.from?.aadObjectId;
	const teamsDisplayName = activity.from?.name ?? null;
	if (!teamsUserId) {
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await context.sendActivity(t("bot.static.noUser", "Unable to identify your user account."));
		return;
	}

	const text = activity.text?.trim() || "";
	const cleanedText = removeBotMention(text, activity);

	// Allow employees to redeem an organization- and installation-bound link code directly in 1:1 chat.
	if (
		hooks?.redeemLinkCode &&
		activity.conversation?.conversationType === "personal" &&
		activity.conversation?.id &&
		activity.serviceUrl
	) {
		const linkCode = extractActiveLinkCode(cleanedText);
		if (linkCode) {
			const conversationRef = TurnContext.getConversationReference(activity) as unknown as Record<
				string,
				unknown
			>;
			const redemption = await hooks.redeemLinkCode({
				code: linkCode,
				aadObjectId: teamsUserId,
				displayName: teamsDisplayName,
				conversationId: activity.conversation.id,
				conversationRef,
			});
			await context.sendActivity(redemption.replyText);
			return;
		}
	}

	if (!tenant.enableCommands) {
		return;
	}

	const userResult = tenant.installationId
		? await resolveTeamsUserForInstallation({
				teamsUserId,
				teamsTenantId: tenant.tenantId,
				organizationId: tenant.organizationId,
				installationId: tenant.installationId,
			})
		: await resolveTeamsUser(
				teamsUserId,
				null,
				tenant.tenantId,
				teamsDisplayName ?? undefined,
				tenant.organizationId,
			);

	if (userResult.status === "found") {
		recipient.userId = userResult.user.userId;
		if (hooks?.saveInstallationConversation) {
			await hooks.saveInstallationConversation({
				context,
				userId: userResult.user.userId,
				employeeId: userResult.user.employeeId,
				externalUserId: teamsUserId,
			});
		} else {
			await saveConversationReference(context, userResult.user.userId, tenant.organizationId);
		}
	}

	const locale = await getUserLocale({
		userId: userResult.status === "found" ? userResult.user.userId : null,
		organizationId: tenant.organizationId,
	});
	const t = await getBotTranslate(locale);

	const parsed = parseCommand(cleanedText);
	if (!parsed?.command) {
		await context.sendActivity(
			t("bot.static.mentionHelp", 'Hi! I\'m the Z8 bot. Type "help" to see available commands.'),
		);
		return;
	}

	if (userResult.status !== "found") {
		const command = parsed.command.toLowerCase();
		if (command !== "help" && command !== "?") {
			if (userResult.status === "not_linked") {
				await context.sendActivity(
					t(
						"bot.static.notLinkedTeamsLinkCode",
						"Your Microsoft Teams account is not linked to Z8 yet. Open Settings → Notifications in Z8 to generate a link code, then send 'link <CODE>' here.",
					),
				);
			} else if (userResult.status === "no_employee") {
				await context.sendActivity(
					t(
						"bot.static.noEmployee",
						"Your account exists but you don't have an employee record in Z8.",
					),
				);
			}
			return;
		}
	}

	const commandContext: BotCommandContext = {
		platform: "teams",
		organizationId: tenant.organizationId,
		employeeId: userResult.status === "found" ? userResult.user.employeeId : "",
		userId: userResult.status === "found" ? userResult.user.userId : "",
		platformUserId: teamsUserId,
		invocationId:
			activity.conversation?.id && activity.id
				? `${activity.conversation.id}:${activity.id}`
				: undefined,
		config: {
			organizationId: tenant.organizationId,
			enableApprovals: tenant.enableApprovals,
			enableCommands: tenant.enableCommands,
			enableDailyDigest: tenant.enableDailyDigest,
			enableEscalations: tenant.enableEscalations,
			digestTime: tenant.digestTime,
			digestTimezone: tenant.digestTimezone,
			escalationTimeoutHours: tenant.escalationTimeoutHours,
		},
		args: parsed.args,
		locale,
	};

	const response = await executeCommand(parsed.command, commandContext);
	try {
		if (response.type === "card" && response.card) {
			await context.sendActivity({
				type: "message",
				text: response.text,
				attachments: [
					{
						contentType: "application/vnd.microsoft.card.adaptive",
						content: response.card,
					},
				],
			});
		} else {
			await context.sendActivity(response.text);
		}
	} catch (error) {
		logger.error({ error, command: parsed.command }, "Failed to deliver command reply");
		try {
			await context.sendActivity(
				t(
					"bot.static.replyUndelivered",
					"Your command was processed, but its reply could not be shown. Check your status before repeating it.",
				),
			);
		} catch {
			// Nothing more we can do
		}
	}
}

async function handleInvokeForResolvedTenant(
	context: TurnContext,
	tenant: ResolvedTenant,
	recipient: TurnRecipient,
): Promise<void> {
	const activity = context.activity;
	const value = activity.value;
	const teamsUserId = activity.from?.aadObjectId;

	if (!teamsUserId) {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 401 },
		});
		return;
	}

	const userResult = tenant.installationId
		? await resolveTeamsUserForInstallation({
				teamsUserId,
				teamsTenantId: tenant.tenantId,
				organizationId: tenant.organizationId,
				installationId: tenant.installationId,
			})
		: await resolveTeamsUser(teamsUserId, null, tenant.tenantId, undefined, tenant.organizationId);

	if (userResult.status !== "found") {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 401 },
		});
		return;
	}
	recipient.userId = userResult.user.userId;

	const bound = parseTeamsBoundApprovalInvoke(activity);
	if (bound.kind !== "none") {
		const response = await handleBoundApprovalInvoke(context, bound, userResult.user, tenant);
		await context.sendActivity({ type: "invokeResponse", value: response });
		return;
	}

	if (
		(value?.action === "approve" || value?.action === "reject") &&
		typeof value?.approvalId === "string"
	) {
		await handleApprovalAction(context, value.approvalId, value.action, userResult.user, tenant);
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 200 },
		});
		return;
	}

	// Retiring installations ONLY service eligible old approval cards — refuse non-approval actions.
	if (tenant.installationStatus === "retiring") {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 403 },
		});
		return;
	}

	const vehicleUse = parseTeamsVehicleUseInvoke(activity);
	if (vehicleUse.kind !== "none") {
		const { handleTeamsVehicleUseInvoke } = await import("./vehicle-use-prompt");
		const response = await handleTeamsVehicleUseInvoke(vehicleUse, userResult.user, tenant);
		await context.sendActivity({ type: "invokeResponse", value: response });
		return;
	}

	if (value?.action === "shift_pickup" && value?.shiftId) {
		await handleShiftPickupAction(context, value.shiftId, userResult.user.employeeId, tenant);
	}

	await context.sendActivity({
		type: "invokeResponse",
		value: { status: 200 },
	});
}

async function handleConversationUpdateForResolvedTenant(
	context: TurnContext,
	tenant: ResolvedTenant,
	hooks?: InstallationBotActivityHooks,
): Promise<void> {
	const activity = context.activity;
	if (tenant.installationStatus === "retiring") {
		return;
	}

	if (activity.membersAdded?.some((member) => member.id === activity.recipient?.id)) {
		const t = await getBotTranslate(
			await getUserLocale({ userId: null, organizationId: tenant.organizationId }),
		);
		await context.sendActivity(
			t("bot.static.welcomeTeams", 'Welcome to Z8! Type "help" to see available commands.'),
		);
	}

	if (activity.membersRemoved?.some((member) => member.id === activity.recipient?.id)) {
		const conversationId = activity.conversation?.id;
		if (conversationId) {
			if (hooks?.deactivateInstallationConversation) {
				await hooks.deactivateInstallationConversation(conversationId);
			} else {
				await deactivateConversation(conversationId, tenant.organizationId);
			}
		}
	}
}

/**
 * Handle incoming message activity (user typed something)
 */
async function handleMessage(context: TurnContext, recipient: TurnRecipient): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	if (!tenantId) {
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await context.sendActivity(
			t("bot.static.noOrg", "Unable to identify your organization. Please contact support."),
		);
		return;
	}

	// Resolve tenant
	const tenantResult = await resolveTenant(tenantId);

	if (tenantResult.status === "not_found") {
		// New tenant - send setup instructions
		await sendSetupInstructions(context, tenantId);
		return;
	}

	if (tenantResult.status === "unconfigured") {
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await context.sendActivity(
			t(
				"bot.static.unconfigured",
				"Your organization's Z8 integration is being set up. Please wait for your admin to complete configuration.",
			),
		);
		return;
	}

	const tenant = tenantResult.tenant;
	recipient.organizationId = tenant.organizationId;

	if (tenant.installationStatus === "retiring") {
		const t = await getBotTranslate(
			await getUserLocale({ userId: null, organizationId: tenant.organizationId }),
		);
		await context.sendActivity(
			t(
				"bot.static.retiringTeamsNotice",
				"This legacy Z8 Teams app is retiring. Existing approval cards remain actionable here, while new commands and notifications use your organization's active Z8 Teams app.",
			),
		);
		return;
	}

	// Update service URL if needed
	if (activity.serviceUrl) {
		await updateTenantServiceUrl(tenantId, activity.serviceUrl);
	}

	// Check if commands are enabled
	if (!tenant.enableCommands) {
		// Only respond to system events, not user commands
		return;
	}

	// Resolve user
	const teamsUserId = activity.from?.aadObjectId;
	// Email is not available on ChannelAccount in Teams - use aadObjectId for identity
	// Email will be matched from the user's Z8 account if they're linked
	const teamsEmail: string | null = null;
	const teamsDisplayName = activity.from?.name;

	if (!teamsUserId) {
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await context.sendActivity(t("bot.static.noUser", "Unable to identify your user account."));
		return;
	}

	const userResult = await resolveTeamsUser(
		teamsUserId,
		teamsEmail,
		tenantId,
		teamsDisplayName,
		tenant.organizationId,
	);

	// Save conversation reference for proactive messaging
	if (userResult.status === "found") {
		recipient.userId = userResult.user.userId;
		await saveConversationReference(context, userResult.user.userId, tenant.organizationId);
	}

	// The recipient language: the linked user's, else the organization's default
	const locale = await getUserLocale({
		userId: userResult.status === "found" ? userResult.user.userId : null,
		organizationId: tenant.organizationId,
	});
	const t = await getBotTranslate(locale);

	// Parse the message as a command
	const text = activity.text?.trim() || "";

	// Remove bot mention if present
	const cleanedText = removeBotMention(text, activity);
	const parsed = parseCommand(cleanedText);

	if (!parsed?.command) {
		// If user just mentioned the bot without a command, show help
		await context.sendActivity(
			t("bot.static.mentionHelp", 'Hi! I\'m the Z8 bot. Type "help" to see available commands.'),
		);
		return;
	}

	// Check if user is linked for commands that require auth
	if (userResult.status !== "found") {
		const command = parsed.command.toLowerCase();
		// Allow help command without auth
		if (command !== "help" && command !== "?") {
			if (userResult.status === "not_linked") {
				await context.sendActivity(
					t(
						"bot.static.notLinkedTeams",
						"I couldn't find your Z8 account. Make sure your Teams email matches your Z8 account email.",
					),
				);
			} else if (userResult.status === "no_employee") {
				await context.sendActivity(
					t(
						"bot.static.noEmployee",
						"Your account exists but you don't have an employee record in Z8.",
					),
				);
			}
			return;
		}
	}

	// Build command context
	const commandContext: BotCommandContext = {
		platform: "teams",
		organizationId: tenant.organizationId,
		employeeId: userResult.status === "found" ? userResult.user.employeeId : "",
		userId: userResult.status === "found" ? userResult.user.userId : "",
		platformUserId: teamsUserId,
		// The recorded activity ID within its conversation, as for bound approvals (#261).
		invocationId:
			activity.conversation?.id && activity.id
				? `${activity.conversation.id}:${activity.id}`
				: undefined,
		config: {
			organizationId: tenant.organizationId,
			enableApprovals: tenant.enableApprovals,
			enableCommands: tenant.enableCommands,
			enableDailyDigest: tenant.enableDailyDigest,
			enableEscalations: tenant.enableEscalations,
			digestTime: tenant.digestTime,
			digestTimezone: tenant.digestTimezone,
			escalationTimeoutHours: tenant.escalationTimeoutHours,
		},
		args: parsed.args,
		locale,
	};

	// Execute command
	const response = await executeCommand(parsed.command, commandContext);

	// Send response. The command already ran (a clock command may have
	// committed), so a failed reply must not surface as the generic "try again".
	try {
		if (response.type === "card" && response.card) {
			await context.sendActivity({
				type: "message",
				text: response.text,
				attachments: [
					{
						contentType: "application/vnd.microsoft.card.adaptive",
						content: response.card,
					},
				],
			});
		} else {
			await context.sendActivity(response.text);
		}
	} catch (error) {
		logger.error({ error, command: parsed.command }, "Failed to deliver command reply");
		try {
			await context.sendActivity(
				t(
					"bot.static.replyUndelivered",
					"Your command was processed, but its reply could not be shown. Check your status before repeating it.",
				),
			);
		} catch {
			// Nothing more we can do
		}
	}
}

/**
 * Handle invoke activity (card button clicks)
 */
async function handleInvoke(context: TurnContext, recipient: TurnRecipient): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	if (!tenantId) {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 400 },
		});
		return;
	}

	// Resolve tenant
	const tenantResult = await resolveTenant(tenantId);
	if (tenantResult.status !== "configured") {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 403 },
		});
		return;
	}

	const tenant = tenantResult.tenant;
	recipient.organizationId = tenant.organizationId;

	// Handle card action
	const value = activity.value;

	// Resolve user for any action
	const teamsUserId = activity.from?.aadObjectId;
	const teamsEmail: string | null = null;

	if (!teamsUserId) {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 401 },
		});
		return;
	}

	const userResult = await resolveTeamsUser(
		teamsUserId,
		teamsEmail,
		tenantId,
		undefined,
		tenant.organizationId,
	);

	if (userResult.status !== "found") {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 401 },
		});
		return;
	}
	recipient.userId = userResult.user.userId;

	// Bound approval cards (#293): Universal Actions carrying a reviewed
	// binding. The invoke response reports the outcome.
	const bound = parseTeamsBoundApprovalInvoke(activity);
	if (bound.kind !== "none") {
		const response = await handleBoundApprovalInvoke(context, bound, userResult.user, tenant);
		await context.sendActivity({ type: "invokeResponse", value: response });
		return;
	}

	// Old unbound cards: historical-result-only access, never a new decision.
	if (
		(value?.action === "approve" || value?.action === "reject") &&
		typeof value?.approvalId === "string"
	) {
		await handleApprovalAction(context, value.approvalId, value.action, userResult.user, tenant);
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 200 },
		});
		return;
	}

	// Retiring legacy tenants ONLY service eligible old approval cards — block other interactive actions.
	if (tenant.installationStatus === "retiring") {
		await context.sendActivity({
			type: "invokeResponse",
			value: { status: 403 },
		});
		return;
	}

	// Vehicle use cards (#1125) after a committed clock command.
	const vehicleUse = parseTeamsVehicleUseInvoke(activity);
	if (vehicleUse.kind !== "none") {
		const { handleTeamsVehicleUseInvoke } = await import("./vehicle-use-prompt");
		const response = await handleTeamsVehicleUseInvoke(vehicleUse, userResult.user, tenant);
		await context.sendActivity({ type: "invokeResponse", value: response });
		return;
	}

	// Handle shift pickup action
	if (value?.action === "shift_pickup" && value?.shiftId) {
		await handleShiftPickupAction(context, value.shiftId, userResult.user.employeeId, tenant);
	}

	await context.sendActivity({
		type: "invokeResponse",
		value: { status: 200 },
	});
}

/**
 * Handle conversation update (bot added/removed)
 */
async function handleConversationUpdate(context: TurnContext): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	// Check if bot was added
	if (activity.membersAdded?.some((member) => member.id === activity.recipient?.id)) {
		// Bot was added to conversation
		logger.info(
			{
				tenantId,
				conversationType: activity.conversation?.conversationType,
			},
			"Bot added to conversation",
		);

		if (tenantId) {
			const tenantResult = await resolveTenant(tenantId);
			if (tenantResult.status === "not_found") {
				await sendSetupInstructions(context, tenantId);
			} else if (tenantResult.status === "configured") {
				const t = await getBotTranslate(
					await getUserLocale({
						userId: null,
						organizationId: tenantResult.tenant.organizationId,
					}),
				);
				await context.sendActivity(
					t("bot.static.welcomeTeams", 'Welcome to Z8! Type "help" to see available commands.'),
				);
			}
		}
	}

	// Check if bot was removed
	if (activity.membersRemoved?.some((member) => member.id === activity.recipient?.id)) {
		// Bot was removed from conversation
		logger.info({ tenantId }, "Bot removed from conversation");

		if (tenantId) {
			const conversationId = activity.conversation?.id;
			const tenantResult = await resolveTenant(tenantId);
			if (tenantResult.status === "configured" && conversationId) {
				await deactivateConversation(conversationId, tenantResult.tenant.organizationId);
			}
		}
	}
}

/**
 * Handle installation update (app installed/uninstalled)
 */
async function handleInstallationUpdate(context: TurnContext): Promise<void> {
	const activity = context.activity;
	const action = activity.action;

	logger.info(
		{
			action,
			tenantId: activity.conversation?.tenantId,
		},
		"Installation update",
	);

	if (action === "add") {
		// App was installed
		const tenantId = activity.conversation?.tenantId;
		if (tenantId) {
			const tenantResult = await resolveTenant(tenantId);
			if (tenantResult.status === "not_found") {
				await sendSetupInstructions(context, tenantId);
			}
		}
	}
}

/**
 * Send setup instructions for unconfigured tenant
 */
async function sendSetupInstructions(context: TurnContext, tenantId: string): Promise<void> {
	const appUrl = env.APP_URL || "https://z8-time.app";
	const setupUrl = `${appUrl}/api/teams/setup?tenantId=${encodeURIComponent(tenantId)}`;
	const t = await getBotTranslate(DEFAULT_LANGUAGE);

	await context.sendActivity({
		type: "message",
		text: t(
			"bot.static.setupRequired",
			"Welcome to Z8! To connect this Microsoft 365 organization to your Z8 account, an admin needs to complete the setup.",
		),
		attachments: [
			{
				contentType: "application/vnd.microsoft.card.adaptive",
				content: {
					$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
					type: "AdaptiveCard",
					version: "1.4",
					body: [
						{
							type: "TextBlock",
							text: t("bot.static.setupTitle", "Z8 Setup Required"),
							weight: "bolder",
							size: "large",
						},
						{
							type: "TextBlock",
							text: t(
								"bot.static.setupBody",
								"Your organization needs to be connected to Z8. Click below to start the setup process.",
							),
							wrap: true,
						},
						{
							type: "TextBlock",
							text: t("bot.static.setupNote", "Only organization admins can complete this setup."),
							wrap: true,
							isSubtle: true,
							size: "small",
						},
					],
					actions: [
						{
							type: "Action.OpenUrl",
							title: t("bot.static.setupButton", "Complete Setup"),
							url: setupUrl,
						},
					],
				},
			},
		],
	});
}

/**
 * Remove bot mention from message text
 */
function removeBotMention(text: string, activity: Activity): string {
	// Teams includes the mention in the text, we need to remove it
	if (activity.entities) {
		for (const entity of activity.entities) {
			if (entity.type === "mention" && entity.mentioned?.id === activity.recipient?.id) {
				// Remove the mention text
				const mentionText = entity.text || "";
				return text.replace(mentionText, "").trim();
			}
		}
	}
	return text;
}

/**
 * Get user-friendly error message for TeamsError
 */
function getErrorMessage(error: TeamsError, t: BotTranslateFn): string {
	switch (error.code) {
		case "TENANT_NOT_CONFIGURED":
			return t(
				"bot.static.errorTenantNotConfigured",
				"Your organization hasn't completed the Z8 setup yet. Please ask an admin to configure the integration.",
			);
		case "USER_NOT_LINKED":
			return t(
				"bot.static.errorUserNotLinked",
				"Your Teams account isn't linked to Z8. Make sure your Teams email matches your Z8 account.",
			);
		case "EMPLOYEE_NOT_FOUND":
			return t(
				"bot.static.errorEmployeeNotFound",
				"You don't have an employee record in Z8. Please contact your administrator.",
			);
		case "APPROVAL_NOT_FOUND":
			return t(
				"bot.static.errorApprovalNotFound",
				"This approval request no longer exists or has already been processed.",
			);
		case "APPROVAL_ALREADY_RESOLVED":
			return t(
				"bot.static.errorApprovalResolved",
				"This approval has already been approved or rejected.",
			);
		case "NOT_AUTHORIZED":
			return t("bot.static.errorNotAuthorized", "You're not authorized to perform this action.");
		default:
			return t("bot.static.errorDefault", "Something went wrong. Please try again.");
	}
}
