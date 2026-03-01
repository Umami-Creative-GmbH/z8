import {
	IconAlertTriangle,
	IconArrowUpRight,
	IconBuilding,
	IconChevronRight,
	IconCreditCard,
	IconCurrencyEuro,
	IconUserBolt,
	IconUsers,
	IconUserX,
} from "@tabler/icons-react";
import { count, eq, isNull, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { organizationSuspension, subscription } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

interface StatCardProps {
	title: string;
	value: number;
	description: string;
	icon: React.ReactNode;
	href: string;
	variant?: "default" | "warning" | "destructive" | "success";
}

function StatCard({ title, value, description, icon, href, variant = "default" }: StatCardProps) {
	const variantStyles = {
		default: "hover:border-border",
		warning: "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50",
		destructive: "border-red-500/30 bg-red-500/5 hover:border-red-500/50",
		success: "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50",
	};

	const iconStyles = {
		default: "bg-muted text-muted-foreground",
		warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
		destructive: "bg-red-500/10 text-red-600 dark:text-red-400",
		success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	};

	return (
		<Link href={href} className="group block">
			<Card
				className={cn(
					"relative overflow-hidden transition-all duration-200",
					"hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/20",
					variantStyles[variant],
				)}
			>
				<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
					<div
						className={cn(
							"flex size-10 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
							iconStyles[variant],
						)}
					>
						{icon}
					</div>
					<IconArrowUpRight
						className="size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-muted-foreground"
						aria-hidden="true"
					/>
				</CardHeader>
				<CardContent className="space-y-1">
					<div className="text-3xl font-bold tabular-nums tracking-tight">
						{value.toLocaleString()}
					</div>
					<div className="text-sm font-medium">{title}</div>
					<p className="text-xs text-muted-foreground">{description}</p>
				</CardContent>
			</Card>
		</Link>
	);
}

async function DashboardStats() {
	await connection();

	const t = await getTranslate();
	const billingEnabled = process.env.BILLING_ENABLED === "true";

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
							billingInterval: subscription.billingInterval,
							status: subscription.status,
						})
						.from(subscription)
						.where(sql`${subscription.status} IN ('active', 'trialing', 'past_due')`)
				: Promise.resolve([]),
		]);

	// Calculate billing stats from results
	const billingStats = {
		activeSubscriptions: subscriptions.length,
		totalSeats: subscriptions.reduce((sum, s) => sum + s.currentSeats, 0),
		// Calculate MRR: monthly = seats * 4, yearly = seats * 3
		mrr: subscriptions.reduce((sum, s) => {
			const pricePerSeat = s.billingInterval === "year" ? 3 : 4;
			return sum + s.currentSeats * pricePerSeat;
		}, 0),
	};

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard
				title={t("admin.overview.metrics.totalUsers", "Total Users")}
				value={totalUsers}
				description={t("admin.overview.metrics.totalUsersDescription", "Registered platform accounts")}
				icon={<IconUsers className="size-5" aria-hidden="true" />}
				href="/platform-admin/users"
			/>
			<StatCard
				title={t("admin.overview.metrics.bannedUsers", "Banned Users")}
				value={bannedUsers}
				description={t("admin.overview.metrics.bannedUsersDescription", "Restricted from access")}
				icon={<IconUserX className="size-5" aria-hidden="true" />}
				href="/platform-admin/users?status=banned"
				variant={bannedUsers > 0 ? "destructive" : "default"}
			/>
			<StatCard
				title={t("admin.overview.metrics.organizations", "Organizations")}
				value={totalOrgs}
				description={t("admin.overview.metrics.organizationsDescription", "Active workspaces")}
				icon={<IconBuilding className="size-5" aria-hidden="true" />}
				href="/platform-admin/organizations"
			/>
			<StatCard
				title={t("admin.overview.metrics.suspended", "Suspended")}
				value={suspendedOrgs}
				description={t("admin.overview.metrics.suspendedDescription", "Read-only organizations")}
				icon={<IconAlertTriangle className="size-5" aria-hidden="true" />}
				href="/platform-admin/organizations?status=suspended"
				variant={suspendedOrgs > 0 ? "warning" : "default"}
			/>
			{billingEnabled ? (
				<>
					<StatCard
						title={t("admin.overview.metrics.mrr", "MRR")}
						value={billingStats.mrr}
						description={t("admin.overview.metrics.mrrDescription", "Monthly recurring revenue (€)")}
						icon={<IconCurrencyEuro className="size-5" aria-hidden="true" />}
						href="/platform-admin/billing"
						variant="success"
					/>
					<StatCard
						title={t("admin.overview.metrics.licensedSeats", "Licensed Seats")}
						value={billingStats.totalSeats}
						description={t("admin.overview.metrics.licensedSeatsDescription", "Across all subscriptions")}
						icon={<IconCreditCard className="size-5" aria-hidden="true" />}
						href="/platform-admin/billing"
					/>
				</>
			) : null}
		</div>
	);
}

function DashboardStatsLoading() {
	const billingEnabled = process.env.BILLING_ENABLED === "true";
	const cardCount = billingEnabled ? 6 : 4;

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{[...Array(cardCount)].map((_, i) => (
				<Card key={i}>
					<CardHeader className="pb-3">
						<Skeleton className="size-10 rounded-lg" />
					</CardHeader>
					<CardContent className="space-y-2">
						<Skeleton className="h-8 w-20" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-3 w-32" />
					</CardContent>
				</Card>
			))}
		</div>
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
		<Link href={href} className="group block">
			<Card className="h-full transition-all duration-200 hover:border-border hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/20">
				<CardContent className="flex items-start gap-4 p-6">
					<div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
						{icon}
					</div>
					<div className="flex-1 space-y-1">
						<div className="flex items-center justify-between">
							<CardTitle className="text-base">{title}</CardTitle>
							<IconChevronRight
								className="size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground"
								aria-hidden="true"
							/>
						</div>
						<CardDescription className="text-sm">{description}</CardDescription>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}

export default async function AdminDashboardPage() {
	const t = await getTranslate();

	return (
		<div className="space-y-10">
			{/* Page Header */}
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("admin.overview.title", "Overview")}
				</h1>
				<p className="text-muted-foreground">
					{t("admin.overview.description", "Platform metrics and quick actions")}
				</p>
			</div>

			{/* Stats Grid */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
					{t("admin.overview.metrics.title", "Platform Metrics")}
				</h2>
				<Suspense fallback={<DashboardStatsLoading />}>
					<DashboardStats />
				</Suspense>
			</section>

			{/* Quick Actions */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
					{t("admin.overview.quickActions.title", "Quick Actions")}
				</h2>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<QuickActionCard
						title={t("admin.overview.quickActions.users.title", "User Management")}
						description={t("admin.overview.quickActions.users.description", "Ban/unban users, manage sessions, view activity")}
						href="/platform-admin/users"
						icon={<IconUserBolt className="size-5" />}
					/>
					<QuickActionCard
						title={t("admin.overview.quickActions.organizations.title", "Organization Management")}
						description={t("admin.overview.quickActions.organizations.description", "Suspend, delete, or review organizations")}
						href="/platform-admin/organizations"
						icon={<IconBuilding className="size-5" />}
					/>
					{process.env.BILLING_ENABLED === "true" && (
						<QuickActionCard
							title={t("admin.overview.quickActions.billing.title", "Billing & Subscriptions")}
							description={t("admin.overview.quickActions.billing.description", "Revenue metrics and subscription status")}
							href="/platform-admin/billing"
							icon={<IconCreditCard className="size-5" />}
						/>
					)}
				</div>
			</section>
		</div>
	);
}
