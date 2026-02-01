/**
 * Payroll Export Executor
 *
 * Handles execution of scheduled payroll exports.
 * Delegates to the existing payroll export service.
 */
import { createLogger } from "@/lib/logger";
import {
	createExportJob,
	processExportJob,
	getPayrollExportConfig,
} from "@/lib/payroll-export";
import type { IReportExecutor, ExecuteParams } from "./base-executor";
import type { ExecutionResult, PayrollExportReportConfig, ReportConfig } from "../../domain/types";

const logger = createLogger("PayrollExportExecutor");

/**
 * System user ID for scheduled exports
 * This should be a valid user ID in the database for audit purposes
 */
const SYSTEM_USER_ID = "system";

/**
 * Payroll Export Executor
 *
 * Executes payroll exports using DATEV, Lexware, Sage, or Personio formats.
 */
export class PayrollExportExecutor implements IReportExecutor {
	readonly reportType = "payroll_export";
	readonly displayName = "Payroll Export";

	/**
	 * Execute a payroll export
	 */
	async execute(params: ExecuteParams): Promise<ExecutionResult> {
		const { organizationId, reportConfig, dateRange, filters, payrollConfigId } = params;
		const config = reportConfig as PayrollExportReportConfig;

		logger.info(
			{
				organizationId,
				formatId: config.formatId,
				dateRange: {
					start: dateRange.start.toISODate(),
					end: dateRange.end.toISODate(),
				},
			},
			"Executing payroll export",
		);

		try {
			// Verify payroll config exists
			const payrollConfig = await getPayrollExportConfig(organizationId, config.formatId);
			if (!payrollConfig) {
				return {
					success: false,
					error: `Payroll export configuration not found for format: ${config.formatId}`,
				};
			}

			// Get employee ID for the system user
			// In a real implementation, this would look up a system employee or use the config creator
			// For now, we'll need to pass this from the schedule's createdBy
			const requestedById = payrollConfigId || payrollConfig.config.createdBy;

			if (!requestedById) {
				return {
					success: false,
					error: "Unable to determine requester for payroll export",
				};
			}

			// Create export job using existing service
			const { jobId, isAsync } = await createExportJob({
				organizationId,
				formatId: config.formatId,
				requestedById,
				filters: {
					dateRange: {
						start: dateRange.start,
						end: dateRange.end,
					},
					employeeIds: filters?.employeeIds,
					teamIds: filters?.teamIds,
					projectIds: filters?.projectIds,
				},
			});

			logger.info({ jobId, isAsync }, "Payroll export job created");

			// Process the job (handles both sync and async)
			const result = await processExportJob(jobId);

			// Determine S3 key from result
			let s3Key: string | undefined;
			if (result.downloadUrl) {
				// Extract S3 key from presigned URL (it's in the path)
				const url = new URL(result.downloadUrl);
				s3Key = url.pathname.slice(1); // Remove leading slash
			}

			return {
				success: true,
				underlyingJobId: jobId,
				underlyingJobType: "payroll_export",
				s3Key,
				s3Url: result.downloadUrl,
				recordCount: result.result?.metadata?.workPeriodCount,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error: errorMessage, organizationId }, "Payroll export execution failed");

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Validate payroll export configuration
	 */
	validateConfig(config: ReportConfig): { valid: boolean; errors?: string[] } {
		const errors: string[] = [];
		const payrollConfig = config as PayrollExportReportConfig;

		if (!payrollConfig.formatId) {
			errors.push("formatId is required for payroll exports");
		}

		const validFormats = ["datev_lohn", "sage_lohn", "lexware_lohn", "personio"];
		if (payrollConfig.formatId && !validFormats.includes(payrollConfig.formatId)) {
			errors.push(`Invalid formatId: ${payrollConfig.formatId}. Valid formats: ${validFormats.join(", ")}`);
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}
}
