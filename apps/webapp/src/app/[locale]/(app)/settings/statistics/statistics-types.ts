/** One KPI's value, or "failed" when its read did not succeed. A failed KPI never reads as zero. */
export type Kpi<T> = { status: "ok"; value: T } | { status: "failed" };

/** A figure this month and over the same elapsed span of last month. */
export interface LikeForLike {
	current: number;
	previous: number;
}

/** The comparison window's days, as `YYYY-MM-DD`, for the "vs. Oct 1–5" label. */
export interface ComparisonDays {
	firstDay: string;
	lastDay: string;
}

/** Who the figures cover: the whole organization, or the teams a scoped manager manages. */
export type StatisticsScopeLabel =
	| { organizationWide: true }
	| { organizationWide: false; teamCount: number };

export interface AttentionStatistics {
	staleLiveWork: Kpi<number>;
	openViolations: Kpi<number>;
}

export interface MonthStatistics {
	comparison: ComparisonDays;
	workedMinutes: Kpi<LikeForLike>;
	absenceDays: Kpi<LikeForLike>;
	completedWorkPeriods: Kpi<LikeForLike>;
}

export interface AdoptionStatistics {
	coverage: Kpi<{ tracked: number; expected: number }>;
	clockedIn: Kpi<number>;
	manualEntryShare: Kpi<{ manualMinutes: number; totalMinutes: number }>;
}

export interface WorkforceStatistics {
	roster: Kpi<{ roster: number; joined: number; left: number }>;
	teams: Kpi<number>;
	incompleteSetup: Kpi<number>;
	/** Org admins only; absent for everyone else. */
	usersSignedIn?: Kpi<number>;
}

/** The viewer's pending approvals inbox, or null when they have no inbox. */
export type ApprovalInboxSummary = Kpi<{ pending: number; absenceRequests: number } | null>;
