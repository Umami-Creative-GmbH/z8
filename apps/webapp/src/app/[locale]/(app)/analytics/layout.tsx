import { IconCalendar, IconChartBar, IconChartLine, IconUsers } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { Link } from "@/navigation";

async function getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	return await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});
}

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view analytics" />
			</div>
		);
	}

	// Role-based access control: Only admins and managers can access analytics
	if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<div className="text-center">
					<h2 className="text-2xl font-bold">Access Restricted</h2>
					<p className="mt-2 text-muted-foreground">
						Analytics is only available to administrators and managers.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
				<p className="text-muted-foreground">
					Comprehensive insights into team performance, work hours, and absence patterns
				</p>
			</div>

			{/* Sub-navigation Tabs */}
			<div className="px-4 lg:px-6">
				<Tabs defaultValue="overview" className="w-full">
					<TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
						<TabsTrigger value="overview" asChild>
							<Link href="/analytics">
								<IconChartBar className="mr-2 size-4" />
								Overview
							</Link>
						</TabsTrigger>
						<TabsTrigger value="team-performance" asChild>
							<Link href="/analytics/team-performance">
								<IconUsers className="mr-2 size-4" />
								Team Performance
							</Link>
						</TabsTrigger>
						<TabsTrigger value="vacation-trends" asChild>
							<Link href="/analytics/vacation-trends">
								<IconCalendar className="mr-2 size-4" />
								Vacation Trends
							</Link>
						</TabsTrigger>
						<TabsTrigger value="work-hours" asChild>
							<Link href="/analytics/work-hours">
								<IconChartLine className="mr-2 size-4" />
								Work Hours
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
