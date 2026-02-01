import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
	IconBuilding,
	IconUsers,
	IconUserX,
	IconAlertTriangle,
} from "@tabler/icons-react";
import { count, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { user, organization } from "@/db/auth-schema";
import { organizationSuspension } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
	title: string;
	value: number;
	description: string;
	icon: React.ReactNode;
	href: string;
	variant?: "default" | "warning" | "destructive";
}

function StatCard({ title, value, description, icon, href, variant = "default" }: StatCardProps) {
	const variantStyles = {
		default: "",
		warning: "border-yellow-500/50",
		destructive: "border-red-500/50",
	};

	return (
		<Link href={href}>
			<Card className={`hover:bg-accent/50 transition-colors cursor-pointer ${variantStyles[variant]}`}>
				<CardHeader className="flex flex-row items-center justify-between pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
					<div className="text-muted-foreground">{icon}</div>
				</CardHeader>
				<CardContent>
					<div className="text-3xl font-bold tabular-nums">{value.toLocaleString()}</div>
					<p className="text-xs text-muted-foreground mt-1">{description}</p>
				</CardContent>
			</Card>
		</Link>
	);
}

async function DashboardStats() {
	await connection();

	// Get total users count
	const [{ totalUsers }] = await db
		.select({ totalUsers: count() })
		.from(user);

	// Get banned users count
	const [{ bannedUsers }] = await db
		.select({ bannedUsers: count() })
		.from(user)
		.where(eq(user.banned, true));

	// Get total organizations count (excluding deleted)
	const [{ totalOrgs }] = await db
		.select({ totalOrgs: count() })
		.from(organization)
		.where(isNull(organization.deletedAt));

	// Get suspended organizations count
	const [{ suspendedOrgs }] = await db
		.select({ suspendedOrgs: count() })
		.from(organizationSuspension)
		.where(eq(organizationSuspension.isActive, true));

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<StatCard
				title="Total Users"
				value={totalUsers}
				description="All registered users on the platform"
				icon={<IconUsers className="size-5" aria-hidden="true" />}
				href="/admin/users"
			/>
			<StatCard
				title="Banned Users"
				value={bannedUsers}
				description="Users currently banned from the platform"
				icon={<IconUserX className="size-5" aria-hidden="true" />}
				href="/admin/users?status=banned"
				variant={bannedUsers > 0 ? "destructive" : "default"}
			/>
			<StatCard
				title="Organizations"
				value={totalOrgs}
				description="Active organizations on the platform"
				icon={<IconBuilding className="size-5" aria-hidden="true" />}
				href="/admin/organizations"
			/>
			<StatCard
				title="Suspended Orgs"
				value={suspendedOrgs}
				description="Organizations in read-only mode"
				icon={<IconAlertTriangle className="size-5" aria-hidden="true" />}
				href="/admin/organizations?status=suspended"
				variant={suspendedOrgs > 0 ? "warning" : "default"}
			/>
		</div>
	);
}

function DashboardStatsLoading() {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{[...Array(4)].map((_, i) => (
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

export default function AdminDashboardPage() {
	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold">Platform Admin Dashboard</h1>
				<p className="text-muted-foreground mt-1">
					Manage users, organizations, and platform-wide settings
				</p>
			</div>

			<Suspense fallback={<DashboardStatsLoading />}>
				<DashboardStats />
			</Suspense>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>User Management</CardTitle>
						<CardDescription>
							Ban/unban users, manage sessions, and view user activity
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Link
							href="/admin/users"
							className="text-primary hover:underline text-sm font-medium"
						>
							Manage Users →
						</Link>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Organization Management</CardTitle>
						<CardDescription>
							View org usage, suspend orgs, or delete organizations
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Link
							href="/admin/organizations"
							className="text-primary hover:underline text-sm font-medium"
						>
							Manage Organizations →
						</Link>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
