/**
 * Teams Bot Command Registry
 *
 * Delegates to the shared bot-platform command registry.
 * Kept for backward compatibility with existing Teams imports.
 */

export {
	executeCommand,
	getAllCommands,
	getCommand,
	initializeCommands,
	parseCommand,
} from "@/lib/bot-platform/command-registry";
