export const PLATFORM_ANALYTICS_RANGES = ["7d", "30d", "90d", "12m"] as const;
export const PLATFORM_ANALYTICS_BUCKETS = ["day", "week", "month"] as const;

export type PlatformAnalyticsRange = (typeof PLATFORM_ANALYTICS_RANGES)[number];
export type PlatformAnalyticsBucket = (typeof PLATFORM_ANALYTICS_BUCKETS)[number];

export type PlatformAnalyticsSearchParams = {
	range?: string | string[];
	bucket?: string | string[];
};

export type ParsedPlatformAnalyticsParams = {
	range: PlatformAnalyticsRange;
	bucket: PlatformAnalyticsBucket;
	startIso: string;
	endIso: string;
};

export type PlatformAnalyticsBucketInfo = {
	key: string;
	label: string;
	startIso: string;
	endIso: string;
};

export type PlatformAnalyticsMetricKey =
	| "signups"
	| "organizations"
	| "activeUsers"
	| "sessions"
	| "timeRecords"
	| "seats"
	| "mrr";

export type PlatformAnalyticsAggregateRow = {
	bucket: Date | string;
	value: number | string | null;
};

export type PlatformAnalyticsPoint = {
	bucketKey: string;
	label: string;
	signups: number;
	organizations: number;
	activeUsers: number;
	sessions: number;
	timeRecords: number;
	seats: number | null;
	mrr: number | null;
	estimatedBilling: boolean;
};

export type PlatformAnalyticsKpis = {
	activeUsers: number;
	signups: number;
	organizations: number;
	seats: number | null;
	sessions: number;
	timeRecords: number;
	mrr: number | null;
	estimatedBilling: boolean;
};

export type PlatformAnalyticsData = {
	params: ParsedPlatformAnalyticsParams;
	billingEnabled: boolean;
	kpis: PlatformAnalyticsKpis;
	series: PlatformAnalyticsPoint[];
};
