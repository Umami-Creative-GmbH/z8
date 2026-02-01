/**
 * Personio API Client
 * Handles authentication and API communication with Personio
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type {
	PersonioCredentials,
	PersonioAuthToken,
	PersonioAttendanceRequest,
	PersonioAbsenceRequest,
	PersonioApiResponse,
	PersonioEmployee,
	PersonioSyncAttemptResult,
} from "./types";

const logger = createLogger("PersonioApiClient");

const PERSONIO_API_BASE = "https://api.personio.de/v1";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

/**
 * Custom error class for Personio API errors
 */
export class PersonioApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode?: number,
		public readonly isRetryable: boolean = false,
		public readonly errorCode?: number,
	) {
		super(message);
		this.name = "PersonioApiError";
	}
}

/**
 * Personio API Client
 * Implements authentication, request handling, and error management
 */
export class PersonioApiClient {
	private authToken: PersonioAuthToken | null = null;

	constructor(
		private credentials: PersonioCredentials,
		private timeoutMs: number = 30000,
	) {}

	/**
	 * Authenticate with Personio API using client credentials
	 */
	private async authenticate(): Promise<void> {
		logger.info("Authenticating with Personio API");

		try {
			const response = await fetch(`${PERSONIO_API_BASE}/auth`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					client_id: this.credentials.clientId,
					client_secret: this.credentials.clientSecret,
				}),
				signal: AbortSignal.timeout(this.timeoutMs),
			});

			const responseData = (await response.json()) as PersonioApiResponse<{ token: string }>;

			if (!response.ok || !responseData.success) {
				const errorMsg =
					"error" in responseData
						? responseData.error.message
						: `HTTP ${response.status}`;
				throw new PersonioApiError(
					`Authentication failed: ${errorMsg}`,
					response.status,
					false, // Auth errors are not retryable
				);
			}

			// Personio tokens typically expire in 24 hours
			this.authToken = {
				token: responseData.data.token,
				expiresAt: DateTime.now().plus({ hours: 23 }).toMillis(),
			};

			logger.info("Successfully authenticated with Personio API");
		} catch (error) {
			if (error instanceof PersonioApiError) throw error;

			logger.error({ error }, "Failed to authenticate with Personio");
			throw new PersonioApiError(
				`Authentication error: ${error instanceof Error ? error.message : "Unknown"}`,
				undefined,
				error instanceof Error && error.name === "TimeoutError",
			);
		}
	}

	/**
	 * Ensure valid authentication token exists
	 */
	private async ensureAuthenticated(): Promise<void> {
		if (
			!this.authToken ||
			DateTime.now().toMillis() >= this.authToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS
		) {
			await this.authenticate();
		}
	}

	/**
	 * Make authenticated API request
	 */
	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<{ data: T; durationMs: number }> {
		await this.ensureAuthenticated();

		const url = `${PERSONIO_API_BASE}${endpoint}`;
		const startTime = Date.now();

		try {
			const response = await fetch(url, {
				...options,
				headers: {
					...options.headers,
					Authorization: `Bearer ${this.authToken!.token}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				signal: AbortSignal.timeout(this.timeoutMs),
			});

			const durationMs = Date.now() - startTime;
			const responseData = (await response.json()) as PersonioApiResponse<T>;

			if (!response.ok || !responseData.success) {
				// Determine if retryable based on status code
				const isRetryable =
					response.status >= 500 || // Server errors
					response.status === 429 || // Rate limit
					response.status === 408; // Timeout

				const errorMsg =
					"error" in responseData
						? responseData.error.message
						: `HTTP ${response.status}`;
				const errorCode =
					"error" in responseData ? responseData.error.code : undefined;

				throw new PersonioApiError(errorMsg, response.status, isRetryable, errorCode);
			}

			return { data: responseData.data, durationMs };
		} catch (error) {
			if (error instanceof PersonioApiError) throw error;

			// Network/timeout errors are retryable
			throw new PersonioApiError(
				`API request failed: ${error instanceof Error ? error.message : "Unknown"}`,
				undefined,
				true,
			);
		}
	}

	/**
	 * Test connection and credentials
	 */
	async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			await this.authenticate();

			// Try a simple API call to verify access
			await this.request<PersonioEmployee[]>("/company/employees?limit=1", {
				method: "GET",
			});

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
	 * Get employee by email
	 */
	async getEmployeeByEmail(email: string): Promise<PersonioEmployee | null> {
		try {
			const { data } = await this.request<PersonioEmployee[]>(
				`/company/employees?email=${encodeURIComponent(email)}`,
				{ method: "GET" },
			);

			if (!data || data.length === 0) return null;
			return data[0];
		} catch (error) {
			logger.warn({ error }, "Failed to get employee by email");
			return null;
		}
	}

	/**
	 * Get employee by personnel number
	 */
	async getEmployeeByPersonnelNumber(
		personnelNumber: string,
	): Promise<PersonioEmployee | null> {
		try {
			// Personio API may not support direct filter by personnel_number
			// We may need to fetch all and filter client-side for now
			const { data } = await this.request<PersonioEmployee[]>("/company/employees", {
				method: "GET",
			});

			if (!data) return null;
			return (
				data.find(
					(emp) =>
						emp.personnel_number === personnelNumber,
				) || null
			);
		} catch (error) {
			logger.warn({ error }, "Failed to get employee by personnel number");
			return null;
		}
	}

	/**
	 * Create a single attendance record
	 */
	async createAttendance(
		attendance: PersonioAttendanceRequest,
	): Promise<PersonioSyncAttemptResult> {
		try {
			const { data } = await this.request<{ id: number }>(
				"/company/attendances",
				{
					method: "POST",
					body: JSON.stringify(attendance),
				},
			);

			return {
				success: true,
				externalId: data.id,
			};
		} catch (error) {
			const errorMessage =
				error instanceof PersonioApiError
					? error.message
					: "Unknown error";
			const isRetryable =
				error instanceof PersonioApiError ? error.isRetryable : true;

			logger.warn(
				{ date: attendance.date, error: errorMessage },
				"Failed to create attendance",
			);

			return {
				success: false,
				error: {
					message: errorMessage,
					code: error instanceof PersonioApiError ? error.statusCode : undefined,
					isRetryable,
				},
			};
		}
	}

	/**
	 * Create attendance records in batch
	 * Processes sequentially as Personio may not have true batch support
	 */
	async createAttendances(
		attendances: PersonioAttendanceRequest[],
	): Promise<PersonioSyncAttemptResult[]> {
		logger.info({ count: attendances.length }, "Creating attendance periods");

		const results: PersonioSyncAttemptResult[] = [];

		for (const attendance of attendances) {
			const result = await this.createAttendance(attendance);
			results.push(result);

			// Small delay between requests to avoid rate limiting
			if (attendances.length > 10) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}

		const successCount = results.filter((r) => r.success).length;
		logger.info(
			{ total: attendances.length, success: successCount },
			"Attendance creation completed",
		);

		return results;
	}

	/**
	 * Create a single absence record
	 */
	async createAbsence(
		absence: PersonioAbsenceRequest,
	): Promise<PersonioSyncAttemptResult> {
		try {
			const { data } = await this.request<{ id: number }>(
				"/company/time-offs",
				{
					method: "POST",
					body: JSON.stringify(absence),
				},
			);

			return {
				success: true,
				externalId: data.id,
			};
		} catch (error) {
			const errorMessage =
				error instanceof PersonioApiError
					? error.message
					: "Unknown error";
			const isRetryable =
				error instanceof PersonioApiError ? error.isRetryable : true;

			logger.warn(
				{ startDate: absence.start_date, endDate: absence.end_date, error: errorMessage },
				"Failed to create absence",
			);

			return {
				success: false,
				error: {
					message: errorMessage,
					code: error instanceof PersonioApiError ? error.statusCode : undefined,
					isRetryable,
				},
			};
		}
	}

	/**
	 * Create absence records in batch
	 */
	async createAbsences(
		absences: PersonioAbsenceRequest[],
	): Promise<PersonioSyncAttemptResult[]> {
		logger.info({ count: absences.length }, "Creating absence periods");

		const results: PersonioSyncAttemptResult[] = [];

		for (const absence of absences) {
			const result = await this.createAbsence(absence);
			results.push(result);

			// Small delay between requests to avoid rate limiting
			if (absences.length > 10) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}

		const successCount = results.filter((r) => r.success).length;
		logger.info(
			{ total: absences.length, success: successCount },
			"Absence creation completed",
		);

		return results;
	}

	/**
	 * Get available time-off types
	 */
	async getTimeOffTypes(): Promise<Array<{ id: number; name: string }>> {
		try {
			const { data } = await this.request<Array<{ id: number; name: string }>>(
				"/company/time-off-types",
				{ method: "GET" },
			);
			return data || [];
		} catch (error) {
			logger.warn({ error }, "Failed to get time-off types");
			return [];
		}
	}
}
