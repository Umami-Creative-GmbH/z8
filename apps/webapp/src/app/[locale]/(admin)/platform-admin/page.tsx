import { randomUUID } from "node:crypto";
import {
	IconActivityHeartbeat,
	IconAlertTriangle,
	IconArrowUpRight,
	IconBuilding,
	IconChevronRight,
	IconCreditCard,
	IconCurrencyEuro,
	IconMailCog,
	IconUserBolt,
	IconUsers,
	IconUserX,
} from "@tabler/icons-react";
import { count, eq, inArray, isNull } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformAnalyticsPreviewCharts } from "@/components/platform-admin/platform-analytics-charts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { organizationSuspension, subscription } from "@/db/schema";
import { env } from "@/env";
import { formatEuroAmount, monthlyRecurringRevenueCents } from "@/lib/billing/seat-prices";
import { requirePlatformAdminSession } from "@/lib/effect/services/platform-admin.service";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { OverviewHeading, OverviewReadFailure, OverviewSnapshot } from "./overview-state";

interface StatCardProps {
	title: string;
	/** A count, or an already formatted amount. */
	value: number | string;
	description: string;
	icon: React.ReactNode;
	href: string;
	variant?: "default" | "warning" | "destructive" | "success";
}

const STAT_CARD_VARIANT_STYLES = {
	default: "text-muted-foreground",
	warning: "text-amber-700 dark:text-amber-400",
	destructive: "text-destructive",
	success: "text-muted-foreground",
};

const DASHBOARD_STATS_LOADING_KEYS = ["users", "banned", "organizations", "suspended"];
const DASHBOARD_BILLING_LOADING_KEYS = ["mrr", "licensed-seats"];

function StatCard({ title, value, description, icon, href, variant = "default" }: StatCardProps) {
	return (
		<Link
			href={href}
			className="group min-w-0 space-y-2 rounded-md p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
		>
			<div className={cn("flex items-center gap-2 text-sm", STAT_CARD_VARIANT_STYLES[variant])}>
				{icon}
				<span className="min-w-0 flex-1 font-medium">{title}</span>
				<IconArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
			</div>
			<div className="break-words text-2xl font-semibold tabular-nums tracking-tight">
				{typeof value === "number" ? value.toLocaleString() : value}
			</div>
			<p className="text-xs text-muted-foreground">{description}</p>
		</Link>
	);
}

async function DashboardStats() {
	try {
		return await DashboardStatsContent();
	} catch {
		const t = await getTranslate();
		return (
			<OverviewReadFailure>
				{t(
					"admin:admin.overview.metricsUnavailable",
					"Platform metrics are unavailable. Try again.",
				)}
			</OverviewReadFailure>
		);
	}
}

