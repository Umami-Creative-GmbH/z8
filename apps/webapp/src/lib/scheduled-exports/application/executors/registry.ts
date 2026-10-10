/**
 * Executor Registry
 *
 * Central registry for all report executors.
 * Provides lookup by report type for the orchestrator.
 */

import type { ReportConfig } from "../../domain/types";
import { AuditReportExecutor } from "./audit-report-executor";
import type { IReportExecutor } from "./base-executor";
import { DataExportExecutor } from "./data-export-executor";
import { PayrollExportExecutor } from "./payroll-export-executor";

/**
 * Executor Registry
 *
 * Singleton registry that holds all available report executors.
 * New report types can be added by registering additional executors.
 */
class ExecutorRegistry {
	private executors = new Map<string, IReportExecutor>();

	constructor() {
		// Register built-in executors
		this.register(new PayrollExportExecutor());
		this.register(new DataExportExecutor());
		this.register(new AuditReportExecutor());
	}

	/**
	 * Register an executor
	 */
	register(executor: IReportExecutor): void {
		this.executors.set(executor.reportType, executor);
	}

	/**
	 * Get executor by report type
	 */
	get(reportType: string): IReportExecutor | undefined {
		return this.executors.get(reportType);
	}

	/**
	 * Get all registered executors
	 */
	getAll(): IReportExecutor[] {
		return Array.from(this.executors.values());
	}

	/**
	 * Check if an executor exists for a report type
	 */
	has(reportType: string): boolean {
		return this.executors.has(reportType);
	}

	/**
	 * Get all supported report types
	 */
	getSupportedTypes(): string[] {
		return Array.from(this.executors.keys());
	}
}

// Singleton instance
export const executorRegistry = new ExecutorRegistry();

/**
 * The errors that keep a schedule's report configuration from being saved:
 * its executor's validation, against the organization's setup where the
 * executor checks it. Empty when the configuration is valid.
 */
export async function validateScheduledReportConfig(
	organizationId: string,
	reportType: string,
	config: ReportConfig,
): Promise<string[]> {
	const executor = executorRegistry.get(reportType);
	if (!executor) return [`Unknown report type: ${reportType}`];

	const validation = executor.validateForOrganization
		? await executor.validateForOrganization(organizationId, config)
		: executor.validateConfig(config);
	return validation.valid ? [] : (validation.errors ?? ["Invalid report configuration"]);
}
