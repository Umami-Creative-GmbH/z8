/**
 * Workday-specific types and configurations
 */

export type WorkdayEmployeeMatchStrategy = "employeeNumber" | "email";

/**
 * Workday API configuration
 * Secrets are stored outside this config (Vault/settings).
 */
export interface WorkdayConfig {
	instanceUrl: string;
	tenantId: string;
	employeeMatchStrategy: WorkdayEmployeeMatchStrategy;
	includeZeroHours: boolean;
	batchSize: number;
	apiTimeoutMs: number;
}

export const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
	instanceUrl: "",
	tenantId: "",
	employeeMatchStrategy: "employeeNumber",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 30000,
};

export interface WorkdayOAuthCredentials {
	clientId: string;
	clientSecret: string;
	scope?: string;
}

export interface WorkdayAuthToken {
	accessToken: string;
	tokenType: string;
	expiresAt: number;
}

export interface WorkdayWorker {
	id: string;
	employeeNumber?: string;
	email?: string;
}

export interface WorkdayAttendancePayload {
	workerId: string;
	sourceId: string;
	startDate: string;
	endDate: string;
	hours: number;
	projectName: string | null;
	categoryName: string | null;
}

export interface WorkdayAbsencePayload {
	workerId: string;
	sourceId: string;
	startDate: string;
	endDate: string;
	absenceCategoryName: string | null;
	absenceType: string | null;
}
