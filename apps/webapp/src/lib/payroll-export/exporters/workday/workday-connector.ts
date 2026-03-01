import { DateTime } from "luxon";
import type {
	AbsenceData,
	ApiExportResult,
	IPayrollExporter,
	WageTypeMapping,
	WorkPeriodData,
} from "../../types";
import { WorkdayApiClient } from "./api-client";
import {
	DEFAULT_WORKDAY_CONFIG,
	type WorkdayConfig,
	type WorkdayOAuthCredentials,
} from "./types";

const SYNC_THRESHOLD = 500;
const WORKDAY_VAULT_KEY_CLIENT_ID = "payroll/workday/client_id";
const WORKDAY_VAULT_KEY_CLIENT_SECRET = "payroll/workday/client_secret";
const WORKDAY_VAULT_KEY_SCOPE = "payroll/workday/scope";

interface WorkdayConnectorDeps {
	getCredentials?: (organizationId: string) => Promise<WorkdayOAuthCredentials | null>;
	createApiClient?: (config: WorkdayConfig) => {
		getOAuthToken: (credentials: WorkdayOAuthCredentials) => Promise<{ accessToken: string }>;
		testConnection: (accessToken?: string) => Promise<{ success: boolean; error?: string }>;
	};
}

export class WorkdayConnector implements IPayrollExporter {
	readonly exporterId = "workday_api";
	readonly exporterName = "Workday";
	readonly version = "1.0.0";

	private readonly createApiClient: NonNullable<WorkdayConnectorDeps["createApiClient"]>;
	private readonly getCredentials: NonNullable<WorkdayConnectorDeps["getCredentials"]>;

