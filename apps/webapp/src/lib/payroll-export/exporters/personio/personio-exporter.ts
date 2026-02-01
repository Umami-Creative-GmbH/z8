/**
 * Personio Payroll Exporter
 * Implements IPayrollExporter for pushing time entries to Personio HR API
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault/secrets";
import { PersonioApiClient } from "./api-client";
import type {
	IPayrollExporter,
	WorkPeriodData,
	AbsenceData,
	WageTypeMapping,
	ApiExportResult,
} from "../../types";
import type {
	PersonioConfig,
	PersonioCredentials,
	PersonioAttendanceRequest,
	PersonioAbsenceRequest,
	PersonioSyncAttemptResult,
} from "./types";
import { DEFAULT_PERSONIO_CONFIG } from "./types";

const logger = createLogger("PersonioExporter");

const SYNC_THRESHOLD = 500; // Max records for sync export

/**
 * Vault keys for Personio credentials
 */
const VAULT_KEY_CLIENT_ID = "payroll/personio/client_id";
const VAULT_KEY_CLIENT_SECRET = "payroll/personio/client_secret";

/**
 * Personio Payroll Exporter
 * Pushes time entries and absences directly to Personio API
 */
export class PersonioExporter implements IPayrollExporter {
	readonly exporterId = "personio";
	readonly exporterName = "Personio";
	readonly version = "1.0.0";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	async validateConfig(config: Record<string, unknown>): Promise<{
		valid: boolean;
		errors?: string[];
	}> {
		const errors: string[] = [];
		const personioConfig = config as Partial<PersonioConfig>;

		if (
			personioConfig.employeeMatchStrategy &&
			!["employeeNumber", "email"].includes(personioConfig.employeeMatchStrategy)
		) {
			errors.push("Employee match strategy must be 'employeeNumber' or 'email'");
		}

		if (
			personioConfig.batchSize !== undefined &&
			(personioConfig.batchSize < 1 || personioConfig.batchSize > 200)
		) {
			errors.push("Batch size must be between 1 and 200");
		}

		if (
			personioConfig.apiTimeoutMs !== undefined &&
			(personioConfig.apiTimeoutMs < 5000 || personioConfig.apiTimeoutMs > 120000)
		) {
			errors.push("API timeout must be between 5000 and 120000 milliseconds");
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
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
					error: "Personio credentials not configured. Please enter your Client ID and API Secret.",
				};
			}

