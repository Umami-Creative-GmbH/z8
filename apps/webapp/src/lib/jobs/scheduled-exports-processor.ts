/**
 * Scheduled Exports Processor Job
 *
 * Runs every 5 minutes to check for and execute due scheduled exports.
 * Registered in the cron job registry for automatic execution.
 */
import { createLogger } from "@/lib/logger";
import { ScheduledExportOrchestrator } from "@/lib/scheduled-exports/application/orchestrator";
import type { ScheduledExportsProcessorResult } from "@/lib/scheduled-exports/domain/types";

const logger = createLogger("ScheduledExportsProcessor");

/**
 * Run the scheduled exports processor
 *
 * This function is called by the cron job registry.
 * It finds all due scheduled exports and processes them.
 */
export async function runScheduledExportsProcessor(): Promise<ScheduledExportsProcessorResult> {
	logger.info("Starting scheduled exports processor");

	try {
		const orchestrator = new ScheduledExportOrchestrator();
		const result = await orchestrator.processDueExports();

		logger.info(
			{
				processed: result.processed,
				succeeded: result.succeeded,
				failed: result.failed,
			},
			"Scheduled exports processor completed",
		);

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Scheduled exports processor failed");

		return {
			success: false,
			processed: 0,
			succeeded: 0,
			failed: 0,
			errors: [{ scheduleId: "processor", error: errorMessage }],
		};
	}
}
