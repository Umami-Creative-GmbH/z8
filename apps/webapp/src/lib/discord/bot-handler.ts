/**
 * Discord Bot Interaction Handler
 *
 * Main entry point for handling incoming Discord interactions.
 * Routes slash commands and button clicks to appropriate handlers.
 */

import { executeCommand } from "@/lib/bot-platform/command-registry";
import { getBotTranslate, getUserLocale } from "@/lib/bot-platform/i18n";
import { getReplyTranslate } from "@/lib/bot-platform/reply-translate";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { createFollowupMessage, createInteractionResponse } from "./api";
import { handleApprovalButtonClick, handleBoundApprovalInteraction } from "./approval-handler";
import { parseBoundApprovalCustomId } from "./bound-approval";
import { saveConversation } from "./conversation-manager";
import { buildNotificationEmbed } from "./formatters";
import type { ApprovalButtonData, DiscordInteraction, ResolvedDiscordBot } from "./types";
import { InteractionResponseType, InteractionType } from "./types";
import { claimLinkCode, resolveDiscordUser } from "./user-resolver";

const logger = createLogger("DiscordBotHandler");

const COMMAND_ERROR_NOTICE =
	"Sorry, something went wrong executing that command. Please try again.";
const REPLY_UNDELIVERED_NOTICE =
	"Your command was processed, but its reply could not be shown. Check your status before repeating it.";

/**
 * Handle an incoming Discord interaction
 */
export async function handleDiscordInteraction(
	interaction: DiscordInteraction,
	bot: ResolvedDiscordBot,
): Promise<void> {
	try {
		if (interaction.type === InteractionType.APPLICATION_COMMAND) {
			await handleSlashCommand(interaction, bot);
		} else if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
			await handleButtonClick(interaction, bot);
		}
	} catch (error) {
		logger.error(
			{ error, interactionId: interaction.id, organizationId: bot.organizationId },
			"Error handling Discord interaction",
		);
	}
}

/**
 * Handle incoming slash command
 */
async function handleSlashCommand(
	interaction: DiscordInteraction,
	bot: ResolvedDiscordBot,
): Promise<void> {
	const commandName = interaction.data?.name;
	const discordUser = interaction.member?.user || interaction.user;

	if (!commandName || !discordUser) return;

	const discordUserId = discordUser.id;
	const discordUsername = discordUser.username;

	// Handle /link command specially
	if (commandName === "link") {
		// ACK immediately, then process
		await createInteractionResponse(
			interaction.id,
			interaction.token,
			InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
			{ flags: 64 }, // Ephemeral
		);

		await handleLinkCommand(
			interaction,
			discordUserId,
			discordUsername,
			discordUser.global_name,
			bot,
		);
		return;
	}

	// Check if commands are enabled
	if (!bot.enableCommands) return;

	// ACK immediately with deferred response
	await createInteractionResponse(
		interaction.id,
		interaction.token,
		InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
	);

	// Resolve user
	const userResult = await resolveDiscordUser(discordUserId, bot.organizationId, discordUsername);

	if (userResult.status !== "found") {
		const { t } = await getReplyTranslate({ userId: null, organizationId: bot.organizationId });
		await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, {
			content: t(
				"bot.static.notLinkedDiscord",
				"Your Discord account is not linked to Z8. Go to Settings > Integrations > Discord in your Z8 dashboard to generate a link code, then use `/link` here.",
			),
		});
		return;
	}

	const locale = await getUserLocale({
		userId: userResult.user.userId,
		organizationId: bot.organizationId,
	});

	// Save conversation for proactive messaging (if in DM)
	if (interaction.channel_id) {
		await saveConversation(interaction.channel_id, userResult.user.userId, bot.organizationId);
	}

	// Build shared command context
	const commandContext: BotCommandContext = {
		platform: "discord",
		organizationId: bot.organizationId,
		employeeId: userResult.user.employeeId,
		userId: userResult.user.userId,
		platformUserId: discordUserId,
		// Redeliveries of one interaction share its ID.
		invocationId: interaction.id,
		config: {
			organizationId: bot.organizationId,
			enableApprovals: bot.enableApprovals,
			enableCommands: bot.enableCommands,
			enableDailyDigest: bot.enableDailyDigest,
			enableEscalations: bot.enableEscalations,
			digestTime: bot.digestTime,
			digestTimezone: bot.digestTimezone,
			escalationTimeoutHours: bot.escalationTimeoutHours,
		},
		args: extractCommandArgs(interaction),
		locale,
	};

	// Execute command and send follow-up response
	let response: Awaited<ReturnType<typeof executeCommand>>;
	try {
		response = await executeCommand(commandName, commandContext);
	} catch (error) {
		logger.error(
			{ error, commandName, organizationId: bot.organizationId },
			"Failed to execute command",
		);
		const notice = await getBotTranslate(locale).then(
			(t) => t("bot.static.commandError", COMMAND_ERROR_NOTICE),
			// Keep the English notice.
			() => COMMAND_ERROR_NOTICE,
		);
		await sendFollowupBestEffort(bot, interaction, notice);
		return;
	}

	try {
		// For card responses on Discord, we fall back to the text version wrapped in an embed
		const embeds = buildNotificationEmbed(commandName, response.text);

		await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, {
			embeds,
		});
	} catch (error) {
		logger.error(
			{ error, commandName, organizationId: bot.organizationId },
			"Failed to deliver command reply",
		);
		// The command already ran (a clock command may have committed), so a failed
		// reply must not invite a blind retry.
		const notice = await getBotTranslate(locale).then(
			(t) => t("bot.static.replyUndelivered", REPLY_UNDELIVERED_NOTICE),
			// Keep the English notice.
			() => REPLY_UNDELIVERED_NOTICE,
		);
		await sendFollowupBestEffort(bot, interaction, notice);
	}
}

