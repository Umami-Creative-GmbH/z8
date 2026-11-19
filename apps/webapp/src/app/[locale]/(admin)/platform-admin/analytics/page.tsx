import { connection } from "next/server";
import { Suspense } from "react";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsSearchParams,
} from "@/lib/platform-analytics/types";
import { getTranslate } from "@/tolgee/server";
import { PlatformAnalyticsControls } from "./analytics-controls";
import { PlatformAnalyticsDataSection } from "./analytics-data";
import { PlatformAnalyticsHeading } from "./analytics-heading";

const PLATFORM_ANALYTICS_KPI_LOADING_KEYS = ["kpi-1", "kpi-2", "kpi-3", "kpi-4"];
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
	// Live platform analytics Effect data must resolve per request outside the prerendered shell.
	await connection();
	const t = await getTranslate();
	const sectionTitle = t("admin:admin.analytics.sectionTitle", "Analytics Trends");
	const sectionDescription = t(
		"admin:admin.analytics.sectionDescription",
		"Updated from current platform data for the selected range and bucket.",
	);

	return (
		<div className="min-w-0 space-y-6">
			<PlatformAnalyticsHeading />

			<Suspense
				fallback={
					<PlatformAnalyticsRouteLoading
						sectionTitle={sectionTitle}
						sectionDescription={sectionDescription}
					/>
				}
			>
				<PlatformAnalyticsRouteContent
					searchParams={searchParams}
					sectionTitle={sectionTitle}
					sectionDescription={sectionDescription}
				/>
			</Suspense>
		</div>
	);
}

async function PlatformAnalyticsRouteContent({
	searchParams,
	sectionTitle,
	sectionDescription,
}: {
	searchParams?: Promise<PlatformAnalyticsSearchParams>;
	sectionTitle: string;
	sectionDescription: string;
}) {
	const parsedParams = parsePlatformAnalyticsParams((await searchParams) ?? {});

	return (
		<>
			<PlatformAnalyticsControls range={parsedParams.range} bucket={parsedParams.bucket} />
			<PlatformAnalyticsSection
				parsedParams={parsedParams}
				sectionTitle={sectionTitle}
				sectionDescription={sectionDescription}
			/>
		</>
	);
}

function PlatformAnalyticsSection({
	parsedParams,
	sectionTitle,
	sectionDescription,
}: {
	parsedParams: ParsedPlatformAnalyticsParams;
	sectionTitle: string;
	sectionDescription: string;
}) {
	return (
		<section className="mt-4 space-y-4 lg:col-span-2" aria-labelledby="platform-analytics-heading">
			<PlatformAnalyticsSectionHeading
				sectionTitle={sectionTitle}
				sectionDescription={sectionDescription}
			/>
			<Suspense
				key={`${parsedParams.range}-${parsedParams.bucket}`}
				fallback={<PlatformAnalyticsLoading />}
			>
				<PlatformAnalyticsDataSection parsedParams={parsedParams} />
			</Suspense>
		</section>
	);
}

function PlatformAnalyticsLoading() {
	return (
		<LoadingRegion
			className="min-w-0 space-y-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.platformAnalytics",
				labelDefault: "Loading platform analytics",
			}}
		>
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
		</LoadingRegion>
	);
}

function PlatformAnalyticsControlsLoading() {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center" aria-hidden="true">
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

function PlatformAnalyticsRouteLoading({
	sectionTitle,
	sectionDescription,
}: {
	sectionTitle: string;
	sectionDescription: string;
}) {
	return (
		<>
			<PlatformAnalyticsControlsLoading />
			<section className="mt-4 space-y-4 lg:col-span-2" aria-busy="true" role="status">
				<LocalizedLoadingLabel
					translationKey="common:loading.platformAnalytics"
					fallback="Loading platform analytics"
				/>
				<PlatformAnalyticsSectionHeading
					sectionTitle={sectionTitle}
					sectionDescription={sectionDescription}
				/>
				<PlatformAnalyticsLoading />
			</section>
		</>
	);
}

function PlatformAnalyticsSectionHeading({
	sectionTitle,
	sectionDescription,
}: {
	sectionTitle: string;
	sectionDescription: string;
}) {
	return (
		<div className="space-y-1">
			<h2
				id="platform-analytics-heading"
				className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
			>
				{sectionTitle}
			</h2>
			<p className="text-sm text-muted-foreground">{sectionDescription}</p>
		</div>
	);
}

function PlatformAnalyticsPageLoading() {
	return (
		<LoadingRegion
			className="space-y-8"
			role="status"
			label={{
				labelKey: "common.loadingRegions.platformAnalytics",
				labelDefault: "Loading platform analytics",
			}}
		>
			<div className="space-y-6">
				<PlatformAnalyticsHeading />
				<PlatformAnalyticsControlsLoading />
			</div>
			<section className="space-y-4">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-5 w-36" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				<PlatformAnalyticsLoading />
			</section>
		</LoadingRegion>
	);
}
