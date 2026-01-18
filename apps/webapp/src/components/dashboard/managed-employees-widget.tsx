"use client";

import {
	IconArrowRight,
	IconBriefcase,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getManagedEmployees } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

type ManagedEmployee = {
	id: string;
	position: string | null;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		name: string;
	} | null;
};

function EmployeeCard({ employee }: { employee: ManagedEmployee }) {
	return (
		<Link
			href={`/settings/employees/${employee.id}`}
			className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-md hover:border-primary/20"
		>
			{/* Avatar */}
			<div className="relative">
				<UserAvatar
					image={employee.user.image}
					seed={employee.user.id}
					name={employee.user.name}
					size="md"
				/>
				<div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
			</div>

			{/* Info */}
			<div className="flex-1 min-w-0">
				<div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
					{employee.user.name}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{employee.position ? (
						<>
							<IconBriefcase className="size-3" />
							<span className="truncate">{employee.position}</span>
						</>
					) : (
						<span className="truncate">{employee.user.email}</span>
					)}
				</div>
			</div>

			{/* Team Badge */}
			{employee.team && (
				<Badge variant="secondary" className="shrink-0 text-xs">
					{employee.team.name}
				</Badge>
			)}

			{/* Arrow */}
			<IconArrowRight className="size-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1" />
		</Link>
	);
}

function EmptyState() {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col items-center justify-center py-8 text-center">
			<div className="relative">
				<div className="rounded-full bg-gradient-to-br from-slate-100 to-slate-200 p-4 dark:from-slate-800 dark:to-slate-900">
					<IconUsersGroup className="size-8 text-slate-500" />
				</div>
			</div>
			<p className="mt-4 text-sm font-medium">{t("dashboard.managed-employees.no-reports", "No direct reports yet")}</p>
			<p className="mt-1 text-xs text-muted-foreground">
				{t("dashboard.managed-employees.no-reports-description", "You'll see your team members here once assigned")}
			</p>
		</div>
	);
}

function TeamSummary({ count }: { count: number }) {
	const { t } = useTranslate();
	return (
		<div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 p-3 text-white shadow-lg shadow-indigo-500/25">
			<div className="flex items-center justify-center rounded-full bg-white/20 p-2">
				<IconUsers className="size-5" />
			</div>
			<div className="flex-1">
				<p className="font-semibold">{t("dashboard.managed-employees.team-members", "{count} team members", { count })}</p>
				<p className="text-xs opacity-90">{t("dashboard.managed-employees.reporting-to-you", "reporting to you")}</p>
			</div>
		</div>
	);
}

export function ManagedEmployeesWidget() {
	const { t } = useTranslate();
	const [employees, setEmployees] = useState<ManagedEmployee[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [isManager, setIsManager] = useState(false);

	const loadData = useCallback(async (isRefresh = false) => {
		if (isRefresh) {
			setRefreshing(true);
		}

		const current = await getCurrentEmployee();
		if (!current) {
			setLoading(false);
			setRefreshing(false);
			return;
		}

		const result = await getManagedEmployees(current.id);
		if (result.success) {
			setEmployees(result.data);
			setIsManager(result.data.length > 0 || current.role === "admin");
		} else {
			toast.error(result.error);
		}

		setLoading(false);
		setRefreshing(false);
	}, []);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	if (!loading && !isManager) return null;

	return (
		<DashboardWidget id="managed-employees">
			<WidgetCard
				title={t("dashboard.managed-employees.title", "Your Team")}
				description={
					employees.length > 0
						? t("dashboard.managed-employees.direct-reports", "{count} direct reports", { count: employees.length })
						: t("dashboard.managed-employees.people-you-manage", "People you manage")
				}
				icon={<IconUsers className="size-4 text-indigo-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
				action={
					employees.length > 0 ? (
						<Button variant="ghost" size="sm" className="text-xs" asChild>
							<Link href="/settings/employees">
								{t("dashboard.managed-employees.view-all", "View All")}
								<IconArrowRight className="ml-1 size-3" />
							</Link>
						</Button>
					) : undefined
				}
			>
				{employees.length === 0 ? (
					<EmptyState />
				) : (
					<div className="space-y-3">
						{/* Team Summary */}
						<TeamSummary count={employees.length} />

						{/* Employee List */}
						<div className="space-y-2">
							{employees.slice(0, 4).map((emp) => (
								<EmployeeCard key={emp.id} employee={emp} />
							))}
						</div>

						{/* More indicator */}
						{employees.length > 4 && (
							<Button className="w-full" variant="outline" size="sm" asChild>
								<Link href="/settings/employees">
									<IconUserCheck className="mr-2 size-4" />
									{t("dashboard.managed-employees.view-all-members", "View all {count} team members", { count: employees.length })}
								</Link>
							</Button>
						)}
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
