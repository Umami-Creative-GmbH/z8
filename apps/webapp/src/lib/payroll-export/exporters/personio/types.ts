/**
 * Personio-specific types and configurations
 */

/**
 * Personio API configuration
 * Secrets (clientId, clientSecret) stored in Vault separately
 */
export interface PersonioConfig {
	/** Employee matching strategy */
	employeeMatchStrategy: "employeeNumber" | "email";
	/** Whether to include zero-hour records */
	includeZeroHours: boolean;
	/** Batch size for API requests (max 200 per Personio docs) */
	batchSize: number;
	/** Timeout for API requests in milliseconds */
	apiTimeoutMs: number;
}

/**
 * Default Personio configuration
 */
export const DEFAULT_PERSONIO_CONFIG: PersonioConfig = {
	employeeMatchStrategy: "employeeNumber",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 30000,
};

/**
 * Personio API credentials (stored in Vault)
 */
export interface PersonioCredentials {
	clientId: string;
	clientSecret: string;
}

/**
 * Personio API authentication token
 */
export interface PersonioAuthToken {
	token: string;
	expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * Personio attendance period request
 * Based on Personio API v1 specification
 */
export interface PersonioAttendanceRequest {
	/** Employee ID in Personio (numeric) or email */
	employee: number | string;
	/** Date in YYYY-MM-DD format */
	date: string;
	/** Start time in HH:MM format */
	start_time: string;
	/** End time in HH:MM format */
	end_time: string;
	/** Break duration in minutes */
	break: number;
	/** Optional comment */
	comment?: string;
}

/**
 * Personio absence period request
 * Based on Personio API v1 specification
 */
export interface PersonioAbsenceRequest {
	/** Employee ID in Personio (numeric) or email */
	employee_id: number | string;
	/** Time-off type ID in Personio */
	time_off_type_id: number;
	/** Start date in YYYY-MM-DD format */
	start_date: string;
	/** End date in YYYY-MM-DD format */
	end_date: string;
	/** Whether start date is a half day */
	half_day_start?: boolean;
	/** Whether end date is a half day */
	half_day_end?: boolean;
	/** Optional comment */
	comment?: string;
}

/**
 * Personio API success response
 */
export interface PersonioSuccessResponse<T = unknown> {
	success: true;
	data: T;
}

/**
 * Personio API error response
 */
export interface PersonioErrorResponse {
	success: false;
	error: {
		code: number;
		message: string;
		error_data?: Record<string, unknown>;
	};
}

/**
 * Union type for Personio API response
 */
export type PersonioApiResponse<T = unknown> =
	| PersonioSuccessResponse<T>
	| PersonioErrorResponse;

/**
 * Personio employee data from API
 */
export interface PersonioEmployee {
	id: number;
	email: string;
	first_name: string;
	last_name: string;
	personnel_number?: string;
}

/**
 * Personio time-off type data
 */
export interface PersonioTimeOffType {
	id: number;
	name: string;
	category: string;
}

/**
 * Result of a single record sync attempt
 */
export interface PersonioSyncAttemptResult {
	success: boolean;
	externalId?: number;
	error?: {
		message: string;
		code?: number;
		isRetryable: boolean;
	};
}
