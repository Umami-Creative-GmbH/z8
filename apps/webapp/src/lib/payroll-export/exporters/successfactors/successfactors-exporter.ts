/**
 * SAP SuccessFactors Payroll Exporter
 * Implements IPayrollExporter for pushing time entries to SAP SuccessFactors OData API
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault/secrets";
import { SuccessFactorsApiClient } from "./api-client";
import { validateSuccessFactorsConfig, validateApiConfig } from "./shared/config-validator";
import { transformWorkPeriods } from "./shared/time-transformer";
import { transformAbsences } from "./shared/absence-transformer";
import type {
	IPayrollExporter,
	WorkPeriodData,
	AbsenceData,
	WageTypeMapping,
	ApiExportResult,
} from "../../types";
import type {
	SuccessFactorsConfig,
	SuccessFactorsCredentials,
} from "./types";
import { DEFAULT_SUCCESSFACTORS_CONFIG, SF_VAULT_KEYS } from "./types";

const logger = createLogger("SuccessFactorsExporter");

const SYNC_THRESHOLD = 500; // Max records for sync export

/**
 * SAP SuccessFactors Payroll Exporter
 * Pushes time entries and absences directly to SAP SuccessFactors OData API
 */
export class SuccessFactorsExporter implements IPayrollExporter {
	readonly exporterId = "successfactors_api";
	readonly exporterName = "SAP SuccessFactors (API)";
	readonly version = "1.0.0";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	async validateConfig(config: Record<string, unknown>): Promise<{
		valid: boolean;
		errors?: string[];
	}> {
		const baseValidation = validateSuccessFactorsConfig(config);
		if (!baseValidation.valid) {
			return baseValidation;
		}

		// Additional validation for API mode
		const sfConfig = { ...DEFAULT_SUCCESSFACTORS_CONFIG, ...config } as SuccessFactorsConfig;
		return validateApiConfig(sfConfig);
	}

