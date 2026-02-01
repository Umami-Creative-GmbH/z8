/**
 * Payroll Export Service
 * Orchestrates the export process: data fetching, transformation, and file generation
 */
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { db, payrollExportJob } from "@/db";
import { createLogger } from "@/lib/logger";
import { uploadExport, getPresignedUrl } from "@/lib/storage/export-s3-client";
import {
	fetchWorkPeriodsForExport,
	fetchAbsencesForExport,
	getPayrollExportConfig,
	getWageTypeMappings,
	countWorkPeriods,
} from "./data-fetcher";
import { DatevLohnFormatter } from "./formatters/datev-lohn-formatter";
import type {
	IPayrollExportFormatter,
	PayrollExportFilters,
	SerializedPayrollExportFilters,
	ExportResult,
	PayrollExportJobSummary,
} from "./types";

const logger = createLogger("PayrollExportService");

/**
 * Registry of available export formatters
 */
const formatters = new Map<string, IPayrollExportFormatter>();

// Register DATEV formatter
const datevFormatter = new DatevLohnFormatter();
formatters.set(datevFormatter.formatId, datevFormatter);

/**
 * Get formatter by ID
 */
export function getFormatter(formatId: string): IPayrollExportFormatter | undefined {
	return formatters.get(formatId);
}

/**
 * Get all available formatters
 */
export function getAvailableFormatters(): IPayrollExportFormatter[] {
	return Array.from(formatters.values());
}

/**
 * Create a payroll export job
 * Determines sync vs async based on data volume
 */
export async function createExportJob(params: {
	organizationId: string;
	formatId: string;
	requestedById: string;
	filters: PayrollExportFilters;
}): Promise<{
	jobId: string;
	isAsync: boolean;
}> {
	logger.info(
		{ organizationId: params.organizationId, formatId: params.formatId },
		"Creating payroll export job",
	);

	const formatter = formatters.get(params.formatId);
	if (!formatter) {
		throw new Error(`Unknown export format: ${params.formatId}`);
	}

	// Verify configuration exists
	const configResult = await getPayrollExportConfig(params.organizationId, params.formatId);
	if (!configResult) {
		throw new Error(`No configuration found for format: ${params.formatId}`);
	}

	// Count work periods to determine sync/async
	const count = await countWorkPeriods(params.organizationId, params.filters);
	const isAsync = count > formatter.getSyncThreshold();

	// Serialize filters for storage
	const serializedFilters: SerializedPayrollExportFilters = {
		dateRange: {
			start: params.filters.dateRange.start.toISO()!,
			end: params.filters.dateRange.end.toISO()!,
		},
		employeeIds: params.filters.employeeIds,
		teamIds: params.filters.teamIds,
		projectIds: params.filters.projectIds,
	};

	// Create job record
	const [job] = await db
		.insert(payrollExportJob)
		.values({
			organizationId: params.organizationId,
			configId: configResult.config.id,
			requestedById: params.requestedById,
			filters: serializedFilters,
			isAsync,
			status: "pending",
		})
		.returning();

	logger.info(
		{ jobId: job.id, isAsync, workPeriodCount: count },
		"Payroll export job created",
	);

	return { jobId: job.id, isAsync };
}

/**
 * Process an export job
 * Called immediately for sync jobs, or by cron for async jobs
 */
