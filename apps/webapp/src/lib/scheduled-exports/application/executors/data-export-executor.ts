/**
 * Data Export Executor
 *
 * Handles execution of scheduled data exports.
 * Delegates to the existing data export service.
 */
import { and, eq } from "drizzle-orm";
import { db, dataExport, employee } from "@/db";
import { createLogger } from "@/lib/logger";
import { getPresignedUrl } from "@/lib/storage/export-s3-client";
import { processExport, getExportById } from "@/lib/export/export-service";
import type { IReportExecutor, ExecuteParams } from "./base-executor";
import type { ExecutionResult, DataExportReportConfig, ReportConfig } from "../../domain/types";

const logger = createLogger("DataExportExecutor");

/**
 * Valid export categories
 */
const VALID_CATEGORIES = [
	"employees",
	"teams",
	"time_entries",
	"absences",
	"projects",
	"holidays",
] as const;

/**
 * Data Export Executor
 *
 * Executes general data exports (employees, time entries, etc.)
 */
export class DataExportExecutor implements IReportExecutor {
	readonly reportType = "data_export";
	readonly displayName = "Data Export";

	/**
	 * Execute a data export
	 */
	async execute(params: ExecuteParams): Promise<ExecutionResult> {
		const { organizationId, reportConfig, createdBy } = params;
		const config = reportConfig as DataExportReportConfig;

		logger.info(
			{
				organizationId,
				categories: config.categories,
			},
			"Executing data export",
		);

		try {
			// Find employee ID from user ID for requestedBy
			let requestedById: string | undefined;
			if (createdBy) {
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, createdBy),
						eq(employee.organizationId, organizationId),
					),
					columns: { id: true },
				});
				requestedById = emp?.id;
			}

			if (!requestedById) {
				return {
					success: false,
					error: "Unable to determine requester for data export. The schedule creator may not have an employee record.",
				};
			}

			// Create data export record
			const [exportRecord] = await db
				.insert(dataExport)
				.values({
					organizationId,
					categories: config.categories,
					requestedById,
					status: "pending",
				})
				.returning();

			logger.info({ exportId: exportRecord.id }, "Data export record created");

			// Process the export synchronously
			await processExport(exportRecord.id);

			// Fetch the completed record to get S3 details
			const completedRecord = await getExportById(exportRecord.id);
			if (!completedRecord || completedRecord.status !== "completed") {
				return {
					success: false,
					error: "Export processing failed to complete",
				};
			}

			// Generate presigned URL for the completed export
			const s3Url = completedRecord.s3Key
				? await getPresignedUrl(organizationId, completedRecord.s3Key, 604800)
				: undefined;

			return {
				success: true,
				underlyingJobId: exportRecord.id,
				underlyingJobType: "data_export",
				s3Key: completedRecord.s3Key || undefined,
				s3Url,
				fileSizeBytes: completedRecord.fileSizeBytes || undefined,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error: errorMessage, organizationId }, "Data export execution failed");

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Validate data export configuration
	 */
	validateConfig(config: ReportConfig): { valid: boolean; errors?: string[] } {
		const errors: string[] = [];
		const dataConfig = config as DataExportReportConfig;

		if (!dataConfig.categories || dataConfig.categories.length === 0) {
			errors.push("At least one category is required for data exports");
		}

		if (dataConfig.categories) {
			for (const category of dataConfig.categories) {
				if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
					errors.push(`Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(", ")}`);
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}
}
