export type ImportProvider = "clockodo" | "clockin";
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
	| "work_period";

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

export interface ImportCommitJobData {
	type: "import-review-commit";
	batchId: string;
	jobId: string;
	organizationId: string;
	entityType: ImportEntityType;
	committedBy: string;
}
