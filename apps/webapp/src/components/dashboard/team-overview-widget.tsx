"use client";

import { IconCalendar, IconLoader2, IconUserCheck, IconUsers } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { getTeamOverviewStats } from "@/components/dashboard/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Link } from "@/navigation";

interface TeamStats {
	totalEmployees: number;
	activeEmployees: number;
	teamsCount: number;
	avgWorkHours: number;
}

export function TeamOverviewWidget() {
	const [stats, setStats] = useState<TeamStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [currentEmployee, setCurrentEmployee] = useState<any>(null);

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setLoading(false);
				return;
			}
			setCurrentEmployee(current);

			// Only show for admins and managers
			if (current.role !== "admin" && current.role !== "manager") {
				setLoading(false);
				return;
			}

			// Fetch actual stats from database
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

	// Don't show widget if not manager/admin
	if (!loading && (!currentEmployee || (currentEmployee.role !== "admin" && currentEmployee.role !== "manager"))) {
		return null;
	}

	if (loading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconUsers className="size-5" />
						Team Overview
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!stats) {
		return null;
	}

	const activePercentage = (stats.activeEmployees / stats.totalEmployees) * 100;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<IconUsers className="size-5" />
							Team Overview
						</CardTitle>
						<CardDescription>
							Organization statistics and metrics
						</CardDescription>
					</div>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/settings/employees">Manage</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent>
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
							{stats.activeEmployees} of {stats.totalEmployees} employees active (
							{activePercentage.toFixed(0)}%)
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
			</CardContent>
		</Card>
	);
}
