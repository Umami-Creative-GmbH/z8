export type DiagnosticsStatus = "healthy" | "warning" | "error" | "disabled";

export interface DiagnosticsItem {
	title: string;
	status: DiagnosticsStatus;
	value: string;
	description?: string;
	actionHref?: string;
	actionLabel?: string;
}

export interface PlatformDiagnosticsSnapshot {
	fetchedAt: string;
	overallStatus: Exclude<DiagnosticsStatus, "disabled">;
	configuration: DiagnosticsItem[];
	health: DiagnosticsItem[];
	recommendedActions: string[];
}

export interface QueueSummary {
	waiting: number;
	active: number;
	failed: number;
	delayed: number;
}
