export type SelfServiceRequestSourceType = "time_correction" | "absence" | "travel_expense";

export type SelfServiceRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type SelfServiceRequestAction = "view" | "fix" | "cancel";

export interface SelfServiceRequestItem {
	id: string;
	sourceType: SelfServiceRequestSourceType;
	sourceId: string;
	organizationId: string;
	employeeId: string;
	status: SelfServiceRequestStatus;
	submittedAt: Date;
	resolvedAt: Date | null;
	title: string;
	subtitle: string;
	decisionReason: string | null;
	availableActions: SelfServiceRequestAction[];
	sourceHref: string;
}

export interface SelfServiceRequestCounts {
	pending: number;
	requiredFixes: number;
	recentDecisions: number;
	total: number;
}

export interface SelfServiceRequestFilters {
	status?: SelfServiceRequestStatus | "all";
	sourceType?: SelfServiceRequestSourceType | "all";
	search?: string;
}

export interface SelfServiceRequestSourceError {
	sourceType: SelfServiceRequestSourceType;
	message: string;
}

export interface SelfServiceRequestResult {
	items: SelfServiceRequestItem[];
	counts: SelfServiceRequestCounts;
	sourceErrors: SelfServiceRequestSourceError[];
}
