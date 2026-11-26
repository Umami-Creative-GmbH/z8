/**
 * Help Command
 *
 * Lists all available commands with descriptions.
 */

import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type {
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
	BotPlatform,
} from "@/lib/bot-platform/types";

const PLATFORM_NAMES: Record<BotPlatform, string> = {
	teams: "Teams",
	telegram: "Telegram",
	slack: "Slack",
	discord: "Discord",
};

export const helpCommand: BotCommand = {
	name: "help",
	aliases: ["commands", "?"],
	description: "bot.cmd.help.desc",
	usage: "help",
	requiresAuth: false,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		const t = await getBotTranslate(ctx.locale);
		const commands = ctx.listCommands?.() ?? [helpCommand];

		// Sort commands alphabetically, but put help last
		const sortedCommands = commands.sort((a, b) => {
			if (a.name === "help") return 1;
			if (b.name === "help") return -1;
			return a.name.localeCompare(b.name);
		});

		const lines = sortedCommands.map((cmd) => {
			const aliases = cmd.aliases?.length ? ` (or: ${cmd.aliases.join(", ")})` : "";
			const desc = t(cmd.description, cmd.description);
			return `• **${cmd.name}**${aliases} - ${desc}`;
		});

		const platformName = PLATFORM_NAMES[ctx.platform];
		const response = [
			`**${t("bot.cmd.help.title", "Z8 Bot Commands")}**`,
			"",
			...lines,
			"",
			`_${t("bot.cmd.help.footer", "You can also receive approval requests and daily digests directly in {platform}.", { platform: platformName })}_`,
			`_${t("bot.cmd.help.manageLinks", "Manage your chat links and notification preferences in Z8 under Settings → Notifications.")}_`,
		].join("\n");

		return {
			type: "text",
			text: response,
		};
	},
};
