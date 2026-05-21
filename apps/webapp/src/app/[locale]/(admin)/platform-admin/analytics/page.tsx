import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformAnalyticsCharts } from "@/components/platform-admin/platform-analytics-charts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsSearchParams,
} from "@/lib/platform-analytics/types";
import { getTranslate } from "@/tolgee/server";
import { PlatformAnalyticsControls } from "./analytics-controls";

export default async function PlatformAnalyticsPage({
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

				<PlatformAnalyticsControls range={parsedParams.range} bucket={parsedParams.bucket} />
			</div>

			<section className="space-y-4" aria-labelledby="platform-analytics-heading">
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
	await connection();

	const data = await getPlatformAnalyticsData(parsedParams);

	return <PlatformAnalyticsCharts data={data} />;
}

function PlatformAnalyticsLoading() {
	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{["kpi-1", "kpi-2", "kpi-3", "kpi-4"].map((key) => (
					<Card key={key}>
						<CardHeader className="pb-0">
							<Skeleton className="h-4 w-28" />
						</CardHeader>
						<CardContent className="space-y-2">
							<Skeleton className="h-8 w-20" />
							<Skeleton className="h-3 w-32" />
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				{["chart-1", "chart-2"].map((key) => (
					<Card key={key}>
						<CardHeader className="space-y-2">
							<Skeleton className="h-5 w-32" />
							<Skeleton className="h-4 w-64 max-w-full" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-[260px] w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
