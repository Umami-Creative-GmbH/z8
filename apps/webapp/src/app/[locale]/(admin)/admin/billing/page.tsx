import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
	IconCurrencyEuro,
	IconUsers,
	IconBuilding,
	IconClock,
	IconAlertTriangle,
	IconTrendingUp,
} from "@tabler/icons-react";
import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { subscription } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function AdminBillingPage() {
	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		redirect("/admin");
	}

	return (
		<div className="space-y-10">
			{/* Page Header */}
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">Billing Dashboard</h1>
				<p className="text-muted-foreground">
					Monitor subscriptions, revenue, and payment status
				</p>
			</div>

			{/* Stats */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
					Revenue Metrics
				</h2>
				<Suspense fallback={<BillingStatsLoading />}>
					<BillingStats />
				</Suspense>
			</section>

			{/* Subscriptions Table */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
					Recent Subscriptions
				</h2>
				<Suspense fallback={<SubscriptionsTableLoading />}>
					<SubscriptionsTable />
				</Suspense>
			</section>
		</div>
	);
}

interface StatCardProps {
	title: string;
	value: string | number;
	description: string;
	icon: React.ReactNode;
	variant?: "default" | "warning" | "success";
}

function StatCard({ title, value, description, icon, variant = "default" }: StatCardProps) {
	const variantStyles = {
		default: "hover:border-border",
		warning: "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50",
		success: "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50",
	};

	const iconStyles = {
		default: "bg-muted text-muted-foreground",
		warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
		success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	};

	return (
		<Card
			className={cn(
				"transition-all duration-200 hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/20",
				variantStyles[variant],
			)}
		>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
				<div
					className={cn(
						"flex size-10 items-center justify-center rounded-lg",
						iconStyles[variant],
					)}
				>
					{icon}
				</div>
			</CardHeader>
			<CardContent className="space-y-1">
				<div className="text-3xl font-bold tabular-nums tracking-tight">{value}</div>
				<div className="text-sm font-medium">{title}</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

async function BillingStats() {
	await connection();

	// Get all subscriptions
	const allSubscriptions = await db
		.select({
			status: subscription.status,
			currentSeats: subscription.currentSeats,
			billingInterval: subscription.billingInterval,
			trialEnd: subscription.trialEnd,
		})
		.from(subscription);

	// Calculate metrics
	const activeSubscriptions = allSubscriptions.filter(
		(s) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
	);

	const totalSeats = activeSubscriptions.reduce((sum, s) => sum + s.currentSeats, 0);

	// MRR calculation: monthly = seats * 4, yearly = seats * 3
	const mrr = activeSubscriptions.reduce((sum, s) => {
		const pricePerSeat = s.billingInterval === "year" ? 3 : 4;
		return sum + s.currentSeats * pricePerSeat;
	}, 0);

	// Trialing count
	const trialingCount = allSubscriptions.filter((s) => s.status === "trialing").length;

	// Past due count
	const pastDueCount = allSubscriptions.filter((s) => s.status === "past_due").length;

	// Trial conversion rate (trials that converted to active)
	const now = DateTime.now();
	const thirtyDaysAgo = now.minus({ days: 30 });

	// Count subscriptions that were trialing and are now active
	const activeCount = allSubscriptions.filter((s) => s.status === "active").length;
	const totalTrialsAndActive = trialingCount + activeCount;
	const conversionRate = totalTrialsAndActive > 0
		? Math.round((activeCount / totalTrialsAndActive) * 100)
		: 0;

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
			<StatCard
				title="MRR"
				value={`€${mrr.toLocaleString()}`}
				description="Monthly recurring revenue"
				icon={<IconCurrencyEuro className="size-5" aria-hidden="true" />}
				variant="success"
			/>
			<StatCard
				title="Licensed Seats"
				value={totalSeats}
				description="Across all subscriptions"
				icon={<IconUsers className="size-5" aria-hidden="true" />}
			/>
			<StatCard
				title="Active Subscriptions"
				value={activeSubscriptions.length}
				description={`${trialingCount} trialing, ${activeCount} paid`}
				icon={<IconBuilding className="size-5" aria-hidden="true" />}
			/>
			<StatCard
				title="Past Due"
				value={pastDueCount}
				description="Payment issues"
				icon={<IconAlertTriangle className="size-5" aria-hidden="true" />}
				variant={pastDueCount > 0 ? "warning" : "default"}
			/>
			<StatCard
				title="Conversion Rate"
				value={`${conversionRate}%`}
				description="Trials to paid"
				icon={<IconTrendingUp className="size-5" aria-hidden="true" />}
			/>
			<StatCard
				title="Trialing"
				value={trialingCount}
				description="In trial period"
				icon={<IconClock className="size-5" aria-hidden="true" />}
			/>
		</div>
	);
}

function BillingStatsLoading() {
	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
			{[...Array(6)].map((_, i) => (
				<Card key={i}>
					<CardHeader className="pb-3">
						<Skeleton className="size-10 rounded-lg" />
					</CardHeader>
					<CardContent className="space-y-2">
						<Skeleton className="h-8 w-20" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-3 w-28" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

async function SubscriptionsTable() {
	await connection();

	// Fetch subscriptions and organizations in parallel (async-parallel)
	// Note: We fetch all orgs since we don't know IDs upfront, but this is
	// still better than sequential fetches. For large datasets, consider
	// using a JOIN or subquery instead.
	const [subscriptions, allOrgs] = await Promise.all([
		db
			.select({
				id: subscription.id,
				organizationId: subscription.organizationId,
				status: subscription.status,
				currentSeats: subscription.currentSeats,
				billingInterval: subscription.billingInterval,
				trialEnd: subscription.trialEnd,
				currentPeriodEnd: subscription.currentPeriodEnd,
				createdAt: subscription.createdAt,
			})
			.from(subscription)
			.orderBy(sql`${subscription.createdAt} DESC`)
			.limit(50),
		db.select({ id: organization.id, name: organization.name }).from(organization),
	]);

	// Filter to only needed orgs
	const orgIds = new Set(subscriptions.map((s) => s.organizationId));
	const orgs = allOrgs.filter((o) => orgIds.has(o.id));

	const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "trialing":
				return <Badge variant="default">Trial</Badge>;
			case "active":
				return <Badge variant="default" className="bg-green-600">Active</Badge>;
			case "past_due":
				return <Badge variant="destructive">Past Due</Badge>;
			case "canceled":
				return <Badge variant="secondary">Canceled</Badge>;
			default:
				return <Badge variant="outline">{status}</Badge>;
		}
	};

	const formatDate = (date: Date | null) => {
		if (!date) return "—";
		return DateTime.fromJSDate(date).toLocaleString(DateTime.DATE_MED);
	};

	return (
		<Card>
			<CardContent className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Organization</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Seats</TableHead>
							<TableHead>Billing</TableHead>
							<TableHead>Period End</TableHead>
							<TableHead>Created</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{subscriptions.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									No subscriptions yet
								</TableCell>
							</TableRow>
						) : (
							subscriptions.map((sub) => (
								<TableRow key={sub.id}>
									<TableCell className="font-medium">
										{orgMap.get(sub.organizationId) || sub.organizationId.slice(0, 8)}
									</TableCell>
									<TableCell>{getStatusBadge(sub.status)}</TableCell>
									<TableCell className="text-right tabular-nums">{sub.currentSeats}</TableCell>
									<TableCell className="capitalize">{sub.billingInterval || "—"}</TableCell>
									<TableCell>
										{sub.status === "trialing"
											? formatDate(sub.trialEnd)
											: formatDate(sub.currentPeriodEnd)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(sub.createdAt)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function SubscriptionsTableLoading() {
	return (
		<Card>
			<CardContent className="p-6 space-y-3">
				{[...Array(5)].map((_, i) => (
					<Skeleton key={i} className="h-14 w-full rounded-lg" />
				))}
			</CardContent>
		</Card>
	);
}
