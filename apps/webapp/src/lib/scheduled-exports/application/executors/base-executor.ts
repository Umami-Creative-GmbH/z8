/**
 * Base Report Executor Interface
 *
 * Defines the contract for all report executors.
 * Each report type (payroll, data, audit) implements this interface.
 */
import type {
	CalculatedDateRange,
	ExecutionResult,
	FilterConfig,
	ReportConfig,
} from "../../domain/types";

/**
 * Parameters for report execution
 */
export interface ExecuteParams {
	/** The id of the run's record (`scheduled_export_execution`) */
	executionId: string;
	organizationId: string;
	reportConfig: ReportConfig;
	dateRange: CalculatedDateRange;
	filters?: FilterConfig;
	payrollConfigId?: string;
	/** User ID who created the scheduled export (for audit trail) */
	createdBy?: string;
	/**
	 * The addresses the delivered file's download link is mailed to. A data
	 * export includes position stamps only if each one belongs to a user of the
	 * organization who may view them, as well as the schedule owner.
	 */
	emailRecipients?: readonly string[];
}

/**
 * Base interface for report executors
 *
 * Each report type implements this to handle actual export generation.
 * Executors delegate to existing export services for the heavy lifting.
 */
export interface IReportExecutor {
	/**
	 * Unique identifier for this executor (matches report type)
	 */
	readonly reportType: string;

	/**
	 * Human-readable name
	 */
	readonly displayName: string;

	/**
	 * Execute the report generation
	 *
	 * @param params - Execution parameters including config, date range, and filters
	 * @returns Execution result with job reference and status
	 */
	execute(params: ExecuteParams): Promise<ExecutionResult>;

	/**
	 * Validate report configuration
	 *
	 * @param config - Configuration to validate
	 * @returns Validation result with any errors
	 */
	validateConfig(config: ReportConfig): { valid: boolean; errors?: string[] };
}