export async function processExportJob(jobId: string): Promise<{
	result?: ExportResult;
	downloadUrl?: string;
}> {
	logger.info({ jobId }, "Processing payroll export job");

	// Update status to processing
	await db
		.update(payrollExportJob)
		.set({ status: "processing", startedAt: new Date() })
		.where(eq(payrollExportJob.id, jobId));

	try {
		// Fetch job with config
		const job = await db.query.payrollExportJob.findFirst({
			where: eq(payrollExportJob.id, jobId),
			with: {
				config: {
					with: {
						format: true,
					},
				},
			},
		});

		if (!job) {
			throw new Error(`Job not found: ${jobId}`);
		}

		const formatter = formatters.get(job.config.formatId);
		if (!formatter) {
			throw new Error(`Unknown format: ${job.config.formatId}`);
		}

		// Parse filters
		const filters: PayrollExportFilters = {
			dateRange: {
				start: DateTime.fromISO(job.filters.dateRange.start),
				end: DateTime.fromISO(job.filters.dateRange.end),
			},
			employeeIds: job.filters.employeeIds,
			teamIds: job.filters.teamIds,
			projectIds: job.filters.projectIds,
		};

		// Fetch data
		const [workPeriods, absences, mappings] = await Promise.all([
			fetchWorkPeriodsForExport(job.organizationId, filters),
			fetchAbsencesForExport(job.organizationId, filters),
			getWageTypeMappings(job.configId),
		]);

		// Transform to export format
		const exportResult = formatter.transform(
			workPeriods,
			absences,
			mappings,
			job.config.config as Record<string, unknown>,
		);

		let downloadUrl: string | undefined;

		if (job.isAsync) {
			// Upload to S3
			const s3Key = `payroll-exports/${job.organizationId}/${job.id}/${exportResult.fileName}`;
			const contentBuffer =
				typeof exportResult.content === "string"
					? Buffer.from(exportResult.content, exportResult.encoding)
					: exportResult.content;

			await uploadExport(job.organizationId, s3Key, contentBuffer, exportResult.mimeType);

			// Generate download URL
			downloadUrl = await getPresignedUrl(job.organizationId, s3Key);

			// Update job with results
			await db
				.update(payrollExportJob)
				.set({
					status: "completed",
					fileName: exportResult.fileName,
					s3Key,
					fileSizeBytes: contentBuffer.length,
					workPeriodCount: exportResult.metadata.workPeriodCount,
					employeeCount: exportResult.metadata.employeeCount,
					completedAt: new Date(),
					expiresAt: DateTime.now().plus({ days: 30 }).toJSDate(),
				})
				.where(eq(payrollExportJob.id, jobId));

			logger.info({ jobId, s3Key }, "Async payroll export completed");

			return { downloadUrl };
		} else {
			// Sync export - update job and return result
			const contentBuffer =
				typeof exportResult.content === "string"
					? Buffer.from(exportResult.content, exportResult.encoding)
					: exportResult.content;

			await db
				.update(payrollExportJob)
				.set({
					status: "completed",
					fileName: exportResult.fileName,
					fileSizeBytes: contentBuffer.length,
					workPeriodCount: exportResult.metadata.workPeriodCount,
					employeeCount: exportResult.metadata.employeeCount,
					completedAt: new Date(),
				})
				.where(eq(payrollExportJob.id, jobId));

			logger.info({ jobId }, "Sync payroll export completed");

			return { result: exportResult };
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ jobId, error: errorMessage }, "Payroll export job failed");

		await db
			.update(payrollExportJob)
			.set({
				status: "failed",
				errorMessage,
				completedAt: new Date(),
			})
			.where(eq(payrollExportJob.id, jobId));

		throw error;
	}
}

/**
 * Get pending async export jobs for cron processing
 */
export async function getPendingExportJobs(): Promise<string[]> {
	const jobs = await db.query.payrollExportJob.findMany({
		where: eq(payrollExportJob.status, "pending"),
		columns: { id: true },
	});

	return jobs.map((j) => j.id);
}

/**
 * Get export job history for an organization
 */
export async function getExportJobHistory(
	organizationId: string,
	limit = 50,
): Promise<PayrollExportJobSummary[]> {
	const jobs = await db.query.payrollExportJob.findMany({
		where: eq(payrollExportJob.organizationId, organizationId),
		orderBy: (job, { desc }) => [desc(job.createdAt)],
		limit,
	});

	return jobs.map((job) => ({
		id: job.id,
		status: job.status,
		fileName: job.fileName,
		fileSizeBytes: job.fileSizeBytes,
		workPeriodCount: job.workPeriodCount,
		employeeCount: job.employeeCount,
		createdAt: job.createdAt,
		completedAt: job.completedAt,
		errorMessage: job.errorMessage,
		filters: job.filters,
	}));
}

/**
 * Get download URL for a completed export
 */
export async function getExportDownloadUrl(
	organizationId: string,
	jobId: string,
): Promise<string | null> {
	const job = await db.query.payrollExportJob.findFirst({
		where: eq(payrollExportJob.id, jobId),
	});

	if (!job || job.organizationId !== organizationId) {
		return null;
	}

	if (job.status !== "completed" || !job.s3Key) {
		return null;
	}

	return getPresignedUrl(organizationId, job.s3Key);
}
