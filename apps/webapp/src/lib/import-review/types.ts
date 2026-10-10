/** Time-tracking tools whose data the reviewed import stages (work, absences, setup). */
export type ImportProvider = "clockodo" | "clockin";
/**
 * Where a batch's rows come from: a time-tracking tool, or the organization's
 * accounting connection (customer import, #906).
 */
export type ImportBatchProvider = ImportProvider | "accounting";
export type ImportBatchStatus =
	| "draft"
	| "scanning"
	| "needs_review"
	| "committing"
	| "completed"
	| "scan_failed"
	| "commit_failed"
	| "cancelled";
export type ImportJobStatus = "queued" | "running" | "completed" | "failed";
export type ImportJobKind = "scan" | "commit";
export type ImportRowStatus =
	| "staged"
	| "accepted"
	| "rejected"
	| "blocked"
	| "needs_mapping"
	| "committing"
	| "committed"
	| "commit_failed";
export type ImportIssueSeverity = "none" | "info" | "warning" | "blocking";
export type ImportIssueType =
	| "duplicate"
	| "suspicious_gap"
	| "unmatched_employee"
	| "unmatched_project"
	| "validation_error"
	| "dependency_blocker";

export type ImportEntityType =
	| "employee"
	| "team"
	| "service"
	| "work_category"
	| "absence_category"
	| "target_hours"
	| "work_policy"
	| "holiday_quota"
	| "holiday"
	| "surcharge"
	| "absence"
	| "time_entry"
	| "work_period"
	/** A customer contact from the accounting connection (#906). */
	| "customer";

/**
 * What an accepted row commits as, when its entity type offers more than
 * "create": `link` commits the row onto an existing Z8 record (`targetId`)
 * instead of creating one. Only customer rows take it (#906). Accepted rows
 * without a choice create; rejected rows are skipped.
 */
export type ImportRowChoice = { kind: "link"; targetId: string };

export interface ImportDateRange {
	startDate: string;
	endDate: string;
}

export interface ImportEmployeeMapping {
	providerEmployeeId: string;
	employeeId: string;
	userId?: string | null;
}

export interface NormalizedImportRow {
	entityType: ImportEntityType;
	providerSourceId: string;
	sourcePayload: Record<string, unknown>;
	normalizedPayload: Record<string, unknown>;
	matchTarget?: Record<string, unknown> | null;
	issueSeverity: ImportIssueSeverity;
	rowStatus: ImportRowStatus;
}

export interface ImportIssueDraft {
	issueType: ImportIssueType;
	severity: Exclude<ImportIssueSeverity, "none">;
	clusterKey?: string | null;
	message: string;
	details: Record<string, unknown>;
	detectionRuleVersion: string;
}

export interface ImportScanJobData {
	type: "import-review-scan";
	batchId: string;
	jobId: string;
	organizationId: string;
	provider: ImportProvider;
	entityType: ImportEntityType;
	dateRange: ImportDateRange;
	employeeIds: string[];
	employeeMappings?: ImportEmployeeMapping[];
	secretId: string;
}

/**
 * Scans the customer contacts of the organization's accounting connection
 * (#906). No credential travels with the job: the scan opens the connection's
 * provider with the key from the organization secret store, and refuses when
 * the active connection is no longer `connectionId`.
 */
export interface AccountingCustomerScanJobData {
	type: "import-review-scan";
	batchId: string;
	jobId: string;
	organizationId: string;
	provider: "accounting";
	entityType: "customer";
	connectionId: string;
}

export interface ImportCommitJobData {
	type: "import-review-commit";
	batchId: string;
	jobId: string;
	organizationId: string;
	entityType: ImportEntityType;
	committedBy: string;
}
