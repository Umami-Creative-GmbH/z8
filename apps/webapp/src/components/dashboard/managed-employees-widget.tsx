"use client";

import {
	IconArrowRight,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { EmployeeActivityText } from "@/components/employee-activity-text";
import { Button } from "@/components/ui/button";
import { type EmployeeClockStatus, UserAvatar } from "@/components/user-avatar";
import type { ManagedEmployee } from "@/lib/effect/services/manager.service";
import { useEmployeeClockStatuses } from "@/lib/query";
import { Link } from "@/navigation";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

type ManagedEmployeeCard = ManagedEmployee & {
	clockStatus?: EmployeeClockStatus;
	lastActivityAt?: string | null;
	lastActivityUtcOffsetMinutes?: number | null;
	/** A break in progress (#861). */
	breakStartedAt?: string | null;
	breakStartedZone?: string | null;
};

function EmployeeRow({ employee }: { employee: ManagedEmployeeCard }) {
	const { t } = useTranslate();
	const status =
		employee.clockStatus === "clocked-in"
			? t("presence.clockedIn", "Clocked in")
			: employee.clockStatus === "on-break"
				? t("presence.onBreak", "On break")
				: employee.clockStatus === "clocked-out"
					? t("presence.clockedOut", "Clocked out")
					: t("common.unknown", "Unknown");
	const activity = (
		<EmployeeActivityText
			lastActivityAt={employee.lastActivityAt ?? null}
			lastActivityUtcOffsetMinutes={
				employee.lastActivityUtcOffsetMinutes ?? null
			}
			breakStartedAt={employee.breakStartedAt}
			breakStartedZone={employee.breakStartedZone}
		/>
	);
	return (
		<tr className="border-b last:border-b-0">
			<td className="py-3 pr-3 align-top">
				<Link
					href={`/settings/employees/${employee.id}`}
					className="group/employee flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
				>
					<UserAvatar
						image={employee.user.image}
						seed={employee.user.id}
						name={employee.user.name}
						clockStatus={employee.clockStatus ?? "unknown"}
						size="md"
					/>
					<div className="min-w-0 flex-1">
						<div className="font-medium text-sm break-words group-hover/employee:text-primary transition-colors">
							{employee.user.name}
						</div>
						<p className="text-sm text-muted-foreground break-all">
							{employee.user.email}
						</p>
						{employee.position ? (
							<p className="text-sm text-muted-foreground">
								{employee.position}
							</p>
						) : null}
						<div className="mt-1 space-y-1 text-sm text-muted-foreground sm:hidden">
							{employee.team ? <p>{employee.team.name}</p> : null}
							<p>{status}</p>
							{activity}
						</div>
					</div>
					<IconArrowRight
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,translate] group-hover/employee:opacity-100 group-hover/employee:translate-x-1 group-focus-visible/employee:opacity-100"
					/>
				</Link>
			</td>
			<td className="hidden px-3 py-3 align-middle text-sm text-muted-foreground sm:table-cell">
				{employee.team?.name ?? "?"}
			</td>
			<td className="hidden px-3 py-3 align-middle text-sm text-muted-foreground sm:table-cell">
				{status}
			</td>
			<td className="hidden py-3 pl-3 align-middle sm:table-cell">
				{activity}
			</td>
		</tr>
	);
}

function EmptyState() {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col items-center justify-center py-8 text-center">
			<div className="relative">
				<div className="rounded-lg bg-muted p-2">
					<IconUsersGroup className="size-5 text-muted-foreground" />
				</div>
			</div>
			<p className="mt-4 text-sm font-medium">
				{t("dashboard.managed-employees.no-reports", "No direct reports yet")}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">
				{t(
					"dashboard.managed-employees.no-reports-description",
					"You'll see your team members here once assigned",
				)}
			</p>
		</div>
	);
}

export function ManagedEmployeesWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<
		DashboardWidgetData["managed-employees"]
	>;
} = {}) {
	const { t } = useTranslate();
	const managedEmployeesQuery = useDashboardWidget(
		"managed-employees",
		initialSnapshot,
	);
	const employees = managedEmployeesQuery.data?.employees ?? [];
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: true },
	);
	const employeesWithPresence = employees.map((employee) => {
		const activity = presence.getActivity(employee.id);
		return {
			...employee,
			clockStatus: presence.getStatus(employee.id),
			lastActivityAt: activity?.lastActivityAt ?? null,
			lastActivityUtcOffsetMinutes:
				activity?.lastActivityUtcOffsetMinutes ?? null,
			...presence.getBreak(employee.id),
		};
	});
	const isManager = managedEmployeesQuery.data?.isManager ?? false;
	const loading = managedEmployeesQuery.loading;
	const refreshing = managedEmployeesQuery.refreshing;

	const refetch = () => {
		managedEmployeesQuery.refetch();
	};

	if (!loading && !managedEmployeesQuery.error && !isManager) return null;

	return (
		<DashboardWidget id="managed-employees">
			<WidgetCard
				title={t("dashboard.managed-employees.title", "Your Team")}
				description={
					employees.length > 0
						? t(
								"dashboard.managed-employees.direct-reports",
								"{count} direct reports",
								{
									count: employees.length,
								},
							)
						: t(
								"dashboard.managed-employees.people-you-manage",
								"People you manage",
							)
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
				{managedEmployeesQuery.error ? (
					<WidgetReadError
						title={t("dashboard.managed-employees.title", "Your Team")}
						message={managedEmployeesQuery.error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : employees.length === 0 ? (
					<EmptyState />
				) : (
					<div className="space-y-3">
						<div className="overflow-x-auto">
							<table className="w-full text-left">
								<caption className="sr-only">
									{t("dashboard.managed-employees.title", "Your Team")}
								</caption>
								<thead className="border-y bg-muted/40 text-sm text-muted-foreground">
									<tr>
										<th scope="col" className="py-2 pr-3 font-medium">
											{t("dashboard.refresh.employee", "Employee")}
										</th>
										<th
											scope="col"
											className="hidden px-3 py-2 font-medium sm:table-cell"
										>
											{t("dashboard.refresh.team", "Team")}
										</th>
										<th
											scope="col"
											className="hidden px-3 py-2 font-medium sm:table-cell"
										>
											{t("dashboard.refresh.status", "Status")}
										</th>
										<th
											scope="col"
											className="hidden py-2 pl-3 font-medium sm:table-cell"
										>
											{t("dashboard.refresh.activity", "Latest activity")}
										</th>
									</tr>
								</thead>
								<tbody>
									{employeesWithPresence.slice(0, 4).map((emp) => (
										<EmployeeRow key={emp.id} employee={emp} />
									))}
								</tbody>
							</table>
						</div>

						{/* More indicator */}
						{employees.length > 4 && (
							<Button className="w-full" variant="outline" size="sm" asChild>
								<Link href="/settings/employees">
									<IconUserCheck className="mr-2 size-4" />
									{t(
										"dashboard.managed-employees.view-all-members",
										"View all {count} team members",
										{ count: employees.length },
									)}
								</Link>
							</Button>
						)}
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
