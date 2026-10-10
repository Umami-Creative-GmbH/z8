/**
 * Payroll Export Service
 * Orchestrates the export process: data fetching, transformation, and file generation
 */

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, payrollExportJob, payrollExportSyncRecord } from "@/db";
import type { PayrollExportJobPersonnelIdentifier } from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	insertPayrollExportWorkInput,
	PayrollExportWorkInputIntegrityError,
	readPayrollExportWorkInput,
} from "@/lib/payroll-collection/payroll-export-work-input";
import {
	type CollectedPayrollWorkInput,
	frozenPersonnelIdentifier,
	type StoredPayrollWorkInput,
} from "@/lib/payroll-collection/payroll-work-collection";
import { PayrollWorkCollectionBlockedError } from "@/lib/payroll-collection/payroll-work-collection-blocked-error";
import {
	collectPayrollWork,
	isPayrollWorkCollectionActive,
} from "@/lib/payroll-collection/payroll-work-collection-reader";
import { getPresignedUrl, uploadExport } from "@/lib/storage/export-s3-client";
import {
	classifyPayrollRunCandidates,
	countIncludedReportsByRun,
	exportIsPayrollRun,
	includeReportsInPayrollRun,
	type PayrollRunSkipped,
} from "@/lib/travel-expenses/payroll-run";
import { notifyPayrollRunExported } from "@/lib/travel-expenses/payroll-run-notifications";
import { parsePayrollLogicalDate, serializePayrollLogicalDate } from "./calendar-boundaries";
import { workPeriodsFromCollectedInput } from "./collected-work";
import { personioConnector } from "./connectors/personio-connector";
import { PayrollConnectorRegistry } from "./connectors/registry";
import { successFactorsConnector } from "./connectors/successfactors-connector";
import type { PayrollApiConnector } from "./connectors/types";
import {
	countWorkPeriods,
	fetchAbsencesForExport,
	fetchWorkPeriodsForExport,
	getPayrollExportConfig,
	getWageTypeMappings,
	resolvePayrollRunEmployeeIds,
} from "./data-fetcher";
import { isExpensePayrollFormat } from "./expense-wage-type.types";
import { successFactorsFormatter } from "./exporters/successfactors/successfactors-formatter";
import { workdayConnector } from "./exporters/workday/workday-connector";
import type { PayrollExportApiFormatId, PayrollExportFileFormatId } from "./format-registry";
import { DatevLohnFormatter } from "./formatters/datev-lohn-formatter";
import { LexwareLohnFormatter } from "./formatters/lexware-lohn-formatter";
import { SageLohnFormatter } from "./formatters/sage-lohn-formatter";
import {
	employeesWithoutIdentifier,
	PayrollIdentifierChangedError,
	PayrollIdentifierMissingError,
	payrollIdentifierCustomFieldId,
	withPersonnelIdentifiers,
} from "./personnel-identifier";
import { readPersonnelIdentifierValues } from "./personnel-identifier-store";
import type {
	AbsenceData,
	ApiExportResult,
	ExportResult,
	IPayrollExporter,
	IPayrollExportFormatter,
	PayrollExportFilters,
	PayrollExportJobSummary,
	SerializedPayrollExportFilters,
	WorkPeriodData,
} from "./types";

const logger = createLogger("PayrollExportService");

/**
 * One implementation per format in the format registry (#823), of the format's
 * kind: a format registered without one fails typechecking.
 */
const fileFormatters: Record<PayrollExportFileFormatId, IPayrollExportFormatter> = {
	datev_lohn: new DatevLohnFormatter(),
	lexware_lohn: new LexwareLohnFormatter(),
	sage_lohn: new SageLohnFormatter(),
	successfactors_csv: successFactorsFormatter,
};
const apiConnectors: Record<PayrollExportApiFormatId, PayrollApiConnector> = {
	personio: personioConnector,
	successfactors_api: successFactorsConnector,
	workday_api: workdayConnector,
};

/**
 * Registry of available file-based export formatters (DATEV, SAGE, etc.)
 */
const formatters = new Map<string, IPayrollExportFormatter>(Object.entries(fileFormatters));

/**
 * Registry of available API-based exporters (Personio, etc.)
 */
const connectorRegistry = new PayrollConnectorRegistry();
for (const connector of Object.values(apiConnectors)) {
	connectorRegistry.register(connector);
}

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

export interface ProcessPayrollExportJobInput {
	jobId: string;
	organizationId: string;
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
	/**
	 * The present organization administrator who may execute eligible historical repairs
	 * before collection (#322). Omitted, collection runs without repair.
	 */
	repairActorUserId?: string | null;
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

