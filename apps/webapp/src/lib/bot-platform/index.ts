/**
 * Bot Platform - Shared Module
 *
 * Platform-agnostic abstractions for bot integrations.
 */

export {
	executeCommand,
	getAllCommands,
	getCommand,
	initializeCommands,
	parseCommand,
} from "./command-registry";
export * from "./types";
