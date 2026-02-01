/**
 * SAP SuccessFactors OData API Client
 * Handles authentication, batch operations, and error handling
 */
import { createLogger } from "@/lib/logger";
import type {
	SuccessFactorsCredentials,
	SuccessFactorsAuthToken,
	SFTimeRecordRequest,
	SFAbsenceRequest,
	SFSyncAttemptResult,
	SFODataErrorResponse,
	SFEmployee,
} from "./types";
import {
	RETRYABLE_STATUS_CODES,
	MAX_RETRY_ATTEMPTS,
	RETRY_BASE_DELAY_MS,
} from "./types";

const logger = createLogger("SFApiClient");

/**
 * SAP SuccessFactors OData API Client
 */
export class SuccessFactorsApiClient {
	private credentials: SuccessFactorsCredentials;
	private instanceUrl: string;
	private companyId: string;
	private timeoutMs: number;
	private authToken: SuccessFactorsAuthToken | null = null;

	constructor(
		credentials: SuccessFactorsCredentials,
		instanceUrl: string,
		companyId: string,
		timeoutMs = 60000,
	) {
		this.credentials = credentials;
		this.instanceUrl = instanceUrl.replace(/\/$/, ""); // Remove trailing slash
		this.companyId = companyId;
		this.timeoutMs = timeoutMs;
	}

	/**
	 * Test connection to SAP SuccessFactors
	 */
	async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			await this.authenticate();

			// Try to fetch company info to verify access
			const response = await this.makeRequest("GET", "/User?$top=1&$select=userId");

			if (!response.ok) {
				const errorData = (await response.json()) as SFODataErrorResponse;
				return {
					success: false,
					error: errorData.error?.message?.value || `HTTP ${response.status}`,
				};
			}

