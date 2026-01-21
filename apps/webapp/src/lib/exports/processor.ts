/**
 * Export Processor - Worker entry point
 *
 * Wrapper for processing exports from background workers.
 */

import { processExport as processExportInternal } from "@/lib/export/export-service";

/**
 * Process export job from worker queue
 */
export async function processExport(data: { exportId?: string }): Promise<void> {
	if (!data.exportId) {
		throw new Error("Export ID is required");
	}

	await processExportInternal(data.exportId);
}
