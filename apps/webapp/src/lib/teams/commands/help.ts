/**
 * Help Command
 *
 * Lists all available commands with descriptions.
 */

import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { getAllCommands } from "./registry";

export const helpCommand: BotCommand = {
	name: "help",
	aliases: ["commands", "?"],
	description: "Show available commands",
	usage: "help",
	requiresAuth: false,
	handler: async (_ctx: BotCommandContext): Promise<BotCommandResponse> => {
		const commands = getAllCommands();

		// Sort commands alphabetically, but put help last
		const sortedCommands = commands.sort((a, b) => {
			if (a.name === "help") return 1;
			if (b.name === "help") return -1;
			return a.name.localeCompare(b.name);
		});

		const lines = sortedCommands.map((cmd) => {
			const aliases = cmd.aliases?.length ? ` (or: ${cmd.aliases.join(", ")})` : "";
			return `• **${cmd.name}**${aliases} - ${cmd.description}`;
		});

		const response = [
			"**Z8 Bot Commands**",
			"",
			...lines,
			"",
			"_You can also receive approval requests and daily digests directly in Teams._",
		].join("\n");

		return {
			type: "text",
			text: response,
		};
	},
};
