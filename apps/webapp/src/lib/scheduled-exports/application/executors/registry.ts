/**
 * Executor Registry
 *
 * Central registry for all report executors.
 * Provides lookup by report type for the orchestrator.
 */
import type { IReportExecutor } from "./base-executor";
import { PayrollExportExecutor } from "./payroll-export-executor";
import { DataExportExecutor } from "./data-export-executor";
import { AuditReportExecutor } from "./audit-report-executor";

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
