import {
	IconCalendar,
	IconChartBar,
	IconChartLine,
	IconClock,
	IconUsers,
} from "@tabler/icons-react";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/db";
import { getRequestSession } from "@/lib/auth/request-session";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { Link } from "@/navigation";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import { getTranslate } from "@/tolgee/server";
import { findAnalyticsEmployeeByUserId } from "./current-employee-scope";

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
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.analyticsNavigation",
				labelDefault: "Loading analytics navigation",
			}}
		>
			<div className="space-y-2 px-4 lg:px-6">
				<PageHeader title={t("analytics.layout.title", "Analytics")} />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-10 w-full max-w-3xl" />
			</div>
		</LoadingRegion>
	);
}

async function AnalyticsLayoutContent({
	children,
}: {
	children: React.ReactNode;
}) {
	const [t, session] = await Promise.all([getTranslate(), getRequestSession()]);
	if (!session?.user) {
		return redirectWithLocale("/sign-in");
	}

	const currentEmployee = await findAnalyticsEmployeeByUserId(
		db,
		session.user.id,
		session.session.activeOrganizationId,
	);

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-6">
				<PageHeader title={t("analytics.layout.title", "Analytics")} />
				<NoEmployeeError
					feature={t("analytics.access.noEmployeeFeature", "view analytics")}
				/>
			</div>
		);
	}

	// Role-based access control: Only admins and managers can access analytics
	if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-6">
				<PageHeader title={t("analytics.layout.title", "Analytics")} />
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

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="px-4 lg:px-6">
				<PageHeader
					title={t("analytics.layout.title", "Analytics")}
					description={t(
						"analytics.layout.description",
						"Comprehensive insights into team performance, work hours, and absence patterns",
					)}
				/>
			</div>

			{/* Sub-navigation Tabs */}
			<div className="px-4 lg:px-6">
				<Tabs defaultValue="overview" className="w-full">
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
						<TabsTrigger value="vacation-trends" asChild>
							<Link href="/analytics/vacation-trends">
								<IconCalendar className="mr-2 size-4" />
								{t("analytics.layout.tabs.vacationTrends", "Vacation Trends")}
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
								{t(
									"analytics.layout.tabs.overtimeBurnDown",
									"Overtime Burn-Down",
								)}
							</Link>
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/* Page Content */}
			{children}
		</div>
	);
}
