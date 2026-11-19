import { IconAlertCircle } from "@tabler/icons-react";
import { getLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { reachesWholeOrganization } from "@/lib/organization-action/managed-scope";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { getTranslate } from "@/tolgee/server";
import type { ManagerStatisticsReadView, OrganizationStats } from "./actions";
import { getManagerStatisticsReadView, getOrganizationStats } from "./actions";
import {
	formatSignedCount,
	formatStatisticsFetchedAt,
	StatisticsSection,
} from "./statistics-summary";

async function StatisticsContent() {
	const [settingsRouteContext, t, locale] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
		getLocale(),
	]);

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		return redirectWithLocale("/settings");
	}

	const canViewOrgWideStatistics = accessTier === "orgAdmin";
	// A workforce admin reads the organization's statistics too, without the sessions count (#1651).
	const readsWholeOrganization =
		canViewOrgWideStatistics ||
		reachesWholeOrganization({ settingsAccess: "scopedManager", employee: authContext.employee });
	const [statsResult, organizationTimezone] = await Promise.all([
		canViewOrgWideStatistics ? getOrganizationStats() : getManagerStatisticsReadView(),
		// "Last updated" is shown in the organization's time zone, the one "this month" counts in;
		// the label names the zone, so a failed read falls back to UTC visibly.
		loadOrganizationTimezone(db, organizationId).catch(() => "UTC"),
	]);

	const title = t("settings.statistics.title", "Statistics");
	const description = readsWholeOrganization
		? t(
				"settings.statistics.description",
				"View statistics and metrics about your instance",
			)
		: t(
				"settings.statistics.managerDescription",
				"Review read-only analytics for the teams you manage.",
			);

	if (!statsResult.success) {
		return (
			<div className="page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={title} description={description} />
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" />
					<AlertTitle>
						{t("settings.statistics.loadError", "Failed to load statistics")}
					</AlertTitle>
					<AlertDescription>
						<p>{statsResult.error}</p>
						<p>
							{t(
								"settings.statistics.loadErrorRetry",
								"Reload the page to try again.",
							)}
						</p>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	const stats = statsResult.data as
		| OrganizationStats
		| ManagerStatisticsReadView;
	const timeEntryChange =
		stats.timeEntriesThisMonth - stats.timeEntriesLastMonth;
	const lastUpdated = formatStatisticsFetchedAt(
		stats.fetchedAt,
		locale,
		organizationTimezone,
	);

	const orgStats = canViewOrgWideStatistics
		? (stats as OrganizationStats)
		: null;
	const pendingCount = (count: number) =>
		t("settings.statistics.cards.pendingCount", "{count} pending", { count });

	return (
		<div className="page-frame flex flex-1 flex-col gap-8">
			<PageHeader
				title={title}
				description={description}
				actions={
					<p className="text-xs tabular-nums text-muted-foreground">
						{t("settings.statistics.lastUpdated", "Last updated")}:{" "}
						<time dateTime={stats.fetchedAt}>{lastUpdated}</time>
					</p>
				}
			/>

			<StatisticsSection
				id="core"
				locale={locale}
				title={
					readsWholeOrganization
						? t("settings.statistics.sections.coreCounts", "Core Counts")
						: t("settings.statistics.sections.managedScope", "Managed Team Scope")
				}
				metrics={[
					{
						key: "employees",
						label: t("settings.statistics.cards.employees", "Employees"),
						value: stats.totalEmployees,
						detail: t(
							"settings.statistics.cards.employeesDescription",
							"{active} active, {inactive} inactive",
							{
								active: stats.activeEmployees,
								inactive: stats.inactiveEmployees,
							},
						),
					},
					{
						key: "teams",
						label: t("settings.statistics.cards.teams", "Teams"),
						value: stats.totalTeams,
					},
				]}
			/>

			<StatisticsSection
				id="activity"
				locale={locale}
				title={t("settings.statistics.sections.activityMetrics", "Activity Metrics")}
				metrics={[
					{
						key: "totalTimeEntries",
						label: t("settings.statistics.cards.totalTimeEntries", "Total Time Entries"),
						value: stats.totalTimeEntries,
						// A change in entry volume is neither good nor bad, so it stays neutral.
						detail: `${formatSignedCount(timeEntryChange, locale)} ${t(
							"settings.statistics.cards.vsLastMonth",
							"vs last month",
						)}`,
					},
					{
						key: "timeEntriesThisMonth",
						label: t("settings.statistics.cards.thisMonth", "This Month"),
						value: stats.timeEntriesThisMonth,
						unit: t("settings.statistics.cards.timeEntries", "Time entries"),
					},
					{
						key: "totalAbsences",
						label: t("settings.statistics.cards.totalAbsences", "Total Absences"),
						value: stats.totalAbsences,
						detail: pendingCount(stats.pendingAbsences),
					},
					{
						key: "approvalRequests",
						label: t("settings.statistics.cards.approvalRequests", "Approval Requests"),
						value: stats.totalApprovals,
						detail: pendingCount(stats.pendingApprovals),
					},
				]}
			/>

			<StatisticsSection
				id="absences"
				locale={locale}
				title={t("settings.statistics.sections.absenceBreakdown", "Absence Breakdown")}
				metrics={[
					{
						key: "pendingAbsences",
						label: t("settings.statistics.cards.pendingAbsences", "Pending Absences"),
						value: stats.pendingAbsences,
					},
					{
						key: "approvedAbsences",
						label: t("settings.statistics.cards.approvedAbsences", "Approved Absences"),
						value: stats.approvedAbsences,
					},
					{
						key: "rejectedAbsences",
						label: t("settings.statistics.cards.rejectedAbsences", "Rejected Absences"),
						value: stats.rejectedAbsences,
					},
				]}
			/>

			{orgStats ? (
				<StatisticsSection
					id="system"
					locale={locale}
					title={t("settings.statistics.sections.systemHealth", "System Health")}
					metrics={[
						{
							key: "activeSessions",
							label: t("settings.statistics.cards.activeSessions", "Active Sessions"),
							value: orgStats.activeSessions,
							detail: t(
								"settings.statistics.cards.activeSessionsDescription",
								"Current database sessions",
							),
						},
					]}
				/>
			) : null}
		</div>
	);
}

const STATISTICS_LOADING_SECTIONS = [
	{ key: "counts", metrics: ["employees", "teams"], heading: "w-32", columns: "sm:grid-cols-2" },
	{
		key: "activity",
		metrics: ["entries", "month", "absences", "approvals"],
		heading: "w-40",
		columns: "sm:grid-cols-2 lg:grid-cols-4",
	},
	{
		key: "absences",
		metrics: ["pending", "approved", "rejected"],
		heading: "w-36",
		columns: "sm:grid-cols-3",
	},
] as const;

function StatisticsLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-8"
			label={{
				labelKey: "common.loadingRegions.statistics",
				labelDefault: "Loading statistics",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>

			{STATISTICS_LOADING_SECTIONS.map((section) => (
				<section key={section.key} className="space-y-3">
					<Skeleton aria-hidden="true" className={`h-6 ${section.heading}`} />
					<div
						className={`grid gap-px overflow-hidden rounded-lg border bg-border ${section.columns}`}
					>
						{section.metrics.map((metric) => (
							<div key={metric} className="space-y-2 bg-card p-4">
								<Skeleton aria-hidden="true" className="h-4 w-24" />
								<Skeleton aria-hidden="true" className="h-8 w-16" />
								<Skeleton aria-hidden="true" className="h-3 w-32" />
							</div>
						))}
					</div>
				</section>
			))}
		</LoadingRegion>
	);
}

export default function StatisticsPage() {
	return (
		<Suspense fallback={<StatisticsLoading />}>
			<StatisticsContent />
		</Suspense>
	);
}