			return { success: true };
		} catch (error) {
			logger.error({ error }, "Connection test failed");
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Authenticate with SAP SuccessFactors using OAuth2 client credentials
	 */
	async authenticate(): Promise<void> {
		// Check if we have a valid token
		if (this.authToken && Date.now() < this.authToken.expiresAt - 60000) {
			return; // Token still valid (with 1 minute buffer)
		}

		logger.debug("Authenticating with SAP SuccessFactors");

		const tokenUrl = `${this.instanceUrl}/oauth/token`;
		const params = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: this.credentials.clientId,
			client_secret: this.credentials.clientSecret,
			company_id: this.companyId,
		});

		const response = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params.toString(),
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(
				{ status: response.status, error: errorText },
				"OAuth authentication failed",
			);
			throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
		}

		const tokenData = (await response.json()) as {
			access_token: string;
			token_type: string;
			expires_in: number;
		};

		this.authToken = {
			accessToken: tokenData.access_token,
			tokenType: tokenData.token_type,
			expiresAt: Date.now() + tokenData.expires_in * 1000,
		};

		logger.debug("Successfully authenticated with SAP SuccessFactors");
	}

	/**
	 * Create time records in batch
	 */
	async createTimeRecords(
		records: SFTimeRecordRequest[],
	): Promise<SFSyncAttemptResult[]> {
		if (records.length === 0) {
			return [];
		}

		await this.authenticate();

		const results: SFSyncAttemptResult[] = [];

		// Process records individually (SAP SF doesn't have great batch support for time entries)
		for (const record of records) {
			const result = await this.createSingleTimeRecord(record);
			results.push(result);
		}

		return results;
	}

	/**
	 * Create a single time record with retry logic
	 */
	private async createSingleTimeRecord(
		record: SFTimeRecordRequest,
	): Promise<SFSyncAttemptResult> {
		const endpoint = "/EmployeeTime";

		// Parse time components for proper ISO 8601 duration format
		const [startHours, startMinutes] = record.startTime.split(":");
		const [endHours, endMinutes] = record.endTime.split(":");

		// Build OData payload with ISO 8601 date format (YYYY-MM-DD)
		const payload = {
			userId: record.userId,
			startDate: record.startDate, // Use ISO date string directly
			endDate: record.endDate,
			startTime: `PT${startHours}H${startMinutes || "0"}M0S`,
			endTime: `PT${endHours}H${endMinutes || "0"}M0S`,
			quantityInHours: record.quantityInHours.toString(),
			timeType: record.timeType,
			comment: record.comment || "",
			externalCode: record.externalCode || "",
		};

		return this.executeWithRetry(async () => {
			const response = await this.makeRequest("POST", endpoint, payload);

			if (response.ok) {
				let data: unknown;
				try {
					data = await response.json();
				} catch {
					data = null;
				}
				return {
					success: true,
					externalId: (data as { d?: { externalCode?: string } })?.d?.externalCode || record.externalCode,
				};
			}

			// Check if this is a retryable error and throw to trigger retry
			const isRetryable = RETRYABLE_STATUS_CODES.includes(response.status);

			let errorMessage = `HTTP ${response.status}`;
			let errorCode: string | undefined;

			try {
				const errorData = (await response.json()) as SFODataErrorResponse;
				errorMessage = errorData.error?.message?.value || errorMessage;
				errorCode = errorData.error?.code;
			} catch {
				// If JSON parsing fails, use default error message
			}

			// Throw for retryable errors so executeWithRetry can retry
			if (isRetryable) {
				const error = new Error(errorMessage);
				(error as Error & { isRetryable: boolean }).isRetryable = true;
				throw error;
			}

			return {
				success: false,
				error: {
					message: errorMessage,
					code: errorCode,
					isRetryable: false,
				},
			};
		});
	}

	/**
	 * Create absence/time-off records in batch
	 */
	async createAbsences(
		absences: SFAbsenceRequest[],
	): Promise<SFSyncAttemptResult[]> {
		if (absences.length === 0) {
			return [];
		}

		await this.authenticate();

		const results: SFSyncAttemptResult[] = [];

		for (const absence of absences) {
			const result = await this.createSingleAbsence(absence);
			results.push(result);
		}

		return results;
	}

	/**
	 * Create a single absence record with retry logic
	 */
	private async createSingleAbsence(
		absence: SFAbsenceRequest,
	): Promise<SFSyncAttemptResult> {
		const endpoint = "/EmployeeTimeOff";

		// Build OData payload with ISO 8601 date format
		const payload = {
			userId: absence.userId,
			timeType: absence.timeType,
			startDate: absence.startDate, // Use ISO date string directly
			endDate: absence.endDate,
			quantityInDays: absence.quantityInDays.toString(),
			comment: absence.comment || "",
			externalCode: absence.externalCode || "",
		};

		return this.executeWithRetry(async () => {
			const response = await this.makeRequest("POST", endpoint, payload);

			if (response.ok) {
				let data: unknown;
				try {
					data = await response.json();
				} catch {
					data = null;
				}
				return {
					success: true,
					externalId: (data as { d?: { externalCode?: string } })?.d?.externalCode || absence.externalCode,
				};
			}

			// Check if this is a retryable error and throw to trigger retry
			const isRetryable = RETRYABLE_STATUS_CODES.includes(response.status);

			let errorMessage = `HTTP ${response.status}`;
			let errorCode: string | undefined;

			try {
				const errorData = (await response.json()) as SFODataErrorResponse;
				errorMessage = errorData.error?.message?.value || errorMessage;
				errorCode = errorData.error?.code;
			} catch {
				// If JSON parsing fails, use default error message
			}

			// Throw for retryable errors so executeWithRetry can retry
			if (isRetryable) {
				const error = new Error(errorMessage);
				(error as Error & { isRetryable: boolean }).isRetryable = true;
				throw error;
			}

			return {
				success: false,
				error: {
					message: errorMessage,
					code: errorCode,
					isRetryable: false,
				},
			};
		});
	}

	/**
	 * Get employee by user ID
	 */
	async getEmployeeByUserId(userId: string): Promise<SFEmployee | null> {
		await this.authenticate();

		const endpoint = `/User('${encodeURIComponent(userId)}')?$select=userId,personIdExternal,email,firstName,lastName`;

		try {
			const response = await this.makeRequest("GET", endpoint);

			if (!response.ok) {
				if (response.status === 404) {
					return null;
				}
				throw new Error(`Failed to get employee: HTTP ${response.status}`);
			}

			const data = await response.json();
			return {
				userId: data.d.userId,
				personIdExternal: data.d.personIdExternal,
				email: data.d.email,
				firstName: data.d.firstName,
				lastName: data.d.lastName,
			};
		} catch (error) {
			logger.error({ error, userId }, "Failed to get employee by userId");
			return null;
		}
	}

	/**
	 * Make an authenticated request to SAP SuccessFactors OData API
	 */
	private async makeRequest(
		method: string,
		endpoint: string,
		body?: unknown,
	): Promise<Response> {
		if (!this.authToken) {
			throw new Error("Not authenticated");
		}

		const url = `${this.instanceUrl}/odata/v2${endpoint}`;

		const headers: HeadersInit = {
			Authorization: `${this.authToken.tokenType} ${this.authToken.accessToken}`,
			Accept: "application/json",
		};

		if (body) {
			headers["Content-Type"] = "application/json";
		}

		return fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
	}

	/**
	 * Execute a function with retry logic and exponential backoff
	 */
	private async executeWithRetry<T>(
		fn: () => Promise<T>,
		attempt = 1,
	): Promise<T> {
		try {
			return await fn();
		} catch (error) {
			if (attempt >= MAX_RETRY_ATTEMPTS) {
				throw error;
			}

			// Check if error is retryable
			const isRetryable =
				error instanceof Error &&
				(error.name === "AbortError" ||
					error.message.includes("network") ||
					error.message.includes("timeout"));

			if (!isRetryable) {
				throw error;
			}

			// Exponential backoff
			const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
			logger.warn(
				{ attempt, delay, error: error instanceof Error ? error.message : "Unknown" },
				`Retrying after error`,
			);

			await new Promise((resolve) => setTimeout(resolve, delay));
			return this.executeWithRetry(fn, attempt + 1);
		}
	}
}
