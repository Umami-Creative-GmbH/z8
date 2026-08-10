import { Suspense } from "react";
import { PlatformAnalyticsCharts } from "@/components/platform-admin/platform-analytics-charts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsSearchParams,
} from "@/lib/platform-analytics/types";
import { getTranslate } from "@/tolgee/server";
import { PlatformAnalyticsControls } from "./analytics-controls";

const PLATFORM_ANALYTICS_KPI_LOADING_KEYS = [
	"kpi-1",
	"kpi-2",
	"kpi-3",
	"kpi-4",
];
const PLATFORM_ANALYTICS_CHART_LOADING_KEYS = ["chart-1", "chart-2"];

export default function PlatformAnalyticsPage({
	searchParams,
}: {
	searchParams?: Promise<PlatformAnalyticsSearchParams>;
}) {
	return (
		<Suspense fallback={<PlatformAnalyticsPageLoading />}>
			<PlatformAnalyticsPageContent searchParams={searchParams} />
		</Suspense>
	);
}

async function PlatformAnalyticsPageContent({
	searchParams,
}: {
	searchParams?: Promise<PlatformAnalyticsSearchParams>;
}) {
	const [t, params] = await Promise.all([getTranslate(), searchParams]);
	const parsedParams = parsePlatformAnalyticsParams(params ?? {});

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("admin:admin.analytics.title", "Platform Analytics")}
					</h1>
					<p className="max-w-2xl text-muted-foreground">
						{t(
							"admin:admin.analytics.description",
							"Monitor platform growth, engagement, operational activity, and billing trends.",
						)}
					</p>
				</div>

				<Suspense fallback={<PlatformAnalyticsControlsLoading />}>
					<PlatformAnalyticsControls
						range={parsedParams.range}
						bucket={parsedParams.bucket}
					/>
				</Suspense>
			</div>

			<section
				className="space-y-4"
				aria-labelledby="platform-analytics-heading"
			>
				<div className="space-y-1">
					<h2
						id="platform-analytics-heading"
						className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
					>
						{t("admin:admin.analytics.sectionTitle", "Analytics Trends")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"admin:admin.analytics.sectionDescription",
							"Updated from current platform data for the selected range and bucket.",
						)}
					</p>
				</div>

				<Suspense
					key={`${parsedParams.range}-${parsedParams.bucket}`}
					fallback={<PlatformAnalyticsLoading />}
				>
					<PlatformAnalyticsDataSection parsedParams={parsedParams} />
				</Suspense>
			</section>
		</div>
	);
}

async function PlatformAnalyticsDataSection({
	parsedParams,
}: {
	parsedParams: ParsedPlatformAnalyticsParams;
}) {
	const data = await getPlatformAnalyticsData(parsedParams);

	return <PlatformAnalyticsCharts data={data} />;
}

function PlatformAnalyticsLoading() {
	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{PLATFORM_ANALYTICS_KPI_LOADING_KEYS.map((key) => (
					<Card key={key}>
						<CardHeader className="pb-0">
							<Skeleton aria-hidden="true" className="h-4 w-28" />
						</CardHeader>
						<CardContent className="space-y-2">
							<Skeleton aria-hidden="true" className="h-8 w-20" />
							<Skeleton aria-hidden="true" className="h-3 w-32" />
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				{PLATFORM_ANALYTICS_CHART_LOADING_KEYS.map((key) => (
					<Card key={key}>
						<CardHeader className="space-y-2">
							<Skeleton aria-hidden="true" className="h-5 w-32" />
							<Skeleton aria-hidden="true" className="h-4 w-64 max-w-full" />
						</CardHeader>
						<CardContent>
							<Skeleton aria-hidden="true" className="h-[260px] w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

function PlatformAnalyticsControlsLoading() {
	return (
		<div
			className="flex flex-col gap-3 sm:flex-row sm:items-center"
			aria-hidden="true"
		>
			<div className="grid gap-1.5">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-10 w-full sm:w-[180px]" />
			</div>
			<div className="grid gap-1.5">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-10 w-full sm:w-[160px]" />
			</div>
		</div>
	);
}

function PlatformAnalyticsPageLoading() {
	return (
		<div
			className="space-y-8"
			role="status"
			aria-label="Loading platform analytics"
		>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-56" />
					<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
				</div>
				<PlatformAnalyticsControlsLoading />
			</div>
			<section className="space-y-4">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-5 w-36" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				<PlatformAnalyticsLoading />
			</section>
		</div>
	);
}