	// A custom field identifier (#821) is checked for every employee the export
	// carries rows for, before the job exists, and frozen with it.
	const identifierFieldId = payrollIdentifierCustomFieldId(configResult.config.config);
	const scopedCollection = await isPayrollWorkCollectionActive(db, params.organizationId);
	const employeesWithOtherRows =
		identifierFieldId === null
			? []
			: await employeesWithAbsencesOrExpenseLines({
					organizationId: params.organizationId,
					formatId: params.formatId,
					filters: params.filters,
					scopedCollection,
				});

	// Under scoped collection (#322) the work is collected now, before the job exists,
	// and stored with it; otherwise the legacy read runs when the job is processed.
	const collectedInput = scopedCollection
		? await collectExportWorkInput({
				...params,
				personnelIdentifier:
					identifierFieldId === null
						? null
						: { customFieldId: identifierFieldId, employeesWithOtherRows },
			})
		: null;
	const legacyIdentifier =
		!scopedCollection && identifierFieldId !== null
			? await freezeLegacyPersonnelIdentifier({
					organizationId: params.organizationId,
					filters: params.filters,
					customFieldId: identifierFieldId,
					employeesWithOtherRows,
				})
			: null;

	// Count work periods to determine sync/async
	// Use the sync threshold from whichever is available (formatter or exporter)
	const count = collectedInput
		? collectedInput.work.length
		: await countWorkPeriods(params.organizationId, params.filters);
	const syncThreshold = formatter?.getSyncThreshold() ?? exporter?.getSyncThreshold() ?? 500;
	const isAsync = count > syncThreshold;

	// Serialize filters for storage
	const serializedFilters: SerializedPayrollExportFilters = {
		dateRange: {
			start: serializePayrollLogicalDate(params.filters.dateRange.start),
			end: serializePayrollLogicalDate(params.filters.dateRange.end),
		},
		employeeIds: params.filters.employeeIds,
		teamIds: params.filters.teamIds,
		projectIds: params.filters.projectIds,
	};

	// Create the job record; collected input commits with it, before any delivery.
	const job = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(payrollExportJob)
			.values({
				organizationId: params.organizationId,
				configId: configResult.config.id,
				requestedById: params.requestedById,
				filters: serializedFilters,
				personnelIdentifier: legacyIdentifier,
				isAsync,
				status: "pending",
			})
			.returning();
		if (collectedInput) await insertPayrollExportWorkInput(tx, created.id, collectedInput);
		return created;
	});

	logger.info({ jobId: job.id, isAsync, workPeriodCount: count }, "Payroll export job created");

	return { jobId: job.id, isAsync };
}

/**
 * Process an export job
 * Called inline for synchronous and scheduled execution.
 * Interactive asynchronous execution is handled by the dedicated worker.
 * Supports both file-based formatters (DATEV) and API-based exporters (Personio)
 */
