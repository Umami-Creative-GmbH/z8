/**
 * Personio API Client
 * Handles authentication and API communication with Personio
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type {
	PersonioAbsenceRequest,
	PersonioAttendanceRequest,
	PersonioAuthToken,
	PersonioConfig,
	PersonioCredentials,
	PersonioEmployee,
	PersonioSyncAttemptResult,
} from "./types";

const logger = createLogger("PersonioApiClient");

const PERSONIO_API_BASE = "https://api.personio.de/v1";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry
const DEFAULT_TOKEN_EXPIRY_SECONDS = 24 * 60 * 60;
const DEFAULT_EMPLOYEE_MATCH_STRATEGY: PersonioConfig["employeeMatchStrategy"] =
	"employeeNumber";
// Personio documents 100 as the maximum employee page size.
const EMPLOYEE_PAGE_LIMIT = 100;
const EMPLOYEE_RATE_LIMIT_RETRY_DELAY_MS = 1000;
const EMPLOYEE_EMAIL_ATTRIBUTES = ["id", "email"] as const;
const EMPLOYEE_PERSONNEL_ATTRIBUTES = ["id", "personnel_number"] as const;
const EMPLOYEE_CONNECTION_ATTRIBUTES = [
	"id",
	"email",
	"personnel_number",
] as const;

function getEmployeesEndpoint(options: {
	attributes: readonly string[];
	email?: string;
	limit: number;
	offset: number;
}): string {
	const searchParams = new URLSearchParams({
		limit: String(options.limit),
		offset: String(options.offset),
	});
	if (options.email !== undefined) searchParams.set("email", options.email);
	for (const attribute of options.attributes) {
		searchParams.append("attributes[]", attribute);
	}

	return `/company/employees?${searchParams.toString()}`;
}

function parseResponseBody(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getResponseError(
	value: unknown,
): { message: string; code?: number } | undefined {
	if (!isRecord(value) || value.success !== false || !isRecord(value.error))
		return undefined;
	if (typeof value.error.message !== "string") return undefined;

	return {
		message: value.error.message,
		code: typeof value.error.code === "number" ? value.error.code : undefined,
	};
}

function getResponseData(value: unknown): unknown {
	if (!isRecord(value) || value.success !== true || !("data" in value))
		return undefined;
	return value.data ?? undefined;
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function decodeAttendanceResponse(value: unknown): { id: number } | undefined {
	if (
		!isRecord(value) ||
		!Array.isArray(value.id) ||
		value.id.length === 0 ||
		!value.id.every(isFiniteNumber) ||
		typeof value.message !== "string"
	)
		return undefined;

	return { id: value.id[0] };
}

function decodeTimeOffResponse(value: unknown): { id: number } | undefined {
	if (
		!isRecord(value) ||
		value.type !== "TimeOffPeriod" ||
		!isRecord(value.attributes) ||
		!isFiniteNumber(value.attributes.id)
	)
		return undefined;

	return { id: value.attributes.id };
}

function decodeEmployee(
	value: unknown,
	attributesToDecode: readonly ("email" | "personnel_number")[],
): PersonioEmployee | undefined {
	if (
		!isRecord(value) ||
		value.type !== "Employee" ||
		!isRecord(value.attributes)
	)
		return undefined;

	const { attributes } = value;
	if (!isRecord(attributes.id) || !isFiniteNumber(attributes.id.value))
		return undefined;

	const employee: PersonioEmployee = {
		id: attributes.id.value,
	};

	if (attributesToDecode.includes("email") && attributes.email !== undefined) {
		if (
			!isRecord(attributes.email) ||
			typeof attributes.email.value !== "string"
		)
			return undefined;
		employee.email = attributes.email.value;
	}

	if (
		attributesToDecode.includes("personnel_number") &&
		attributes.personnel_number !== undefined
	) {
		if (
			!isRecord(attributes.personnel_number) ||
			(attributes.personnel_number.value !== null &&
				typeof attributes.personnel_number.value !== "string")
		)
			return undefined;

		if (typeof attributes.personnel_number.value === "string") {
			employee.personnel_number = attributes.personnel_number.value;
		}
	}

	return employee;
}

function decodeEmployeeArray(
	value: unknown,
	attributesToDecode: readonly ("email" | "personnel_number")[],
): PersonioEmployee[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const employees: PersonioEmployee[] = [];
	for (const item of value) {
		const employee = decodeEmployee(item, attributesToDecode);
		if (!employee) return undefined;
		employees.push(employee);
	}

	return employees;
}

function decodeTimeOffTypeArray(
	value: unknown,
): Array<{ id: number; name: string }> | undefined {
	if (!Array.isArray(value)) return undefined;

	const timeOffTypes: Array<{ id: number; name: string }> = [];
	for (const item of value) {
		if (
			!isRecord(item) ||
			item.type !== "TimeOffType" ||
			!isRecord(item.attributes) ||
			!isFiniteNumber(item.attributes.id) ||
			typeof item.attributes.name !== "string"
		)
			return undefined;

		timeOffTypes.push({
			id: item.attributes.id,
			name: item.attributes.name,
		});
	}

	return timeOffTypes;
}

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
	private employeeEmailPromises = new Map<
		string,
		Promise<PersonioEmployee | null>
	>();
	private personnelDirectoryPromise: Promise<PersonioEmployee[]> | null = null;

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

			if (!response.ok) {
				const responseData = parseResponseBody(await response.text());
				const responseError = getResponseError(responseData);
				throw new PersonioApiError(
					`Authentication failed: ${responseError?.message ?? `HTTP ${response.status}`}`,
					response.status,
					isRetryableStatus(response.status),
					responseError?.code,
				);
			}

			const responseData = parseResponseBody(await response.text());
			const responseError = getResponseError(responseData);
			if (responseError) {
				throw new PersonioApiError(
					`Authentication failed: ${responseError.message}`,
					response.status,
					false,
					responseError.code,
				);
			}

			const data = getResponseData(responseData);
			if (
				!isRecord(data) ||
				typeof data.token !== "string" ||
				data.token.trim().length === 0 ||
				(data.expires_in !== undefined &&
					(!isFiniteNumber(data.expires_in) || data.expires_in <= 0))
			) {
				throw new PersonioApiError(
					"Authentication failed: Invalid response",
					response.status,
					false,
				);
			}

			// Personio tokens typically expire in 24 hours
			this.authToken = {
				token: data.token,
				expiresAt: DateTime.now()
					.plus({ seconds: data.expires_in ?? DEFAULT_TOKEN_EXPIRY_SECONDS })
					.toMillis(),
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
			DateTime.now().toMillis() >=
				this.authToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS
		) {
			await this.authenticate();
		}
	}

	private async resolveEmployeeId(
		identifier: number | string,
		strategy: PersonioConfig["employeeMatchStrategy"],
	): Promise<number> {
		if (typeof identifier === "number") {
			if (isFiniteNumber(identifier)) return identifier;
			throw new PersonioApiError(
				"Invalid Personio employee ID",
				undefined,
				false,
			);
		}

		const employee =
			strategy === "email"
				? await this.getEmployeeByEmail(identifier)
				: await this.getEmployeeByPersonnelNumber(identifier);
		if (!employee) {
			throw new PersonioApiError(
				"Personio employee not found",
				undefined,
				false,
			);
		}

		return employee.id;
	}

	private getPersonnelDirectory(): Promise<PersonioEmployee[]> {
		if (this.personnelDirectoryPromise) return this.personnelDirectoryPromise;

		const directoryPromise = this.loadPersonnelDirectory();
		this.personnelDirectoryPromise = directoryPromise;
		void directoryPromise.catch((error) => {
			if (
				!isRateLimitError(error) &&
				this.personnelDirectoryPromise === directoryPromise
			) {
				this.personnelDirectoryPromise = null;
			}
		});

		return directoryPromise;
	}

	private async loadPersonnelDirectory(): Promise<PersonioEmployee[]> {
		const employees: PersonioEmployee[] = [];

		for (let offset = 0; ; offset += EMPLOYEE_PAGE_LIMIT) {
			const { data } = await this.requestEmployeePage(
				getEmployeesEndpoint({
					attributes: EMPLOYEE_PERSONNEL_ATTRIBUTES,
					limit: EMPLOYEE_PAGE_LIMIT,
					offset,
				}),
				(value) => decodeEmployeeArray(value, ["personnel_number"]),
			);
			employees.push(...data);
			if (data.length < EMPLOYEE_PAGE_LIMIT) return employees;
		}
	}

	private async requestEmployeePage(
		endpoint: string,
		decodeData: (value: unknown) => PersonioEmployee[] | undefined,
	): Promise<{ data: PersonioEmployee[]; durationMs: number }> {
		try {
			return await this.request(endpoint, { method: "GET" }, decodeData);
		} catch (error) {
			if (!isRateLimitError(error)) throw error;
		}

		await new Promise((resolve) =>
			setTimeout(resolve, EMPLOYEE_RATE_LIMIT_RETRY_DELAY_MS),
		);
		return this.request(endpoint, { method: "GET" }, decodeData);
	}

	/**
	 * Make authenticated API request
	 */
	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
		decodeData: (value: unknown) => T | undefined,
	): Promise<{ data: T; durationMs: number }> {
		await this.ensureAuthenticated();
		if (!this.authToken) {
			throw new PersonioApiError(
				"Authentication failed: Invalid response",
				undefined,
				false,
			);
		}

		const url = `${PERSONIO_API_BASE}${endpoint}`;
		const startTime = Date.now();

		try {
			const headers = new Headers(options.headers);
			headers.set("Authorization", `Bearer ${this.authToken.token}`);
			if (!headers.has("Content-Type"))
				headers.set("Content-Type", "application/json");
			if (!headers.has("Accept")) headers.set("Accept", "application/json");

			const response = await fetch(url, {
				...options,
				headers,
				signal: AbortSignal.timeout(this.timeoutMs),
			});

			const durationMs = Date.now() - startTime;

			if (!response.ok) {
				const responseData = parseResponseBody(await response.text());
				// Determine if retryable based on status code
				const isRetryable = isRetryableStatus(response.status);

				const responseError = getResponseError(responseData);

				throw new PersonioApiError(
					responseError?.message ?? `HTTP ${response.status}`,
					response.status,
					isRetryable,
					responseError?.code,
				);
			}

			const responseData = parseResponseBody(await response.text());
			const responseError = getResponseError(responseData);
			if (responseError) {
				throw new PersonioApiError(
					responseError.message,
					response.status,
					false,
					responseError.code,
				);
			}

			const data = getResponseData(responseData);
			const decodedData = data === undefined ? undefined : decodeData(data);
			if (decodedData === undefined) {
				throw new PersonioApiError(
					"Invalid Personio API response",
					response.status,
					false,
				);
			}

			return { data: decodedData, durationMs };
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
			await this.request<PersonioEmployee[]>(
				getEmployeesEndpoint({
					attributes: EMPLOYEE_CONNECTION_ATTRIBUTES,
					limit: 1,
					offset: 0,
				}),
				{ method: "GET" },
				(value) => decodeEmployeeArray(value, ["email", "personnel_number"]),
			);

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
		const normalizedEmail = email.trim().toLowerCase();
		const cachedPromise = this.employeeEmailPromises.get(normalizedEmail);
		if (cachedPromise) return cachedPromise;

		const lookupPromise = this.loadEmployeeByEmail(normalizedEmail);
		this.employeeEmailPromises.set(normalizedEmail, lookupPromise);
		void lookupPromise.catch((error) => {
			if (
				!isRateLimitError(error) &&
				this.employeeEmailPromises.get(normalizedEmail) === lookupPromise
			) {
				this.employeeEmailPromises.delete(normalizedEmail);
			}
		});

		return lookupPromise;
	}

	private async loadEmployeeByEmail(
		normalizedEmail: string,
	): Promise<PersonioEmployee | null> {
		const { data } = await this.requestEmployeePage(
			getEmployeesEndpoint({
				attributes: EMPLOYEE_EMAIL_ATTRIBUTES,
				email: normalizedEmail,
				limit: 1,
				offset: 0,
			}),
			(value) => decodeEmployeeArray(value, ["email"]),
		);

		return (
			data.find(
				(employee) => employee.email?.trim().toLowerCase() === normalizedEmail,
			) ?? null
		);
	}

	/**
	 * Get employee by personnel number
	 */
	async getEmployeeByPersonnelNumber(
		personnelNumber: string,
	): Promise<PersonioEmployee | null> {
		const employees = await this.getPersonnelDirectory();
		return (
			employees.find(
				(employee) => employee.personnel_number === personnelNumber,
			) ?? null
		);
	}

	/**
	 * Create a single attendance record
	 */
	async createAttendance(
		attendance: PersonioAttendanceRequest,
		strategy: PersonioConfig["employeeMatchStrategy"] = DEFAULT_EMPLOYEE_MATCH_STRATEGY,
	): Promise<PersonioSyncAttemptResult> {
		try {
			const employeeId = await this.resolveEmployeeId(
				attendance.employee,
				strategy,
			);
			const { data } = await this.request<{ id: number }>(
				"/company/attendances",
				{
					method: "POST",
					body: JSON.stringify({
						attendances: [{ ...attendance, employee: employeeId }],
					}),
				},
				decodeAttendanceResponse,
			);

			return {
				success: true,
				externalId: data.id,
			};
		} catch (error) {
			const errorMessage =
				error instanceof PersonioApiError ? error.message : "Unknown error";
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
					code:
						error instanceof PersonioApiError ? error.statusCode : undefined,
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
		strategy: PersonioConfig["employeeMatchStrategy"] = DEFAULT_EMPLOYEE_MATCH_STRATEGY,
	): Promise<PersonioSyncAttemptResult[]> {
		logger.info({ count: attendances.length }, "Creating attendance periods");

		const results: PersonioSyncAttemptResult[] = [];

		for (const attendance of attendances) {
			const result = await this.createAttendance(attendance, strategy);
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
		strategy: PersonioConfig["employeeMatchStrategy"] = DEFAULT_EMPLOYEE_MATCH_STRATEGY,
	): Promise<PersonioSyncAttemptResult> {
		try {
			const employeeId = await this.resolveEmployeeId(
				absence.employee_id,
				strategy,
			);
			const body = new URLSearchParams({
				employee_id: String(employeeId),
				time_off_type_id: String(absence.time_off_type_id),
				start_date: absence.start_date,
				end_date: absence.end_date,
				half_day_start: absence.half_day_start ? "1" : "0",
				half_day_end: absence.half_day_end ? "1" : "0",
			});
			if (absence.comment !== undefined) body.set("comment", absence.comment);

			const { data } = await this.request<{ id: number }>(
				"/company/time-offs",
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: body.toString(),
				},
				decodeTimeOffResponse,
			);

			return {
				success: true,
				externalId: data.id,
			};
		} catch (error) {
			const errorMessage =
				error instanceof PersonioApiError ? error.message : "Unknown error";
			const isRetryable =
				error instanceof PersonioApiError ? error.isRetryable : true;

			logger.warn(
				{
					startDate: absence.start_date,
					endDate: absence.end_date,
					error: errorMessage,
				},
				"Failed to create absence",
			);

			return {
				success: false,
				error: {
					message: errorMessage,
					code:
						error instanceof PersonioApiError ? error.statusCode : undefined,
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
		strategy: PersonioConfig["employeeMatchStrategy"] = DEFAULT_EMPLOYEE_MATCH_STRATEGY,
	): Promise<PersonioSyncAttemptResult[]> {
		logger.info({ count: absences.length }, "Creating absence periods");

		const results: PersonioSyncAttemptResult[] = [];

		for (const absence of absences) {
			const result = await this.createAbsence(absence, strategy);
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
				decodeTimeOffTypeArray,
			);
			return data || [];
		} catch (error) {
			logger.warn({ error }, "Failed to get time-off types");
			return [];
		}
	}
}

function isRateLimitError(error: unknown): error is PersonioApiError {
	return error instanceof PersonioApiError && error.statusCode === 429;
}
