/**
 * Teams Bot Message Handler
 *
 * Main entry point for handling incoming Teams bot messages.
 * Routes messages to appropriate handlers based on activity type.
 */

import type { Activity, TurnContext } from "botbuilder";
import { TurnContext as TurnContextClass } from "botbuilder";
import { createLogger } from "@/lib/logger";
import { resolveTenant, updateTenantServiceUrl } from "./tenant-resolver";
import { resolveTeamsUser } from "./user-resolver";
import { saveConversationReference, deactivateConversation } from "./conversation-manager";
import { parseCommand, executeCommand } from "@/lib/bot-platform/command-registry";
import { handleApprovalAction } from "./approval-handler";
import { handleShiftPickupAction } from "./shift-pickup-handler";
import { TeamsError } from "./types";
import type { BotCommandContext } from "@/lib/bot-platform/types";

const logger = createLogger("TeamsBotHandler");

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

	try {
		switch (activity.type) {
			case "message":
				await handleMessage(context);
				break;

			case "invoke":
				await handleInvoke(context);
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

		if (error instanceof TeamsError) {
			// Send user-friendly error message
			const errorMessage = getErrorMessage(error);
			await context.sendActivity(errorMessage);
		} else {
			await context.sendActivity(
				"Sorry, something went wrong. Please try again or contact support.",
			);
		}
	}
}

/**
 * Handle incoming message activity (user typed something)
 */
async function handleMessage(context: TurnContext): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	if (!tenantId) {
		await context.sendActivity("Unable to identify your organization. Please contact support.");
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
		await context.sendActivity(
			"Your organization's Z8 integration is being set up. Please wait for your admin to complete configuration.",
		);
		return;
	}

	const tenant = tenantResult.tenant;

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
		await context.sendActivity("Unable to identify your user account.");
		return;
	}

	const userResult = await resolveTeamsUser(teamsUserId, teamsEmail, tenantId, teamsDisplayName);

	// Save conversation reference for proactive messaging
	if (userResult.status === "found") {
		await saveConversationReference(context, userResult.user.userId, tenant.organizationId);
	}

	// Parse the message as a command
	const text = activity.text?.trim() || "";

	// Remove bot mention if present
	const cleanedText = removeBotMention(text, activity);
	const parsed = parseCommand(cleanedText);

	if (!parsed || !parsed.command) {
		// If user just mentioned the bot without a command, show help
		await context.sendActivity(
			'Hi! I\'m the Z8 bot. Type "help" to see available commands.',
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
					`I couldn't find your Z8 account. Make sure your Teams email (${userResult.teamsEmail || "not available"}) matches your Z8 account email.`,
				);
			} else if (userResult.status === "no_employee") {
				await context.sendActivity(
					"Your account exists but you don't have an employee record in Z8.",
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
	};

	// Execute command
	const response = await executeCommand(parsed.command, commandContext);

	// Send response
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
}

/**
 * Handle invoke activity (card button clicks)
 */
async function handleInvoke(context: TurnContext): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	if (!tenantId) {
		await context.sendActivity({ type: "invokeResponse", value: { status: 400 } });
		return;
	}

	// Resolve tenant
	const tenantResult = await resolveTenant(tenantId);
	if (tenantResult.status !== "configured") {
		await context.sendActivity({ type: "invokeResponse", value: { status: 403 } });
		return;
	}

	const tenant = tenantResult.tenant;

	// Handle card action
	const value = activity.value;

	// Resolve user for any action
	const teamsUserId = activity.from?.aadObjectId;
	const teamsEmail: string | null = null;

	if (!teamsUserId) {
		await context.sendActivity({ type: "invokeResponse", value: { status: 401 } });
		return;
	}

	const userResult = await resolveTeamsUser(teamsUserId, teamsEmail, tenantId);

	if (userResult.status !== "found") {
		await context.sendActivity({ type: "invokeResponse", value: { status: 401 } });
		return;
	}

	// Handle approval action
	if (value?.action && value?.approvalId) {
		await handleApprovalAction(
			context,
			value.approvalId,
			value.action as "approve" | "reject",
			userResult.user,
			tenant,
		);
	}

	// Handle shift pickup action
	if (value?.action === "shift_pickup" && value?.shiftId) {
		await handleShiftPickupAction(
			context,
			value.shiftId,
			userResult.user.employeeId,
			tenant,
		);
	}

	await context.sendActivity({ type: "invokeResponse", value: { status: 200 } });
}

/**
 * Handle conversation update (bot added/removed)
 */
async function handleConversationUpdate(context: TurnContext): Promise<void> {
	const activity = context.activity;
	const tenantId = activity.conversation?.tenantId;

	// Check if bot was added
	if (activity.membersAdded) {
		for (const member of activity.membersAdded) {
			if (member.id === activity.recipient?.id) {
				// Bot was added to conversation
				logger.info(
					{ tenantId, conversationType: activity.conversation?.conversationType },
					"Bot added to conversation",
				);

				if (tenantId) {
					const tenantResult = await resolveTenant(tenantId);
					if (tenantResult.status === "not_found") {
						await sendSetupInstructions(context, tenantId);
					} else if (tenantResult.status === "configured") {
						await context.sendActivity(
							'Welcome to Z8! Type "help" to see available commands.',
						);
					}
				}
			}
		}
	}

	// Check if bot was removed
	if (activity.membersRemoved) {
		for (const member of activity.membersRemoved) {
			if (member.id === activity.recipient?.id) {
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
	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
	const setupUrl = `${appUrl}/api/teams/setup?tenantId=${encodeURIComponent(tenantId)}`;

	await context.sendActivity({
		type: "message",
		text: "Welcome to Z8! To connect this Microsoft 365 organization to your Z8 account, an admin needs to complete the setup.",
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
							text: "Z8 Setup Required",
							weight: "bolder",
							size: "large",
						},
						{
							type: "TextBlock",
							text: "Your organization needs to be connected to Z8. Click below to start the setup process.",
							wrap: true,
						},
						{
							type: "TextBlock",
							text: "Only organization admins can complete this setup.",
							wrap: true,
							isSubtle: true,
							size: "small",
						},
					],
					actions: [
						{
							type: "Action.OpenUrl",
							title: "Complete Setup",
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
function getErrorMessage(error: TeamsError): string {
	switch (error.code) {
		case "TENANT_NOT_CONFIGURED":
			return "Your organization hasn't completed the Z8 setup yet. Please ask an admin to configure the integration.";
		case "USER_NOT_LINKED":
			return "Your Teams account isn't linked to Z8. Make sure your Teams email matches your Z8 account.";
		case "EMPLOYEE_NOT_FOUND":
			return "You don't have an employee record in Z8. Please contact your administrator.";
		case "APPROVAL_NOT_FOUND":
			return "This approval request no longer exists or has already been processed.";
		case "APPROVAL_ALREADY_RESOLVED":
			return "This approval has already been approved or rejected.";
		case "NOT_AUTHORIZED":
			return "You're not authorized to perform this action.";
		default:
			return "Something went wrong. Please try again.";
	}
}
