/**
 * SAP SuccessFactors specific types and configurations
 */

/**
 * SAP SuccessFactors configuration
 * Secrets (clientId, clientSecret) stored in Vault separately
 */
export interface SuccessFactorsConfig {
	/** Employee matching strategy for mapping local employees to SAP SuccessFactors */
	employeeMatchStrategy: SuccessFactorsEmployeeMatchStrategy;
	/** SAP SuccessFactors instance URL (e.g., https://apisalesdemo2.successfactors.com) */
	instanceUrl: string;
	/** Company ID in SAP SuccessFactors */
	companyId: string;
	/** Whether to include zero-hour records */
	includeZeroHours: boolean;
	/** Batch size for API requests (max 100 recommended by SAP) */
	batchSize: number;
	/** API timeout in milliseconds */
	apiTimeoutMs: number;
}

/**
 * Employee matching strategies for SAP SuccessFactors
 */
export type SuccessFactorsEmployeeMatchStrategy = "userId" | "personIdExternal" | "email";

/**
 * Default SAP SuccessFactors configuration
 */
export const DEFAULT_SUCCESSFACTORS_CONFIG: SuccessFactorsConfig = {
	employeeMatchStrategy: "userId",
	instanceUrl: "",
	companyId: "",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 60000,
};

/**
 * SAP SuccessFactors API credentials (stored in Vault)
 */
export interface SuccessFactorsCredentials {
	clientId: string;
	clientSecret: string;
}

/**
 * OAuth2 authentication token from SAP SuccessFactors
 */
export interface SuccessFactorsAuthToken {
	accessToken: string;
	tokenType: string;
	expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * SAP SuccessFactors Time Record request for OData API
 * Based on EmployeeTime entity
 */
export interface SFTimeRecordRequest {
	/** User ID in SAP SuccessFactors */
	userId: string;
	/** Start date in YYYY-MM-DD format */
	startDate: string;
	/** Start time in HH:mm format */
	startTime: string;
	/** End date in YYYY-MM-DD format */
	endDate: string;
	/** End time in HH:mm format */
	endTime: string;
	/** Time type code (e.g., "REGULAR", "OVERTIME") */
	timeType: string;
	/** Duration in hours (decimal) */
	quantityInHours: number;
	/** Optional comment/description */
	comment?: string;
	/** External reference ID (work period ID for tracking) */
	externalCode?: string;
}

/**
 * SAP SuccessFactors Absence/Time Off request for OData API
 * Based on EmployeeTimeOff entity
 */
export interface SFAbsenceRequest {
	/** User ID in SAP SuccessFactors */
	userId: string;
	/** Time off type code */
	timeType: string;
	/** Start date in YYYY-MM-DD format */
	startDate: string;
	/** End date in YYYY-MM-DD format */
	endDate: string;
	/** Duration in days */
	quantityInDays: number;
	/** Optional comment */
	comment?: string;
	/** External reference ID (absence ID for tracking) */
	externalCode?: string;
}

/**
 * SAP SuccessFactors OData success response
 */
export interface SFODataResponse<T> {
	d: {
		results?: T[];
		__metadata?: {
			uri: string;
			type: string;
		};
	} & T;
}

/**
 * SAP SuccessFactors OData error response
 */
export interface SFODataErrorResponse {
	error: {
		code: string;
		message: {
			lang: string;
			value: string;
		};
		innererror?: {
			errordetails?: Array<{
				code: string;
				message: string;
				severity: string;
			}>;
		};
	};
}

/**
 * SAP SuccessFactors employee data from API
 */
export interface SFEmployee {
	userId: string;
	personIdExternal?: string;
	email?: string;
	firstName?: string;
	lastName?: string;
}

/**
 * SAP SuccessFactors time type data
 */
export interface SFTimeType {
	externalCode: string;
	externalName: string;
	category?: string;
}

/**
 * Result of a single record sync attempt
 */
export interface SFSyncAttemptResult {
	success: boolean;
	externalId?: string;
	error?: {
		message: string;
		code?: string;
		isRetryable: boolean;
	};
}

/**
 * Batch operation result from OData $batch
 */
export interface SFBatchResult {
	index: number;
	statusCode: number;
	success: boolean;
	data?: unknown;
	error?: {
		code: string;
		message: string;
	};
}

/**
 * Vault keys for SAP SuccessFactors credentials
 */
export const SF_VAULT_KEYS = {
	clientId: "payroll/successfactors/client_id",
	clientSecret: "payroll/successfactors/client_secret",
} as const;

/**
 * HTTP status codes that indicate retryable errors
 */
export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Maximum retry attempts for API calls
 */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Base delay in milliseconds for exponential backoff
 */
export const RETRY_BASE_DELAY_MS = 1000;
