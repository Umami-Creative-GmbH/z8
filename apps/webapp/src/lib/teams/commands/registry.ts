/**
 * Teams Bot Command Registry
 *
 * Delegates to the shared bot-platform command registry.
 * Kept for backward compatibility with existing Teams imports.
 */

export {
	initializeCommands,
	getCommand,
	getAllCommands,
	parseCommand,
	executeCommand,
} from "@/lib/bot-platform/command-registry";
