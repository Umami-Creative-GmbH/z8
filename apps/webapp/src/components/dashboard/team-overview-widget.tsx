"use client";

import { IconCalendar, IconUserCheck, IconUsers } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { getTeamOverviewStats } from "@/components/dashboard/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "@/navigation";
import { WidgetCard } from "./widget-card";

interface TeamStats {
	totalEmployees: number;
	activeEmployees: number;
	teamsCount: number;
	avgWorkHours: number;
}

type EmployeeRole = "admin" | "manager" | "employee";

export function TeamOverviewWidget() {
	const [stats, setStats] = useState<TeamStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [role, setRole] = useState<EmployeeRole | null>(null);

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setLoading(false);
				return;
			}

			setRole(current.role);

			if (current.role !== "admin" && current.role !== "manager") {
				setLoading(false);
				return;
			}

			const result = await getTeamOverviewStats();
			if (result.success && result.data) {
				setStats(result.data);
			} else {
				toast.error("Failed to load team statistics");
			}

			setLoading(false);
		}

		loadData();
	}, []);

	if (!loading && (!role || (role !== "admin" && role !== "manager"))) {
		return null;
	}

	if (!loading && !stats) return null;

	const activePercentage = stats
		? (stats.activeEmployees / stats.totalEmployees) * 100
		: 0;

	return (
		<WidgetCard
			title="Team Overview"
			description="Organization statistics and metrics"
			icon={<IconUsers className="size-4 text-muted-foreground" />}
			loading={loading}
			action={
				<Button variant="ghost" size="sm" asChild>
					<Link href="/settings/employees">Manage</Link>
				</Button>
			}
		>
			{stats && (
				<div className="space-y-6">
					{/* Employee Count */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconUserCheck className="size-4 text-muted-foreground" />
								<span className="text-sm font-medium">Active Employees</span>
							</div>
							<span className="text-2xl font-bold">{stats.activeEmployees}</span>
						</div>
						<Progress value={activePercentage} className="h-2" />
						<p className="text-xs text-muted-foreground">
							{stats.activeEmployees} of {stats.totalEmployees} employees active
							({activePercentage.toFixed(0)}%)
						</p>
					</div>

					{/* Teams Count */}
					<div className="rounded-lg border p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconUsers className="size-4 text-muted-foreground" />
								<span className="text-sm font-medium">Teams</span>
							</div>
							<Badge variant="secondary" className="text-lg">
								{stats.teamsCount}
							</Badge>
						</div>
					</div>

					{/* Average Work Hours */}
					<div className="rounded-lg border p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconCalendar className="size-4 text-muted-foreground" />
								<span className="text-sm font-medium">Avg. Work Hours</span>
							</div>
							<span className="text-lg font-semibold">
								{stats.avgWorkHours}h/week
							</span>
						</div>
					</div>

					{/* Quick Actions */}
					<div className="grid grid-cols-2 gap-2 pt-2">
						<Button variant="outline" size="sm" asChild>
							<Link href="/settings/teams">
								<IconUsers className="mr-2 size-4" />
								Teams
							</Link>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link href="/settings/employees">
								<IconUserCheck className="mr-2 size-4" />
								Employees
							</Link>
						</Button>
					</div>
				</div>
			)}
		</WidgetCard>
	);
}