export async function processExportJob({
	jobId,
	organizationId,
}: ProcessPayrollExportJobInput): Promise<{
	result?: ExportResult;
	apiResult?: ApiExportResult;
	downloadUrl?: string;
}> {
	logger.info({ jobId, organizationId }, "Processing payroll export job");

	// Update status to processing
	await db
		.update(payrollExportJob)
		.set({ status: "processing", startedAt: new Date() })
		.where(
			and(eq(payrollExportJob.id, jobId), eq(payrollExportJob.organizationId, organizationId)),
		);

	try {
		// Fetch job with config
		const job = await db.query.payrollExportJob.findFirst({
			where: and(
				eq(payrollExportJob.id, jobId),
				eq(payrollExportJob.organizationId, organizationId),
			),
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
				start: parsePayrollLogicalDate(job.filters.dateRange.start),
				end: parsePayrollLogicalDate(job.filters.dateRange.end),
			},
			employeeIds: job.filters.employeeIds,
			teamIds: job.filters.teamIds,
			projectIds: job.filters.projectIds,
		};

		// A job collected under scoped collection reuses its stored input, including on
		// recovery; changed work is never reread for it.
		const storedInput = await readPayrollExportWorkInput(db, job.organizationId, jobId);
		if (
			storedInput &&
			(storedInput.scope.startDate !== job.filters.dateRange.start ||
				storedInput.scope.endDate !== job.filters.dateRange.end)
		) {
			throw new PayrollExportWorkInputIntegrityError(jobId);
		}

		// Fetch data
		const [collectedWorkPeriods, fetchedAbsences, mappings] = await Promise.all([
			storedInput
				? workPeriodsFromCollectedInput(storedInput)
				: fetchWorkPeriodsForExport(job.organizationId, filters),
			fetchAbsencesForExport(job.organizationId, filters, {
				canonicalReadiness: storedInput ? "absences" : "cutover",
			}),
			getWageTypeMappings(job.organizationId),
		]);

		// A custom field identifier (#821): the run's frozen values, never the employee number.
		const identify = personnelIdentifierResolver({
			jobId,
			organizationId: job.organizationId,
			config: job.config.config,
			frozen: storedInput
				? frozenPersonnelIdentifier(storedInput)
				: (job.personnelIdentifier ?? null),
		});
		const [workPeriods, absences] = await identify.workAndAbsences(
			collectedWorkPeriods,
			fetchedAbsences,
		);

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
				.where(
					and(eq(payrollExportJob.id, jobId), eq(payrollExportJob.organizationId, organizationId)),
				);

			logger.info(
				{
					jobId,
					organizationId,
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
			const formatId = job.config.formatId;
			const payrollRun =
				isExpensePayrollFormat(formatId) &&
				(await exportIsPayrollRun(db, { organizationId: job.organizationId, formatId }));
			// Awaited inside the try: a failed delivery must reach the catch that marks the job failed.
			if (!payrollRun) {
				return await writeFileExport(
					db,
					job,
					formatter.transform(
						workPeriods,
						absences,
						[],
						mappings,
						job.config.config as Record<string, unknown>,
					),
				);
			}

			// A payroll run (#852): the inclusions commit with the finished job, or not at all,
			// so a failed export never holds reports and earlier runs keep theirs.
			const employeeIds = await resolvePayrollRunEmployeeIds(job.organizationId, filters);
			let skipped: PayrollRunSkipped[] = [];
			const exported = await db.transaction(async (tx) => {
				const inclusion = await includeReportsInPayrollRun(tx, {
					organizationId: job.organizationId,
					jobId: job.id,
					format: formatId,
					period: { startDate: job.filters.dateRange.start, endDate: job.filters.dateRange.end },
					employeeIds,
				});
				logger.info(
					{
						jobId,
						organizationId,
						includedReports: inclusion.includedReportIds.length,
						skippedReports: inclusion.skipped.map(({ source, reason }) => ({ source, reason })),
					},
					"Payroll run included reports awaiting reimbursement",
				);
				// A missing identifier throws here and rolls the inclusions back.
				const expenseLines = await identify.rows(inclusion.expenseLines);
				skipped = inclusion.skipped;
				return writeFileExport(
					tx,
					job,
					formatter.transform(
						workPeriods,
						absences,
						expenseLines,
						mappings,
						job.config.config as Record<string, unknown>,
					),
				);
			});
			// After the commit (#855): officers learn of the run and of the reports it left out.
			// Never throws, so the finished export is never marked failed.
			await notifyPayrollRunExported(db, {
				organizationId: job.organizationId,
				jobId: job.id,
				skipped,
			});
			return exported;
		}

		throw new Error("Neither formatter nor exporter available");
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ jobId, organizationId, error: errorMessage }, "Payroll export job failed");

		await markPayrollExportJobFailed({ jobId, organizationId, errorMessage });

		throw error;
	}
}

/**
 * Stores a file export's result: uploaded for an asynchronous job, returned
 * inline for a synchronous one. `database` is the payroll run's transaction
 * when the file carries expense lines (#852).
 */
async function writeFileExport(
	database: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
	job: { id: string; organizationId: string; isAsync: boolean },
	exportResult: ExportResult,
): Promise<{ result?: ExportResult; downloadUrl?: string }> {
	const jobId = job.id;
	const organizationId = job.organizationId;
	const contentBuffer =
		typeof exportResult.content === "string"
			? Buffer.from(exportResult.content, exportResult.encoding)
			: exportResult.content;

	if (job.isAsync) {
		// Upload to S3
		const s3Key = `payroll-exports/${organizationId}/${jobId}/${exportResult.fileName}`;
		await uploadExport(organizationId, s3Key, contentBuffer, exportResult.mimeType);

		// Generate download URL
		const downloadUrl = await getPresignedUrl(organizationId, s3Key);

		// Update job with results
		await database
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
			.where(
				and(eq(payrollExportJob.id, jobId), eq(payrollExportJob.organizationId, organizationId)),
			);

		logger.info({ jobId, organizationId, s3Key }, "Async file export completed");

		return { downloadUrl };
	}

	// Sync export - update job and return result
	await database
		.update(payrollExportJob)
		.set({
			status: "completed",
			fileName: exportResult.fileName,
			fileSizeBytes: contentBuffer.length,
			workPeriodCount: exportResult.metadata.workPeriodCount,
			employeeCount: exportResult.metadata.employeeCount,
			completedAt: new Date(),
		})
		.where(
			and(eq(payrollExportJob.id, jobId), eq(payrollExportJob.organizationId, organizationId)),
		);

	logger.info({ jobId, organizationId }, "Sync file export completed");

	return { result: exportResult };
}