	async testConnection(
		organizationId: string,
		config: Record<string, unknown>,
	): Promise<{
		success: boolean;
		error?: string;
	}> {
		try {
			const credentials = await this.getCredentials(organizationId);
			if (!credentials) {
				return {
					success: false,
					error:
						"SAP SuccessFactors credentials not configured. Please enter your Client ID and Client Secret.",
				};
			}

			const sfConfig = { ...DEFAULT_SUCCESSFACTORS_CONFIG, ...config } as SuccessFactorsConfig;

			if (!sfConfig.instanceUrl) {
				return {
					success: false,
					error: "Instance URL is required for connection test.",
				};
			}

			if (!sfConfig.companyId) {
				return {
					success: false,
					error: "Company ID is required for connection test.",
				};
			}

			const client = new SuccessFactorsApiClient(
				credentials,
				sfConfig.instanceUrl,
				sfConfig.companyId,
				sfConfig.apiTimeoutMs,
			);

			return await client.testConnection();
		} catch (error) {
			logger.error({ error }, "Connection test failed");
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async export(
		organizationId: string,
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): Promise<ApiExportResult> {
		const startTime = Date.now();
		logger.info(
			{
				organizationId,
				workPeriodCount: workPeriods.length,
				absenceCount: absences.length,
			},
			"Starting SAP SuccessFactors export",
		);

		const sfConfig = { ...DEFAULT_SUCCESSFACTORS_CONFIG, ...config } as SuccessFactorsConfig;
		const credentials = await this.getCredentials(organizationId);

		if (!credentials) {
			throw new Error("SAP SuccessFactors credentials not configured");
		}

		const client = new SuccessFactorsApiClient(
			credentials,
			sfConfig.instanceUrl,
			sfConfig.companyId,
			sfConfig.apiTimeoutMs,
		);

		// Transform data using shared transformers
		const timeRecords = transformWorkPeriods(workPeriods, mappings, sfConfig);
		const absenceData = transformAbsences(absences, mappings, sfConfig);

		// Track all errors for result
		const errors: ApiExportResult["errors"] = [];
		let apiCallCount = 0;

		// Export time records in batches
		const timeRecordRequests = timeRecords.map((t) => t.request);
		let syncedTimeRecords = 0;

		for (let i = 0; i < timeRecordRequests.length; i += sfConfig.batchSize) {
			const batch = timeRecordRequests.slice(i, i + sfConfig.batchSize);
			const batchSourceIds = timeRecords
				.slice(i, i + sfConfig.batchSize)
				.map((t) => t.sourceId);

			const batchResults = await client.createTimeRecords(batch);
			apiCallCount += batch.length;

			batchResults.forEach((result, index) => {
				if (result.success) {
					syncedTimeRecords++;
				} else {
					const sourceId = batchSourceIds[index];
					const originalPeriod = workPeriods.find((p) => p.id === sourceId);
					errors.push({
						recordId: sourceId,
						recordType: "attendance",
						employeeId: originalPeriod?.employeeId || "",
						errorMessage: result.error?.message || "Unknown error",
						isRetryable: result.error?.isRetryable ?? true,
					});
				}
			});
		}

		// Export absences in batches
		const validAbsenceData = absenceData.filter(
			(a): a is NonNullable<typeof a> => a !== null,
		);
		const absenceRequests = validAbsenceData.map((a) => a.request);
		let syncedAbsences = 0;

		for (let i = 0; i < absenceRequests.length; i += sfConfig.batchSize) {
			const batch = absenceRequests.slice(i, i + sfConfig.batchSize);
			const batchSourceIds = validAbsenceData
				.slice(i, i + sfConfig.batchSize)
				.map((a) => a.sourceId);

			const batchResults = await client.createAbsences(batch);
			apiCallCount += batch.length;

			batchResults.forEach((result, index) => {
				if (result.success) {
					syncedAbsences++;
				} else {
					const sourceId = batchSourceIds[index];
					const originalAbsence = absences.find((a) => a.id === sourceId);
					errors.push({
						recordId: sourceId,
						recordType: "absence",
						employeeId: originalAbsence?.employeeId || "",
						errorMessage: result.error?.message || "Unknown error",
						isRetryable: result.error?.isRetryable ?? true,
					});
				}
			});
		}

		// Count skipped absences (those without mappings)
		const skippedAbsences = absenceData.filter((a) => a === null).length;

		// Calculate results
		const totalRecords = workPeriods.length + absences.length;
		const syncedRecords = syncedTimeRecords + syncedAbsences;
		const failedRecords = errors.length;

		// Get unique employees
		const uniqueEmployees = new Set([
			...workPeriods.map((p) => p.employeeId),
			...absences.map((a) => a.employeeId),
		]);

		// Get date range
		const dateRange = this.getDateRange(workPeriods, absences);
		const durationMs = Date.now() - startTime;

		const result: ApiExportResult = {
			success: failedRecords === 0,
			totalRecords,
			syncedRecords,
			failedRecords,
			skippedRecords: skippedAbsences,
			errors,
			metadata: {
				employeeCount: uniqueEmployees.size,
				dateRange: {
					start: dateRange.start?.toISODate() || "",
					end: dateRange.end?.toISODate() || "",
				},
				apiCallCount,
				durationMs,
			},
		};

		logger.info(
			{
				totalRecords,
				syncedRecords,
				failedRecords,
				skippedRecords: skippedAbsences,
				durationMs,
			},
			"SAP SuccessFactors export completed",
		);

		return result;
	}

	/**
	 * Get credentials from Vault
	 */
	private async getCredentials(
		organizationId: string,
	): Promise<SuccessFactorsCredentials | null> {
		const [clientId, clientSecret] = await Promise.all([
			getOrgSecret(organizationId, SF_VAULT_KEYS.clientId),
			getOrgSecret(organizationId, SF_VAULT_KEYS.clientSecret),
		]);

		if (!clientId || !clientSecret) {
			logger.debug(
				{ organizationId },
				"SAP SuccessFactors credentials not found in Vault",
			);
			return null;
		}

		return { clientId, clientSecret };
	}

	/**
	 * Get date range from work periods and absences
	 */
	private getDateRange(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
	): { start: DateTime | null; end: DateTime | null } {
		let start: DateTime | null = null;
		let end: DateTime | null = null;

		for (const period of workPeriods) {
			if (!start || period.startTime < start) {
				start = period.startTime;
			}
			if (period.endTime && (!end || period.endTime > end)) {
				end = period.endTime;
			}
		}

		for (const absence of absences) {
			const absStart = DateTime.fromISO(absence.startDate);
			const absEnd = DateTime.fromISO(absence.endDate);

			if (!start || absStart < start) {
				start = absStart;
			}
			if (!end || absEnd > end) {
				end = absEnd;
			}
		}

		return { start, end };
	}
}

/**
 * Singleton instance
 */
export const successFactorsExporter = new SuccessFactorsExporter();