async function DashboardStatsContent() {
	const t = await getTranslate();
	const billingEnabled = env.BILLING_ENABLED === "true";

	// Run all queries in parallel to avoid waterfalls (async-parallel)
	const [[{ totalUsers }], [{ bannedUsers }], [{ totalOrgs }], [{ suspendedOrgs }], subscriptions] =
		await Promise.all([
			// Get total users count
			db.select({ totalUsers: count() }).from(user),
			// Get banned users count
			db.select({ bannedUsers: count() }).from(user).where(eq(user.banned, true)),
			// Get total organizations count (excluding deleted)
			db.select({ totalOrgs: count() }).from(organization).where(isNull(organization.deletedAt)),
			// Get suspended organizations count
			db
				.select({ suspendedOrgs: count() })
				.from(organizationSuspension)
				.where(eq(organizationSuspension.isActive, true)),
			// Billing stats (only when billing is enabled)
			billingEnabled
				? db
						.select({
							currentSeats: subscription.currentSeats,
							currentKioskSeats: subscription.currentKioskSeats,
							billingInterval: subscription.billingInterval,
							status: subscription.status,
						})
						.from(subscription)
						.where(inArray(subscription.status, ["active", "trialing", "past_due"]))
				: Promise.resolve([]),
		]);

	// Calculate billing stats from results
	const billingStats = {
		activeSubscriptions: subscriptions.length,
		totalSeats: subscriptions.reduce((sum, s) => sum + s.currentSeats, 0),
		// Full seats and kiosk seats at their own prices (#886).
		mrr: formatEuroAmount(monthlyRecurringRevenueCents(subscriptions)),
	};

	return (
		<div className="grid grid-cols-1 gap-px rounded-lg border bg-card p-1 text-card-foreground sm:grid-cols-2 lg:grid-cols-4">
			<StatCard
				title={t("admin:admin.overview.metrics.totalUsers", "Total Users")}
				value={totalUsers}
				description={t(
					"admin:admin.overview.metrics.totalUsersDescription",
					"Registered platform accounts",
				)}
				icon={<IconUsers className="size-5" aria-hidden="true" />}
				href="/platform-admin/users"
			/>
			<StatCard
				title={t("admin:admin.overview.metrics.bannedUsers", "Banned Users")}
				value={bannedUsers}
				description={t(
					"admin:admin.overview.metrics.bannedUsersDescription",
					"Restricted from access",
				)}
				icon={<IconUserX className="size-5" aria-hidden="true" />}
				href="/platform-admin/users?status=banned"
				variant={bannedUsers > 0 ? "destructive" : "default"}
			/>
			<StatCard
				title={t("admin:admin.overview.metrics.organizations", "Organizations")}
				value={totalOrgs}
				description={t(
					"admin:admin.overview.metrics.organizationsDescription",
					"Active workspaces",
				)}
				icon={<IconBuilding className="size-5" aria-hidden="true" />}
				href="/platform-admin/organizations"
			/>
			<StatCard
				title={t("admin:admin.overview.metrics.suspended", "Suspended")}
				value={suspendedOrgs}
				description={t(
					"admin:admin.overview.metrics.suspendedDescription",
					"Read-only organizations",
				)}
				icon={<IconAlertTriangle className="size-5" aria-hidden="true" />}
				href="/platform-admin/organizations?status=suspended"
				variant={suspendedOrgs > 0 ? "warning" : "default"}
			/>
			{billingEnabled ? (
				<>
					<StatCard
						title={t("admin:admin.overview.metrics.mrr", "MRR")}
						value={billingStats.mrr}
						description={t(
							"admin:admin.overview.metrics.mrrDescription",
							"Monthly recurring revenue (€)",
						)}
						icon={<IconCurrencyEuro className="size-5" aria-hidden="true" />}
						href="/platform-admin/billing"
						variant="success"
					/>
					<StatCard
						title={t("admin:admin.overview.metrics.licensedSeats", "Licensed Seats")}
						value={billingStats.totalSeats}
						description={t(
							"admin:admin.overview.metrics.licensedSeatsDescription",
							"Across all subscriptions",
						)}
						icon={<IconCreditCard className="size-5" aria-hidden="true" />}
						href="/platform-admin/billing"
					/>
				</>
			) : null}
		</div>
	);
}

function DashboardStatsLoading() {
	const billingEnabled = env.BILLING_ENABLED === "true";

	return (
		<LoadingRegion
			label={{
				labelKey: "admin:admin.overview.loadingMetrics",
				labelDefault: "Loading platform metrics",
			}}
			className="grid grid-cols-1 gap-px rounded-lg border bg-card p-1 sm:grid-cols-2 lg:grid-cols-4"
		>
			{DASHBOARD_STATS_LOADING_KEYS.map((key) => (
				<DashboardStatSkeleton key={key} />
			))}
			{billingEnabled
				? DASHBOARD_BILLING_LOADING_KEYS.map((key) => <DashboardStatSkeleton key={key} />)
				: null}
		</LoadingRegion>
	);
}

function DashboardStatSkeleton() {
	return (
		<div aria-hidden="true" className="space-y-2 p-4">
			<Skeleton aria-hidden="true" className="h-8 w-20" />
			<Skeleton aria-hidden="true" className="h-4 w-24" />
			<Skeleton aria-hidden="true" className="h-3 w-32" />
		</div>
	);
}

