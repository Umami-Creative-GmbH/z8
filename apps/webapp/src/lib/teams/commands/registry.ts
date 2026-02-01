/**
 * Teams Bot Command Registry
 *
 * Mirrors the cron job registry pattern. Commands are registered with
 * their handlers and metadata, making it easy to add new commands.
 */

import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { clockedInCommand } from "./clockedin";
import { whosOutCommand } from "./whos-out";
import { pendingCommand } from "./pending";
import { helpCommand } from "./help";
// Operations Console Commands
import { coverageCommand } from "./coverage";
import { openShiftsCommand } from "./open-shifts";
import { complianceCommand } from "./compliance";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsBotCommands");

// Registry of all available commands
const commands: Map<string, BotCommand> = new Map();

/**
 * Register a command in the registry
 */
function registerCommand(command: BotCommand): void {
	commands.set(command.name.toLowerCase(), command);

	// Register aliases
	if (command.aliases) {
		for (const alias of command.aliases) {
			commands.set(alias.toLowerCase(), command);
		}
	}
}

/**
 * Initialize the command registry with all available commands
 */
export function initializeCommands(): void {
	// Clear existing commands (for hot reload)
	commands.clear();

	// Register all commands
	registerCommand(clockedInCommand);
	registerCommand(whosOutCommand);
	registerCommand(pendingCommand);
	registerCommand(helpCommand);
	// Operations Console Commands
	registerCommand(coverageCommand);
	registerCommand(openShiftsCommand);
	registerCommand(complianceCommand);

	logger.info({ commandCount: commands.size }, "Bot commands initialized");
}

/**
 * Get a command by name (case-insensitive)
 */
export function getCommand(name: string): BotCommand | undefined {
	return commands.get(name.toLowerCase());
}

/**
 * Get all unique commands (excludes aliases)
 */
export function getAllCommands(): BotCommand[] {
	const seen = new Set<string>();
	const result: BotCommand[] = [];

	for (const command of commands.values()) {
		if (!seen.has(command.name)) {
			seen.add(command.name);
			result.push(command);
		}
	}

	return result;
}

/**
 * Parse a message into command name and arguments
 *
 * Supports both slash commands (/clockedin) and direct mentions (@Z8 clockedin)
 */
export function parseCommand(text: string): { command: string; args: string[] } | null {
	const trimmed = text.trim();

	// Handle slash commands
	if (trimmed.startsWith("/")) {
		const parts = trimmed.slice(1).split(/\s+/);
		return {
			command: parts[0] || "",
			args: parts.slice(1),
		};
	}

	// Handle @mention format (Teams removes the mention and leaves the text)
	// The remaining text after bot mention removal
	const parts = trimmed.split(/\s+/).filter((p) => p.length > 0);
	if (parts.length === 0) {
		return null;
	}

	return {
		command: parts[0],
		args: parts.slice(1),
	};
}

/**
 * Execute a command by name
 */
export async function executeCommand(
	commandName: string,
	context: BotCommandContext,
): Promise<BotCommandResponse> {
	const command = getCommand(commandName);

	if (!command) {
		return {
			type: "text",
			text: `Unknown command: ${commandName}\n\nType "help" to see available commands.`,
		};
	}

	try {
		logger.debug(
			{
				command: commandName,
				userId: context.userId,
				organizationId: context.organizationId,
			},
			"Executing bot command",
		);

		return await command.handler(context);
	} catch (error) {
		logger.error(
			{
				error,
				command: commandName,
				userId: context.userId,
			},
			"Command execution failed",
		);

		return {
			type: "text",
			text: "Sorry, something went wrong executing that command. Please try again.",
		};
	}
}

// Initialize commands on module load
initializeCommands();