/**
 * Scoped collection for an export (#322): eligible repair, then readiness and
 * collection in one snapshot. Any blocker refuses the whole export.
 */
async function collectExportWorkInput(params: {
	organizationId: string;
	filters: PayrollExportFilters;
	repairActorUserId?: string | null;
	/** The configured custom field identifier (#821), read as of the period's last day. */
	personnelIdentifier: { customFieldId: string; employeesWithOtherRows: string[] } | null;
}): Promise<CollectedPayrollWorkInput> {
	const startDate = params.filters.dateRange.start.toISODate();
	const endDate = params.filters.dateRange.end.toISODate();
	if (!startDate || !endDate) {
		throw new Error("Invalid payroll export date range");
	}

	const { collection, repair } = await collectPayrollWork(db, {
		organizationId: params.organizationId,
		filters: {
			startDate,
			endDate,
			employeeIds: params.filters.employeeIds,
			teamIds: params.filters.teamIds,
			projectIds: params.filters.projectIds,
		},
		repairActorUserId: params.repairActorUserId ?? null,
		personnelIdentifier: params.personnelIdentifier,
	});

	if (collection.blockers.length > 0) {
		logger.warn(
			{
				organizationId: params.organizationId,
				repair: repair.status,
				blockers: collection.blockers,
			},
			"Payroll export blocked by uncertain work in the requested scope",
		);
		throw new PayrollWorkCollectionBlockedError(params.organizationId, collection.blockers);
	}

	logger.info(
		{
			organizationId: params.organizationId,
			repair: repair.status,
			workCount: collection.input.work.length,
			digest: collection.input.digest,
		},
		"Payroll work collected for export",
	);
	return collection.input;
}

/**
 * The employees an export carries absences or expense lines for (#821): they
 * need an identifier value like employees with work. Absences are the ones the
 * export reads; expense lines those a payroll run of the format would include.
 */
async function employeesWithAbsencesOrExpenseLines(input: {
	organizationId: string;
	formatId: string;
	filters: PayrollExportFilters;
	scopedCollection: boolean;
}): Promise<string[]> {
	const absences = await fetchAbsencesForExport(input.organizationId, input.filters, {
		canonicalReadiness: input.scopedCollection ? "absences" : "cutover",
	});
	const employeeIds = new Set(absences.map((absence) => absence.employeeId));
	if (
		formatters.has(input.formatId) &&
		(await exportIsPayrollRun(db, {
			organizationId: input.organizationId,
			formatId: input.formatId,
		}))
	) {
		const candidates = await classifyPayrollRunCandidates(db, {
			organizationId: input.organizationId,
			format: input.formatId,
			period: logicalPeriod(input.filters),
			employeeIds: await resolvePayrollRunEmployeeIds(input.organizationId, input.filters),
		});
		for (const candidate of candidates) {
			if (candidate.classification.outcome === "include") {
				employeeIds.add(candidate.account.employeeId);
			}
		}
	}
	return [...employeeIds].toSorted();
}

function logicalPeriod(filters: PayrollExportFilters): { startDate: string; endDate: string } {
	const startDate = filters.dateRange.start.toISODate();
	const endDate = filters.dateRange.end.toISODate();
	if (!startDate || !endDate) {
		throw new Error("Invalid payroll export date range");
	}
	return { startDate, endDate };
}

/**
 * Without scoped collection (#821): reads the identifier of the export's
 * employees as of the period's last day, refuses the export before the job
 * exists when an employee with work, absences or expense lines has none, and
 * returns the values to freeze with the job.
 */
async function freezeLegacyPersonnelIdentifier(input: {
	organizationId: string;
	filters: PayrollExportFilters;
	customFieldId: string;
	employeesWithOtherRows: readonly string[];
}): Promise<PayrollExportJobPersonnelIdentifier> {
	const { endDate } = logicalPeriod(input.filters);
	const [scope, workPeriods] = await Promise.all([
		resolvePayrollRunEmployeeIds(input.organizationId, input.filters),
		fetchWorkPeriodsForExport(input.organizationId, input.filters),
	]);
	const values = await readPersonnelIdentifierValues(db, {
		organizationId: input.organizationId,
		customFieldId: input.customFieldId,
		employeeIds: scope,
		asOf: parsePlainDate(endDate),
	});
	const missing = employeesWithoutIdentifier(
		[...workPeriods.map((period) => period.employeeId), ...input.employeesWithOtherRows].map(
			(employeeId) => ({ employeeId }),
		),
		values,
	);
	if (missing.length > 0) {
		throw new PayrollIdentifierMissingError(missing, input.organizationId);
	}
	return { customFieldId: input.customFieldId, asOf: endDate, values };
}