	constructor(deps: WorkdayConnectorDeps = {}) {
		this.getCredentials = deps.getCredentials ?? this.getCredentialsFromVault;
		this.createApiClient =
			deps.createApiClient ??
			((config) =>
				new WorkdayApiClient({
					instanceUrl: config.instanceUrl,
					tenantId: config.tenantId,
					timeoutMs: config.apiTimeoutMs,
				}));
	}

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	async validateConfig(config: Record<string, unknown>): Promise<{
		valid: boolean;
		errors?: string[];
	}> {
		const { errors } = this.parseConfig(config);

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
		const { config: workdayConfig, errors } = this.parseConfig(config);
		if (errors.length > 0 || !workdayConfig) {
			return {
				success: false,
				error: errors.join(", ") || "Invalid Workday configuration",
			};
		}

		try {
			const credentials = await this.getCredentials(organizationId);
			if (!credentials) {
				return {
					success: false,
					error:
						"Workday credentials not configured. Please enter your Client ID and Client Secret.",
				};
			}

			const client = this.createApiClient(workdayConfig);
			const token = await client.getOAuthToken(credentials);
			return await client.testConnection(token.accessToken);
		} catch (error) {
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
		_mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): Promise<ApiExportResult> {
		const startedAt = Date.now();
		const connectionResult = await this.testConnection(organizationId, config);

		if (!connectionResult.success) {
			throw new Error(connectionResult.error ?? "Workday connection test failed");
		}

		const dateRange = this.getDateRange(workPeriods, absences);
		const employeeCount = new Set([
			...workPeriods.map((period) => period.employeeId),
			...absences.map((absence) => absence.employeeId),
		]).size;
		const totalRecords = workPeriods.length + absences.length;
		const errorMessage =
			"Workday export placeholder is not implemented; record was not synced.";
		const errors: ApiExportResult["errors"] = [
			...workPeriods.map((period) => ({
				recordId: period.id,
				recordType: "attendance" as const,
				employeeId: period.employeeId,
				errorMessage,
				isRetryable: false,
			})),
			...absences.map((absence) => ({
				recordId: absence.id,
				recordType: "absence" as const,
				employeeId: absence.employeeId,
				errorMessage,
				isRetryable: false,
			})),
		];

		return {
			success: false,
			totalRecords,
			syncedRecords: 0,
			failedRecords: totalRecords,
			skippedRecords: 0,
			errors,
			metadata: {
				employeeCount,
				dateRange,
				apiCallCount: 0,
				durationMs: Date.now() - startedAt,
			},
		};
	}

	private parseConfig(rawConfig: Record<string, unknown>): {
		config?: WorkdayConfig;
		errors: string[];
	} {
		const config = { ...DEFAULT_WORKDAY_CONFIG };
		const errors: string[] = [];

		const instanceUrl = rawConfig.instanceUrl;
		if (instanceUrl === undefined) {
			errors.push("instanceUrl is required");
		} else if (typeof instanceUrl !== "string") {
			errors.push("instanceUrl must be a string");
		} else if (!instanceUrl.trim()) {
			errors.push("instanceUrl is required");
		} else {
			config.instanceUrl = instanceUrl;
		}

		const tenantId = rawConfig.tenantId;
		if (tenantId === undefined) {
			errors.push("tenantId is required");
		} else if (typeof tenantId !== "string") {
			errors.push("tenantId must be a string");
		} else if (!tenantId.trim()) {
			errors.push("tenantId is required");
		} else {
			config.tenantId = tenantId;
		}

		const employeeMatchStrategy = rawConfig.employeeMatchStrategy;
		if (employeeMatchStrategy !== undefined) {
			if (typeof employeeMatchStrategy !== "string") {
				errors.push("employeeMatchStrategy must be 'employeeNumber' or 'email'");
			} else if (!this.isValidEmployeeMatchStrategy(employeeMatchStrategy)) {
				errors.push("employeeMatchStrategy must be 'employeeNumber' or 'email'");
			} else {
				config.employeeMatchStrategy = employeeMatchStrategy;
			}
		}

		const includeZeroHours = rawConfig.includeZeroHours;
		if (includeZeroHours !== undefined) {
			if (typeof includeZeroHours !== "boolean") {
				errors.push("includeZeroHours must be a boolean");
			} else {
				config.includeZeroHours = includeZeroHours;
			}
		}

		const batchSize = rawConfig.batchSize;
		if (batchSize !== undefined) {
			if (typeof batchSize !== "number" || !Number.isFinite(batchSize)) {
				errors.push("batchSize must be a number");
			} else if (batchSize < 1 || batchSize > 500) {
				errors.push("batchSize must be between 1 and 500");
			} else {
				config.batchSize = batchSize;
			}
		}

		const apiTimeoutMs = rawConfig.apiTimeoutMs;
		if (apiTimeoutMs !== undefined) {
			if (typeof apiTimeoutMs !== "number" || !Number.isFinite(apiTimeoutMs)) {
				errors.push("apiTimeoutMs must be a number");
			} else if (apiTimeoutMs < 1000 || apiTimeoutMs > 120000) {
				errors.push("apiTimeoutMs must be between 1000 and 120000");
			} else {
				config.apiTimeoutMs = apiTimeoutMs;
			}
		}

		return {
			config: errors.length === 0 ? config : undefined,
			errors,
		};
	}

	private async getCredentialsFromVault(
		organizationId: string,
	): Promise<WorkdayOAuthCredentials | null> {
		const { getOrgSecret } = await import("@/lib/vault/secrets");
		const [clientId, clientSecret, scope] = await Promise.all([
			getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID),
			getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET),
			getOrgSecret(organizationId, WORKDAY_VAULT_KEY_SCOPE),
		]);

		if (!clientId || !clientSecret) {
			return null;
		}

		return {
			clientId,
			clientSecret,
			scope: scope || undefined,
		};
	}

	private isValidEmployeeMatchStrategy(
		strategy: string,
	): strategy is WorkdayConfig["employeeMatchStrategy"] {
		return strategy === "employeeNumber" || strategy === "email";
	}

	private getDateRange(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
	): { start: string; end: string } {
		let start: DateTime | null = null;
		let end: DateTime | null = null;

		for (const period of workPeriods) {
			if (!start || period.startTime < start) {
				start = period.startTime;
			}

			const periodEnd = period.endTime ?? period.startTime;
			if (!end || periodEnd > end) {
				end = periodEnd;
			}
		}

		for (const absence of absences) {
			const absenceStart = DateTime.fromISO(absence.startDate);
			const absenceEnd = DateTime.fromISO(absence.endDate);

			if (!start || absenceStart < start) {
				start = absenceStart;
			}

			if (!end || absenceEnd > end) {
				end = absenceEnd;
			}
		}

		return {
			start: start?.toISODate() ?? "",
			end: end?.toISODate() ?? "",
		};
	}
}

export const workdayConnector = new WorkdayConnector();
