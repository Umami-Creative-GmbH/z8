import {
	IconCalendar,
	IconChartBar,
	IconChartLine,
	IconClock,
	IconUsers,
} from "@tabler/icons-react";
import { getLocale } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/db";
import { getRequestSession } from "@/lib/auth/request-session";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { Link } from "@/navigation";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import { getTranslate } from "@/tolgee/server";
import { getStatisticsScope } from "../settings/statistics/actions";
import { formatStatisticsFetchedAt } from "../settings/statistics/statistics-format";
import { AnalyticsHeading } from "./analytics-heading";
import { AnalyticsTabs } from "./analytics-tabs";

export default function AnalyticsLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/analytics" params={params}>
			<Suspense fallback={<AnalyticsLayoutLoading />}>
				<AnalyticsLayoutContent>{children}</AnalyticsLayoutContent>
			</Suspense>
		</RouteTranslationBoundary>
	);
}

async function AnalyticsLayoutLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.analyticsNavigation",
				labelDefault: "Loading analytics navigation",
			}}
		>
			<div className="space-y-2">
				<AnalyticsHeading title={t("analytics.layout.title", "Analytics")} />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</div>
			<Skeleton aria-hidden="true" className="h-10 w-full max-w-3xl" />
		</LoadingRegion>
	);
}

async function AnalyticsLayoutContent({ children }: { children: React.ReactNode }) {
	const [t, locale, session] = await Promise.all([
		getTranslate(),
		getLocale(),
		getRequestSession(),
	]);
	if (!session?.user) {
		return redirectWithLocale("/sign-in");
	}

	const caller = await getCurrentSettingsAccess();

	// Unified access control (#1955): org admins (with or without an employee record),
	// workforce admins, and managers may view Analytics; plain employees remain denied.
	if (
		!caller ||
		caller.settingsAccess === null ||
		!meetsSettingsAccess(caller.settingsAccess, "scopedManager")
	) {
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<AnalyticsHeading title={t("analytics.layout.title", "Analytics")} />
				<div className="text-center">
					<h2 className="text-2xl font-bold">
						{t("analytics.access.restrictedTitle", "Access Restricted")}
					</h2>
					<p className="mt-2 text-muted-foreground">
						{t(
							"analytics.access.restrictedDescription",
							"Analytics is only available to administrators and managers.",
						)}
					</p>
				</div>
			</div>
		);
	}

	const [scopeResult, organizationTimezone] = await Promise.all([
		getStatisticsScope(),
		loadOrganizationTimezone(db, caller.organizationId).catch(() => "UTC"),
	]);

	const scopeContext = scopeResult.success
		? (() => {
				const { scope, fetchedAt } = scopeResult.data;
				const scopeLabel = scope.organizationWide
					? t("settings.statistics.scope.organization", "Whole organization")
					: t(
							"settings.statistics.scope.teams",
							"{count, plural, =0 {No teams you manage} one {# team you manage} other {# teams you manage}}",
							{ count: scope.teamCount },
						);
				return (
					<div className="space-y-1 text-right text-xs">
						<p className="font-medium text-foreground">{scopeLabel}</p>
						<p className="tabular-nums text-muted-foreground">
							{t("settings.statistics.lastUpdated", "Last updated")}:{" "}
							<time dateTime={fetchedAt}>
								{formatStatisticsFetchedAt(fetchedAt, locale, organizationTimezone)}
							</time>
						</p>
					</div>
				);
			})()
		: undefined;

	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			{/* Page Header */}
			<div>
				<AnalyticsHeading
					title={t("analytics.layout.title", "Analytics")}
					description={t(
						"analytics.layout.description",
						"Comprehensive insights into team performance, work hours, and absence patterns",
					)}
					actions={scopeContext}
				/>
			</div>

			{/* Sub-navigation Tabs */}
			<div>
				<AnalyticsTabs>
					<TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
						<TabsTrigger value="overview" asChild>
							<Link href="/analytics">
								<IconChartBar className="mr-2 size-4" />
								{t("analytics.layout.tabs.overview", "Overview")}
							</Link>
						</TabsTrigger>
						<TabsTrigger value="team-performance" asChild>
							<Link href="/analytics/team-performance">
								<IconUsers className="mr-2 size-4" />
								{t("analytics.layout.tabs.teamPerformance", "Team Performance")}
							</Link>
						</TabsTrigger>
						<TabsTrigger value="work-hours" asChild>
							<Link href="/analytics/work-hours">
								<IconChartLine className="mr-2 size-4" />
								{t("analytics.layout.tabs.workHours", "Work Hours")}
							</Link>
						</TabsTrigger>
						<TabsTrigger value="overtime-burn-down" asChild>
							<Link href="/analytics/overtime-burn-down">
								<IconClock className="mr-2 size-4" />
								{t("analytics.layout.tabs.overtimeBurnDown", "Overtime Burn-Down")}
							</Link>
						</TabsTrigger>
						<TabsTrigger value="vacation-trends" asChild>
							<Link href="/analytics/vacation-trends">
								<IconCalendar className="mr-2 size-4" />
								{t("analytics.layout.tabs.absencesAndVacation", "Absences & Vacation")}
							</Link>
						</TabsTrigger>
					</TabsList>
				</AnalyticsTabs>
			</div>

			{/* Page Content */}
			{children}
		</div>
	);
}