async function DashboardAnalyticsPreview() {
	// The current analytics preview range and live platform analytics must be resolved per request.
	await connection();
	const params = parsePlatformAnalyticsParams({ range: "30d", bucket: "week" });
	let data: Awaited<ReturnType<typeof getPlatformAnalyticsData>>;
	try {
		data = await getPlatformAnalyticsData(params, undefined, {
			includeBilling: false,
			includeTimeRecords: false,
		});
	} catch {
		const t = await getTranslate();
		return (
			<OverviewReadFailure>
				{t(
					"admin:admin.overview.analyticsUnavailable",
					"Platform analytics are unavailable. Try again.",
				)}
			</OverviewReadFailure>
		);
	}
	return <PlatformAnalyticsPreviewCharts data={data} />;
}

function DashboardAnalyticsPreviewLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "admin:admin.overview.loadingAnalytics",
				labelDefault: "Loading platform analytics",
			}}
		>
			<Card>
				<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<Skeleton className="h-5 w-36" />
						<Skeleton className="h-4 w-72 max-w-full" />
					</div>
					<Skeleton className="h-5 w-28" />
				</CardHeader>
				<CardContent className="grid gap-4 lg:grid-cols-2">
					{["analytics-preview-growth", "analytics-preview-engagement"].map((key) => (
						<Card key={key} className="gap-4 border-muted/80 shadow-none">
							<CardHeader className="space-y-2">
								<Skeleton className="h-5 w-32" />
								<Skeleton className="h-4 w-56 max-w-full" />
							</CardHeader>
							<CardContent className="space-y-3">
								<Skeleton className="h-4 w-48" />
								<Skeleton className="h-[180px] w-full" />
							</CardContent>
						</Card>
					))}
				</CardContent>
			</Card>
		</LoadingRegion>
	);
}

interface QuickActionCardProps {
	title: string;
	description: string;
	href: string;
	icon: React.ReactNode;
}

function QuickActionCard({ title, description, href, icon }: QuickActionCardProps) {
	return (
		<Link
			href={href}
			className="group flex min-w-0 items-start gap-3 rounded-md p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
		>
			<div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex items-center justify-between">
					<h4 className="text-sm font-medium">{title}</h4>
					<IconChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				</div>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
		</Link>
	);
}

