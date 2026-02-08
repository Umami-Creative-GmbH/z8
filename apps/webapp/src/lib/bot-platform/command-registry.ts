/**
 * Bot Platform - Shared Command Registry
 *
 * Platform-agnostic command registration and execution.
 * Both Teams and Telegram use this shared registry.
 */

import { createLogger } from "@/lib/logger";
import { clockedInCommand } from "@/lib/teams/commands/clockedin";
import { complianceCommand } from "@/lib/teams/commands/compliance";
import { coverageCommand } from "@/lib/teams/commands/coverage";
import { helpCommand } from "@/lib/teams/commands/help";
import { openShiftsCommand } from "@/lib/teams/commands/open-shifts";
import { pendingCommand } from "@/lib/teams/commands/pending";
import { whosOutCommand } from "@/lib/teams/commands/whos-out";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "./types";

const logger = createLogger("BotCommandRegistry");

// All available commands
const allCommands: BotCommand[] = [
	clockedInCommand,
	whosOutCommand,
	pendingCommand,
	helpCommand,
	coverageCommand,
	openShiftsCommand,
	complianceCommand,
];

// Registry of all available commands (keyed by name and aliases)
const commands: Map<string, BotCommand> = new Map();

/**
 * Register a command in the registry
 */
function registerCommand(command: BotCommand): void {
	commands.set(command.name.toLowerCase(), command);

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
	commands.clear();

	for (const cmd of allCommands) {
		registerCommand(cmd);
	}

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
 * Parse a message into command name and arguments.
 *
 * Supports slash commands (/clockedin) and plain text (clockedin).
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

	// Handle plain text commands
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
				platform: context.platform,
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
