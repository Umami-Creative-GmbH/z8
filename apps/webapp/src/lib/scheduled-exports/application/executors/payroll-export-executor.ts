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
import {
	isPayrollExportFormatId,
	payrollExportFormatIds,
} from "@/lib/payroll-export/format-registry";
import type { ExecutionResult, PayrollExportReportConfig, ReportConfig } from "../../domain/types";
import { signFileUrl } from "../../infrastructure/signed-file-url";
import type { ExecuteParams, IReportExecutor } from "./base-executor";

const logger = createLogger("PayrollExportExecutor");

/**
 * Payroll Export Executor
 *
 * Executes payroll exports in any registered payroll export format.
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

			// Process the job inline, storing its file whatever its size (#1008)
			const result = await processExportJob({ jobId, organizationId }, { storeFile: true });

			// The job's own key; an API-based format stores no file. The link keeps the
			// payroll job's default lifetime and carries it to the email.
			const s3Key = result.s3Key;
			const fileUrl = s3Key ? await signFileUrl(organizationId, s3Key) : undefined;

			return {
				success: true,
				underlyingJobId: jobId,
				underlyingJobType: "payroll_export",
				s3Key,
				fileUrl,
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
		const { formatId } = config as Partial<PayrollExportReportConfig>;

		if (!formatId) {
			return { valid: false, errors: ["formatId is required for payroll exports"] };
		}
		if (!isPayrollExportFormatId(formatId)) {
			return {
				valid: false,
				errors: [
					`Invalid formatId: ${formatId}. Valid formats: ${payrollExportFormatIds().join(", ")}`,
				],
			};
		}

		return { valid: true };
	}

	/**
	 * A schedule is saved only for a known format the organization has an
	 * active payroll export configuration for.
	 */
	async validateForOrganization(
		organizationId: string,
		config: ReportConfig,
	): Promise<{ valid: boolean; errors?: string[] }> {
		const validation = this.validateConfig(config);
		if (!validation.valid) return validation;

		const { formatId } = config as PayrollExportReportConfig;
		if (!(await getPayrollExportConfig(organizationId, formatId))) {
			return {
				valid: false,
				errors: [`Payroll export format is not configured: ${formatId}`],
			};
		}

		return { valid: true };
	}
}
