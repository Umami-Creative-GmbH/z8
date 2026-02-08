/**
 * Discord Slash Command Registration
 *
 * Registers slash commands with the Discord API when a bot is connected.
 * Maps shared bot commands to Discord slash command format.
 */

import { createLogger } from "@/lib/logger";
import { registerGlobalCommands } from "./api";
import { CommandOptionType, type DiscordSlashCommandDefinition } from "./types";

const logger = createLogger("DiscordSlashCommands");

/**
 * Build Discord slash command definitions from the shared command registry.
 */
export function buildCommandDefinitions(): DiscordSlashCommandDefinition[] {
	return [
		{
			name: "link",
			description: "Link your Discord account to Z8",
			options: [
				{
					type: CommandOptionType.STRING,
					name: "code",
					description: "Your 6-character link code from Z8 settings",
					required: true,
				},
			],
		},
		{
			name: "help",
			description: "Show available Z8 bot commands",
		},
		{
			name: "clockedin",
			description: "See which team members are currently clocked in",
		},
		{
			name: "whosout",
			description: "See which team members are out today",
		},
		{
			name: "pending",
			description: "Show your pending approval requests",
		},
		{
			name: "coverage",
			description: "Show coverage gaps for today",
		},
		{
			name: "openshifts",
			description: "Show open shifts that need to be filled",
		},
		{
			name: "compliance",
			description: "Show compliance exceptions pending review",
		},
	];
}

/**
 * Register all slash commands with Discord for a bot application.
 */
export async function registerDiscordSlashCommands(
	botToken: string,
	applicationId: string,
): Promise<boolean> {
	const commands = buildCommandDefinitions();

	logger.info(
		{ applicationId, commandCount: commands.length },
		"Registering Discord slash commands",
	);

	return await registerGlobalCommands(botToken, applicationId, commands);
}
