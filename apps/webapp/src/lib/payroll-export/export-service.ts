/**
 * Payroll Export Service
 * Orchestrates the export process: data fetching, transformation, and file generation
 */
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { db, payrollExportJob, payrollExportSyncRecord } from "@/db";
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
import { LexwareLohnFormatter } from "./formatters/lexware-lohn-formatter";
import { SageLohnFormatter } from "./formatters/sage-lohn-formatter";
import { personioConnector } from "./connectors/personio-connector";
import {
	successFactorsFormatter,
} from "./exporters/successfactors";
import { successFactorsConnector } from "./connectors/successfactors-connector";
import { PayrollConnectorRegistry } from "./connectors/registry";
import type {
	IPayrollExportFormatter,
	IPayrollExporter,
	PayrollExportFilters,
	SerializedPayrollExportFilters,
	ExportResult,
	ApiExportResult,
	PayrollExportJobSummary,
	WorkPeriodData,
	AbsenceData,
} from "./types";

const logger = createLogger("PayrollExportService");

/**
 * Registry of available file-based export formatters (DATEV, SAGE, etc.)
 */
const formatters = new Map<string, IPayrollExportFormatter>();

/**
 * Registry of available API-based exporters (Personio, etc.)
 */
const connectorRegistry = new PayrollConnectorRegistry();

// Register DATEV formatter
const datevFormatter = new DatevLohnFormatter();
formatters.set(datevFormatter.formatId, datevFormatter);

// Register Lexware formatter
const lexwareFormatter = new LexwareLohnFormatter();
formatters.set(lexwareFormatter.formatId, lexwareFormatter);

// Register Sage formatter
const sageFormatter = new SageLohnFormatter();
formatters.set(sageFormatter.formatId, sageFormatter);

// Register Personio exporter
connectorRegistry.register(personioConnector);

// Register SAP SuccessFactors exporter (API mode)
connectorRegistry.register(successFactorsConnector);

// Register SAP SuccessFactors formatter (CSV mode)
formatters.set(successFactorsFormatter.formatId, successFactorsFormatter);

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
 * Get exporter by ID
 */
export function getExporter(exporterId: string): IPayrollExporter | undefined {
	return connectorRegistry.get(exporterId);
}

/**
 * Get all available exporters
 */
export function getAvailableExporters(): IPayrollExporter[] {
	return connectorRegistry.list();
}

/**
 * Check if a format is API-based (exporter) or file-based (formatter)
 */
export function isApiBasedExport(formatId: string): boolean {
	return connectorRegistry.has(formatId);
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

	// Check both formatters (file-based) and exporters (API-based)
	const formatter = formatters.get(params.formatId);
	const exporter = connectorRegistry.get(params.formatId);

	if (!formatter && !exporter) {
		throw new Error(`Unknown export format: ${params.formatId}`);
	}

	// Verify configuration exists
	const configResult = await getPayrollExportConfig(params.organizationId, params.formatId);
	if (!configResult) {
		throw new Error(`No configuration found for format: ${params.formatId}`);
	}

	// Count work periods to determine sync/async
	// Use the sync threshold from whichever is available (formatter or exporter)
	const count = await countWorkPeriods(params.organizationId, params.filters);
	const syncThreshold = formatter?.getSyncThreshold() ?? exporter?.getSyncThreshold() ?? 500;
	const isAsync = count > syncThreshold;

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
 * Supports both file-based formatters (DATEV) and API-based exporters (Personio)
 */
export async function processExportJob(jobId: string): Promise<{
	result?: ExportResult;
	apiResult?: ApiExportResult;
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

		// Check if this is a file-based formatter or API-based exporter
		const formatter = formatters.get(job.config.formatId);
		const exporter = connectorRegistry.get(job.config.formatId);

		if (!formatter && !exporter) {
			throw new Error(`Unknown format/exporter: ${job.config.formatId}`);
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

		// BRANCH: API-based exporter (Personio, etc.)
		if (exporter) {
			const apiResult = await exporter.export(
				job.organizationId,
				workPeriods,
				absences,
				mappings,
				job.config.config as Record<string, unknown>,
			);

			// Save sync records for tracking
			await saveSyncRecords(jobId, workPeriods, absences, apiResult);

			// Update job with results
			await db
				.update(payrollExportJob)
				.set({
					status: apiResult.success ? "completed" : "failed",
					workPeriodCount: apiResult.totalRecords,
					employeeCount: apiResult.metadata.employeeCount,
					syncedRecordCount: apiResult.syncedRecords,
					failedRecordCount: apiResult.failedRecords,
					completedAt: new Date(),
					errorMessage: apiResult.success
						? null
						: `${apiResult.failedRecords} of ${apiResult.totalRecords} records failed to sync`,
				})
				.where(eq(payrollExportJob.id, jobId));

			logger.info(
				{
					jobId,
					totalRecords: apiResult.totalRecords,
					syncedRecords: apiResult.syncedRecords,
					failedRecords: apiResult.failedRecords,
				},
				"API export completed",
			);

			return { apiResult };
		}

		// BRANCH: File-based formatter (DATEV, etc.)
		if (formatter) {
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

				logger.info({ jobId, s3Key }, "Async file export completed");

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

				logger.info({ jobId }, "Sync file export completed");

				return { result: exportResult };
			}
		}

		throw new Error("Neither formatter nor exporter available");
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
 * Save sync records for API-based exports
 * Enables record-level tracking and selective retry
 */
async function saveSyncRecords(
	jobId: string,
	workPeriods: WorkPeriodData[],
	absences: AbsenceData[],
	result: ApiExportResult,
): Promise<void> {
	// Build a map of errors by recordId for quick lookup
	const errorMap = new Map<string, (typeof result.errors)[0]>();
	for (const error of result.errors) {
		errorMap.set(error.recordId, error);
	}

	const records: Array<typeof payrollExportSyncRecord.$inferInsert> = [];

	// Create sync records for work periods (attendances)
	for (const period of workPeriods) {
		const error = errorMap.get(period.id);
		records.push({
			jobId,
			recordType: "attendance",
			sourceRecordId: period.id,
			employeeId: period.employeeId,
			status: error ? "failed" : "synced",
			errorMessage: error?.errorMessage,
			isRetryable: error?.isRetryable ?? true,
			attemptCount: 1,
			lastAttemptAt: new Date(),
			syncedAt: error ? null : new Date(),
		});
	}

	// Create sync records for absences
	for (const absence of absences) {
		const error = errorMap.get(absence.id);
		// Check if it was skipped (no mapping) vs failed
		const wasSkipped = !error && result.skippedRecords > 0;
		records.push({
			jobId,
			recordType: "absence",
			sourceRecordId: absence.id,
			employeeId: absence.employeeId,
			status: error ? "failed" : wasSkipped ? "skipped" : "synced",
			errorMessage: error?.errorMessage,
			isRetryable: error?.isRetryable ?? true,
			attemptCount: 1,
			lastAttemptAt: new Date(),
			syncedAt: error || wasSkipped ? null : new Date(),
		});
	}

	if (records.length > 0) {
		await db.insert(payrollExportSyncRecord).values(records);
		logger.info({ jobId, recordCount: records.length }, "Saved sync records");
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