			const personioConfig = { ...DEFAULT_PERSONIO_CONFIG, ...config } as PersonioConfig;
			const client = new PersonioApiClient(credentials, personioConfig.apiTimeoutMs);

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
			"Starting Personio export",
		);

		const personioConfig = { ...DEFAULT_PERSONIO_CONFIG, ...config } as PersonioConfig;
		const credentials = await this.getCredentials(organizationId);

		if (!credentials) {
			throw new Error("Personio credentials not configured");
		}

		const client = new PersonioApiClient(credentials, personioConfig.apiTimeoutMs);

		// Build mapping lookups for absence categories
		const absenceCategoryMappings = new Map<string, WageTypeMapping>();
		for (const mapping of mappings) {
			if (mapping.absenceCategoryId) {
				absenceCategoryMappings.set(mapping.absenceCategoryId, mapping);
			}
		}

		// Transform to Personio requests (with original work period tracking)
		const attendanceData = this.transformWorkPeriods(workPeriods, personioConfig);
		const absenceRequests = this.transformAbsences(
			absences,
			absenceCategoryMappings,
			personioConfig,
		);

		// Track all errors for result
		const errors: ApiExportResult["errors"] = [];
		let apiCallCount = 0;

		// Export attendance records in batches
		const attendanceResults: Array<{ result: PersonioSyncAttemptResult; workPeriod: WorkPeriodData }> = [];
		for (let i = 0; i < attendanceData.length; i += personioConfig.batchSize) {
			const batch = attendanceData.slice(i, i + personioConfig.batchSize);
			const batchRequests = batch.map((item) => item.request);
			const batchResults = await client.createAttendances(batchRequests);

			// Pair each result with its corresponding work period
			batchResults.forEach((result, batchIndex) => {
				attendanceResults.push({
					result,
					workPeriod: batch[batchIndex].workPeriod,
				});
			});
			apiCallCount += batch.length;
		}

		// Map attendance results back to work periods using tracked references
		attendanceResults.forEach(({ result, workPeriod }) => {
			if (!result.success) {
				errors.push({
					recordId: workPeriod.id,
					recordType: "attendance",
					employeeId: workPeriod.employeeId,
					errorMessage: result.error?.message || "Unknown error",
					isRetryable: result.error?.isRetryable ?? true,
				});
			}
		});

		// Export absence records in batches
		const absenceResults: PersonioSyncAttemptResult[] = [];
		const validAbsenceRequests = absenceRequests.filter((r) => r !== null);
		const validAbsenceIndices: number[] = [];
		absenceRequests.forEach((req, idx) => {
			if (req !== null) validAbsenceIndices.push(idx);
		});

		for (let i = 0; i < validAbsenceRequests.length; i += personioConfig.batchSize) {
			const batch = validAbsenceRequests.slice(
				i,
				i + personioConfig.batchSize,
			) as PersonioAbsenceRequest[];
			const batchResults = await client.createAbsences(batch);
			absenceResults.push(...batchResults);
			apiCallCount += batch.length;
		}

		// Map absence results back to absences
		absenceResults.forEach((result, resultIndex) => {
			const originalIndex = validAbsenceIndices[resultIndex];
			if (!result.success && absences[originalIndex]) {
				errors.push({
					recordId: absences[originalIndex].id,
					recordType: "absence",
					employeeId: absences[originalIndex].employeeId,
					errorMessage: result.error?.message || "Unknown error",
					isRetryable: result.error?.isRetryable ?? true,
				});
			}
		});

		// Count skipped absences (those without mappings)
		const skippedAbsences = absenceRequests.filter((r) => r === null).length;

		// Calculate results
		const totalRecords = workPeriods.length + absences.length;
		const syncedAttendances = attendanceResults.filter((r) => r.result.success).length;
		const syncedAbsences = absenceResults.filter((r) => r.success).length;
		const syncedRecords = syncedAttendances + syncedAbsences;
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
			"Personio export completed",
		);

		return result;
	}

	/**
	 * Transform work periods to Personio attendance requests
	 * Returns tuple array to track original work period for each request
	 */
	private transformWorkPeriods(
		workPeriods: WorkPeriodData[],
		config: PersonioConfig,
	): Array<{ request: PersonioAttendanceRequest; workPeriod: WorkPeriodData }> {
		const results: Array<{ request: PersonioAttendanceRequest; workPeriod: WorkPeriodData }> = [];

		for (const period of workPeriods) {
			// Skip incomplete periods
			if (!period.endTime || period.durationMinutes === null) continue;

			// Skip zero-hour periods if configured
			if (!config.includeZeroHours && period.durationMinutes === 0) continue;

			// Get employee identifier based on config
			const employeeIdentifier = this.getEmployeeIdentifier(
				period.employeeNumber,
				null, // Email not available in WorkPeriodData
				config.employeeMatchStrategy,
			);

			if (!employeeIdentifier) {
				logger.warn(
					{ periodId: period.id, employeeId: period.employeeId },
					"Cannot determine employee identifier, skipping",
				);
				continue;
			}

			// Build comment from category and project
			const commentParts: string[] = [];
			if (period.workCategoryName) commentParts.push(period.workCategoryName);
			if (period.projectName) commentParts.push(period.projectName);

			results.push({
				request: {
					employee: employeeIdentifier,
					date: period.startTime.toISODate()!,
					start_time: period.startTime.toFormat("HH:mm"),
					end_time: period.endTime.toFormat("HH:mm"),
					break: 0, // Could be calculated from gaps between periods
					comment: commentParts.length > 0 ? commentParts.join(" - ") : undefined,
				},
				workPeriod: period,
			});
		}

		return results;
	}

	/**
	 * Transform absences to Personio absence requests
	 * Returns null for absences without valid mappings
	 */
	private transformAbsences(
		absences: AbsenceData[],
		mappings: Map<string, WageTypeMapping>,
		config: PersonioConfig,
	): (PersonioAbsenceRequest | null)[] {
		return absences.map((absence) => {
			// Get mapping for this absence category
			const mapping = mappings.get(absence.absenceCategoryId);
			if (!mapping?.wageTypeCode) {
				logger.warn(
					{
						absenceId: absence.id,
						categoryId: absence.absenceCategoryId,
					},
					"No Personio time-off type mapping for absence category, skipping",
				);
				return null;
			}

			// Parse wage type code as Personio time-off type ID
			const timeOffTypeId = parseInt(mapping.wageTypeCode, 10);
			if (isNaN(timeOffTypeId)) {
				logger.warn(
					{
						absenceId: absence.id,
						wageTypeCode: mapping.wageTypeCode,
					},
					"Invalid Personio time-off type ID, skipping",
				);
				return null;
			}

			// Get employee identifier based on config
			const employeeIdentifier = this.getEmployeeIdentifier(
				absence.employeeNumber,
				null, // Email not available in AbsenceData
				config.employeeMatchStrategy,
			);

			if (!employeeIdentifier) {
				logger.warn(
					{ absenceId: absence.id, employeeId: absence.employeeId },
					"Cannot determine employee identifier, skipping",
				);
				return null;
			}

			return {
				employee_id: employeeIdentifier,
				time_off_type_id: timeOffTypeId,
				start_date: absence.startDate,
				end_date: absence.endDate,
				comment: absence.absenceCategoryName || undefined,
			};
		});
	}

	/**
	 * Get employee identifier based on matching strategy
	 */
	private getEmployeeIdentifier(
		employeeNumber: string | null,
		email: string | null,
		strategy: PersonioConfig["employeeMatchStrategy"],
	): string | number | null {
		if (strategy === "employeeNumber") {
			if (!employeeNumber) return null;
			// Try to parse as number for Personio
			const numericId = parseInt(employeeNumber, 10);
			return isNaN(numericId) ? employeeNumber : numericId;
		}

		if (strategy === "email") {
			return email || null;
		}

		return null;
	}

	/**
	 * Get credentials from Vault
	 */
	private async getCredentials(
		organizationId: string,
	): Promise<PersonioCredentials | null> {
		const [clientId, clientSecret] = await Promise.all([
			getOrgSecret(organizationId, VAULT_KEY_CLIENT_ID),
			getOrgSecret(organizationId, VAULT_KEY_CLIENT_SECRET),
		]);

		if (!clientId || !clientSecret) {
			logger.debug({ organizationId }, "Personio credentials not found in Vault");
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
export const personioExporter = new PersonioExporter();