/** Avoids a "thinking..." interaction that never resolves. */
async function sendFollowupBestEffort(
	bot: ResolvedDiscordBot,
	interaction: DiscordInteraction,
	content: string,
): Promise<void> {
	try {
		await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, { content });
	} catch {
		// Nothing more we can do
	}
}

/**
 * Handle button click (message component interaction)
 */
async function handleButtonClick(
	interaction: DiscordInteraction,
	bot: ResolvedDiscordBot,
): Promise<void> {
	const customId = interaction.data?.custom_id;
	const discordUser = interaction.member?.user || interaction.user;

	if (!customId || !discordUser) return;

	// Skip disabled/resolved buttons
	if (customId.startsWith("resolved_")) return;

	const bound = parseBoundApprovalCustomId(customId);
	if (bound) {
		await handleBoundApprovalInteraction(interaction, bound, bot);
		return;
	}

	try {
		const buttonData = JSON.parse(customId) as ApprovalButtonData;

		if (buttonData.a === "ap" || buttonData.a === "rj") {
			await handleApprovalButtonClick(interaction, buttonData, discordUser.id, bot);
		}
	} catch (error) {
		logger.error({ error, customId }, "Failed to parse button data");
		const { t } = await getReplyTranslate({ userId: null, organizationId: bot.organizationId });
		await createInteractionResponse(
			interaction.id,
			interaction.token,
			InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			{
				content: t("bot.static.errorDefault", "Something went wrong. Please try again."),
				flags: 64,
			},
		);
	}
}

/**
 * Handle the /link command for account linking
 */
async function handleLinkCommand(
	interaction: DiscordInteraction,
	discordUserId: string,
	discordUsername: string,
	displayName: string | undefined,
	bot: ResolvedDiscordBot,
): Promise<void> {
	const codeOption = interaction.data?.options?.find((opt) => opt.name === "code");
	const code = codeOption?.value;

	if (!code) {
		const { t } = await getReplyTranslate({ userId: null, organizationId: bot.organizationId });
		await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, {
			content: t(
				"bot.static.linkUsageDiscord",
				"Please provide your link code: `/link code:YOUR_CODE`",
			),
			flags: 64,
		});
		return;
	}

	const result = await claimLinkCode(
		code,
		discordUserId,
		bot.organizationId,
		discordUsername,
		displayName || discordUsername,
	);

	// Save conversation for proactive messaging
	if (result.status === "success" && interaction.channel_id) {
		await saveConversation(interaction.channel_id, result.userId, bot.organizationId);
	}

	const { t } = await getReplyTranslate({
		userId: result.status === "success" ? result.userId : null,
		organizationId: bot.organizationId,
	});
	let responseText: string;

	switch (result.status) {
		case "success":
			responseText = t(
				"bot.static.linkSuccessDiscord",
				"Your Discord account has been linked to Z8! You can now use slash commands like `/clockedin` and `/pending`.",
			);
			break;
		case "invalid_code":
			responseText = t(
				"bot.static.linkInvalid",
				"Invalid link code. Please check your code and try again.",
			);
			break;
		case "expired":
			responseText = t(
				"bot.static.linkExpired",
				"This link code has expired. Please generate a new one from your Z8 settings.",
			);
			break;
		case "already_linked":
			responseText = t(
				"bot.static.linkAlreadyLinkedDiscord",
				"This Discord account is already linked to a Z8 account in this organization.",
			);
			break;
	}

	await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, {
		content: responseText,
		flags: 64,
	});
}

/**
 * Extract command arguments from interaction options
 */
function extractCommandArgs(interaction: DiscordInteraction): string[] {
	if (!interaction.data?.options) return [];
	return interaction.data.options.map((opt) => opt.value);
}
