import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
	IconCurrencyEuro,
	IconUsers,
	IconBuilding,
	IconClock,
	IconAlertTriangle,
	IconCheck,
	IconArrowLeft,
} from "@tabler/icons-react";
import { count, eq, sql, and, gte, lte } from "drizzle-orm";
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

export default function AdminBillingPage() {
	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		redirect("/admin");
	}

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-4">
				<Link
					href="/admin"
					className="text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft className="size-5" />
				</Link>
				<div>
					<h1 className="text-3xl font-bold">Billing Dashboard</h1>
					<p className="text-muted-foreground mt-1">
						Monitor subscriptions, revenue, and payment status across all organizations
					</p>
				</div>
			</div>

			<Suspense fallback={<BillingStatsLoading />}>
				<BillingStats />
			</Suspense>

			<Suspense fallback={<SubscriptionsTableLoading />}>
				<SubscriptionsTable />
			</Suspense>
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
		default: "",
		warning: "border-yellow-500/50",
		success: "border-green-500/50",
	};

	return (
		<Card className={variantStyles[variant]}>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
				<div className="text-muted-foreground">{icon}</div>
			</CardHeader>
			<CardContent>
				<div className="text-3xl font-bold tabular-nums">{value}</div>
				<p className="text-xs text-muted-foreground mt-1">{description}</p>
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
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
				description="Total seats across subscriptions"
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
				description="Subscriptions with payment issues"
				icon={<IconAlertTriangle className="size-5" aria-hidden="true" />}
				variant={pastDueCount > 0 ? "warning" : "default"}
			/>
			<StatCard
				title="Trial Conversion"
				value={`${conversionRate}%`}
				description="Trials converted to paid"
				icon={<IconCheck className="size-5" aria-hidden="true" />}
			/>
			<StatCard
				title="Currently Trialing"
				value={trialingCount}
				description="Organizations in trial period"
				icon={<IconClock className="size-5" aria-hidden="true" />}
			/>
		</div>
	);
}

function BillingStatsLoading() {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{[...Array(6)].map((_, i) => (
				<Card key={i}>
					<CardHeader className="pb-2">
						<Skeleton className="h-4 w-24" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-8 w-16" />
						<Skeleton className="h-3 w-32 mt-2" />
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
			<CardHeader>
				<CardTitle>Recent Subscriptions</CardTitle>
				<CardDescription>
					Latest subscription activity across all organizations
				</CardDescription>
			</CardHeader>
			<CardContent>
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
			<CardHeader>
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-64 mt-1" />
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{[...Array(5)].map((_, i) => (
						<Skeleton key={i} className="h-12 w-full" />
					))}
				</div>
			</CardContent>
		</Card>
	);
}
