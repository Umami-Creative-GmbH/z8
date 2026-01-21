/**
 * Report Generator - Worker entry point
 *
 * Wrapper for generating reports from background workers.
 */

import { generateEmployeeReport } from "./report-generator";
import { createLogger } from "@/lib/logger";
import type { ReportJobData } from "@/lib/queue";

const logger = createLogger("ReportGenerator");

/**
 * Generate report from worker queue job
 */
export async function generateReport(data: ReportJobData): Promise<void> {
	logger.info({ employeeId: data.employeeId, organizationId: data.organizationId }, "Generating report");

	await generateEmployeeReport(
		data.employeeId,
		data.organizationId,
		new Date(data.startDate),
		new Date(data.endDate),
	);

	logger.info({ employeeId: data.employeeId }, "Report generated successfully");
}