/**
 * Sets the configured custom field identifier (#821) on export rows, from the
 * values frozen when the job was created: with its collected input, or on the
 * job without scoped collection. A later change never alters a run, retry,
 * recovery or re-delivery. A configuration now naming another field than the
 * frozen one refuses the job. Rows of an employee without a value refuse the
 * export (only reachable when rows appeared after creation). Without a custom
 * field identifier, rows pass through unchanged.
 */
function personnelIdentifierResolver(input: {
	jobId: string;
	organizationId: string;
	config: Record<string, unknown>;
	frozen: { customFieldId: string; values: Record<string, string> } | null;
}) {
	const customFieldId = payrollIdentifierCustomFieldId(input.config);

	function frozenValues(): Record<string, string> {
		if (customFieldId === null) return {};
		if (input.frozen?.customFieldId !== customFieldId) {
			throw new PayrollIdentifierChangedError(input.jobId, input.organizationId);
		}
		return input.frozen.values;
	}

	/** The values for the rows' employees; any employee without one refuses the export. */
	async function complete(items: readonly { employeeId: string }[]) {
		const values = frozenValues();
		const missing = employeesWithoutIdentifier(items, values);
		if (missing.length > 0) {
			throw new PayrollIdentifierMissingError(missing, input.organizationId);
		}
		return values;
	}

	return {
		async rows<T extends { employeeId: string }>(items: T[]): Promise<T[]> {
			if (customFieldId === null) return items;
			return withPersonnelIdentifiers(items, await complete(items));
		},
		/** Both row sets, refused together when any of their employees has no value. */
		async workAndAbsences(
			workPeriods: WorkPeriodData[],
			absences: AbsenceData[],
		): Promise<[WorkPeriodData[], AbsenceData[]]> {
			if (customFieldId === null) return [workPeriods, absences];
			const values = await complete([...workPeriods, ...absences]);
			return [
				withPersonnelIdentifiers(workPeriods, values),
				withPersonnelIdentifiers(absences, values),
			];
		},
	};
}

export async function markPayrollExportJobFailed({
	jobId,
	organizationId,
	errorMessage,
}: ProcessPayrollExportJobInput & { errorMessage: string }): Promise<void> {
	await db
		.update(payrollExportJob)
		.set({
			status: "failed",
			errorMessage,
			completedAt: new Date(),
		})
		.where(
			and(eq(payrollExportJob.id, jobId), eq(payrollExportJob.organizationId, organizationId)),
		);
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

	const skippedMap = new Map<string, NonNullable<typeof result.skipped>[0]>();
	for (const skipped of result.skipped ?? []) {
		skippedMap.set(skipped.recordId, skipped);
	}

	const records: Array<typeof payrollExportSyncRecord.$inferInsert> = [];

	// Create sync records for work periods (attendances)
	for (const period of workPeriods) {
		const error = errorMap.get(period.id);
		const skipped = skippedMap.get(period.id);
		records.push({
			jobId,
			recordType: "attendance",
			sourceRecordId: period.id,
			employeeId: period.employeeId,
			status: error ? "failed" : skipped ? "skipped" : "synced",
			errorMessage: error?.errorMessage ?? skipped?.reason,
			isRetryable: error?.isRetryable ?? true,
			attemptCount: 1,
			lastAttemptAt: new Date(),
			syncedAt: error || skipped ? null : new Date(),
		});
	}

	// Create sync records for absences
	for (const absence of absences) {
		const error = errorMap.get(absence.id);
		const skipped = skippedMap.get(absence.id);
		records.push({
			jobId,
			recordType: "absence",
			sourceRecordId: absence.id,
			employeeId: absence.employeeId,
			status: error ? "failed" : skipped ? "skipped" : "synced",
			errorMessage: error?.errorMessage ?? skipped?.reason,
			isRetryable: error?.isRetryable ?? true,
			attemptCount: 1,
			lastAttemptAt: new Date(),
			syncedAt: error || skipped ? null : new Date(),
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
	const included = await countIncludedReportsByRun(db, {
		organizationId,
		jobIds: jobs.map((job) => job.id),
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
		payrollRunIncludedReports: included.get(job.id) ?? 0,
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