async function AdminDashboardContent() {
	const t = await getTranslate();
	let scope: Awaited<ReturnType<typeof requirePlatformAdminSession>>;
	try {
		scope = await requirePlatformAdminSession();
	} catch {
		return (
			<div className="space-y-6">
				<OverviewHeading />
				<OverviewReadFailure>
					{t("admin:admin.overview.accessUnavailable", "Platform access could not be confirmed.")}
				</OverviewReadFailure>
			</div>
		);
	}

	return (
		<OverviewSnapshot userId={scope.userId} sessionId={scope.sessionId} readId={randomUUID()}>
			<div className="min-w-0 space-y-8">
				<OverviewHeading />

				{/* Stats Grid */}
				<section aria-labelledby="platform-overview-metrics" className="space-y-3">
					<h2 id="platform-overview-metrics" className="text-sm font-semibold">
						{t("admin:admin.overview.metrics.title", "Platform Metrics")}
					</h2>
					<Suspense fallback={<DashboardStatsLoading />}>
						<DashboardStats />
					</Suspense>
				</section>

				{/* Analytics Preview */}
				<section aria-labelledby="platform-overview-analytics" className="space-y-3">
					<h2 id="platform-overview-analytics" className="text-sm font-semibold">
						{t("admin:admin.overview.analytics.title", "Analytics Trends")}
					</h2>
					<Suspense fallback={<DashboardAnalyticsPreviewLoading />}>
						<DashboardAnalyticsPreview />
					</Suspense>
				</section>

				{/* Quick Actions */}
				<section aria-labelledby="platform-overview-workflows" className="space-y-4">
					<h2 id="platform-overview-workflows" className="text-sm font-semibold">
						{t("admin:admin.overview.quickActions.title", "Quick Actions")}
					</h2>
					<div
						className={cn(
							"grid gap-6 md:grid-cols-2",
							env.BILLING_ENABLED === "true" && "xl:grid-cols-3",
						)}
					>
						<nav aria-labelledby="platform-overview-access" className="min-w-0 space-y-2">
							<h3
								id="platform-overview-access"
								className="text-sm font-medium text-muted-foreground"
							>
								{t("admin:admin.overview.groups.access", "Access management")}
							</h3>
							<div className="divide-y rounded-lg border bg-card p-1">
								<QuickActionCard
									title={t("admin:admin.overview.quickActions.users.title", "User Management")}
									description={t(
										"admin:admin.overview.quickActions.users.description",
										"Ban/unban users, manage sessions, view activity",
									)}
									href="/platform-admin/users"
									icon={<IconUserBolt className="size-5" aria-hidden="true" />}
								/>
								<QuickActionCard
									title={t(
										"admin:admin.overview.quickActions.organizations.title",
										"Organization Management",
									)}
									description={t(
										"admin:admin.overview.quickActions.organizations.description",
										"Suspend, delete, or review organizations",
									)}
									href="/platform-admin/organizations"
									icon={<IconBuilding className="size-5" aria-hidden="true" />}
								/>
							</div>
						</nav>
						<nav aria-labelledby="platform-overview-operations" className="min-w-0 space-y-2">
							<h3
								id="platform-overview-operations"
								className="text-sm font-medium text-muted-foreground"
							>
								{t("admin:admin.overview.groups.operations", "Platform operations")}
							</h3>
							<div className="divide-y rounded-lg border bg-card p-1">
								<QuickActionCard
									title={t(
										"admin:admin.overview.quickActions.diagnostics.title",
										"Deployment Diagnostics",
									)}
									description={t(
										"admin:admin.overview.quickActions.diagnostics.description",
										"Review safe config and app health checks",
									)}
									href="/platform-admin/diagnostics"
									icon={<IconActivityHeartbeat className="size-5" aria-hidden="true" />}
								/>
								<QuickActionCard
									title={t(
										"admin:admin.overview.quickActions.systemEmailTemplates.title",
										"System Email Templates",
									)}
									description={t(
										"admin:admin.overview.quickActions.systemEmailTemplates.description",
										"Edit platform-owned billing and system email copy",
									)}
									href="/platform-admin/system-email-templates"
									icon={<IconMailCog className="size-5" aria-hidden="true" />}
								/>
							</div>
						</nav>
						{env.BILLING_ENABLED === "true" ? (
							<nav aria-labelledby="platform-overview-billing" className="min-w-0 space-y-2">
								<h3
									id="platform-overview-billing"
									className="text-sm font-medium text-muted-foreground"
								>
									{t("admin:admin.overview.groups.billing", "Billing and subscriptions")}
								</h3>
								<div className="rounded-lg border bg-card p-1">
									<QuickActionCard
										title={t(
											"admin:admin.overview.quickActions.billing.title",
											"Billing & Subscriptions",
										)}
										description={t(
											"admin:admin.overview.quickActions.billing.description",
											"Revenue metrics and subscription status",
										)}
										href="/platform-admin/billing"
										icon={<IconCreditCard className="size-5" aria-hidden="true" />}
									/>
								</div>
							</nav>
						) : null}
					</div>
				</section>
			</div>
		</OverviewSnapshot>
	);
}

function AdminDashboardLoading() {
	return (
		<div className="space-y-8">
			<OverviewHeading />
			<LoadingRegion
				className="space-y-8"
				role="status"
				label={{
					labelKey: "common.loadingRegions.platformAdminOverview",
					labelDefault: "Loading platform admin overview",
				}}
			>
				<section className="space-y-4">
					<Skeleton aria-hidden="true" className="h-5 w-36" />
					<DashboardStatsLoading />
				</section>
				<section className="space-y-4">
					<Skeleton aria-hidden="true" className="h-5 w-36" />
					<DashboardAnalyticsPreviewLoading />
				</section>
			</LoadingRegion>
		</div>
	);
}

export default function AdminDashboardPage() {
	return (
		<Suspense fallback={<AdminDashboardLoading />}>
			<AdminDashboardContent />
		</Suspense>
	);
}
