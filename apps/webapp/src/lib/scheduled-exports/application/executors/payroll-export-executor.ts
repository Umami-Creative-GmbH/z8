/**
 * Payroll Export Executor
 *
 * Handles execution of scheduled payroll exports.
 * Delegates to the existing payroll export service.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { createExportJob, getPayrollExportConfig, processExportJob } from "@/lib/payroll-export";
import type { ExecutionResult, PayrollExportReportConfig, ReportConfig } from "../../domain/types";
import type { ExecuteParams, IReportExecutor } from "./base-executor";

const logger = createLogger("PayrollExportExecutor");

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
		const { organizationId, reportConfig, dateRange, filters, createdBy } = params;
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

			const requester = createdBy
				? await db.query.employee.findFirst({
						where: and(
							eq(employee.userId, createdBy),
							eq(employee.organizationId, organizationId),
						),
						columns: { id: true },
					})
				: undefined;

			if (!requester) {
				return {
					success: false,
					error:
						"Unable to determine requester for payroll export. The schedule creator may not have an employee record.",
				};
			}

			// Create export job using existing service
			const { jobId, isAsync } = await createExportJob({
				organizationId,
				formatId: config.formatId,
				requestedById: requester.id,
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
			const result = await processExportJob({ jobId, organizationId });

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
			errors.push(
				`Invalid formatId: ${payrollConfig.formatId}. Valid formats: ${validFormats.join(", ")}`,
			);
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}
}
