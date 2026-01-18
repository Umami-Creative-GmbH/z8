"use client";

import { IconBeach, IconCalendar, IconCheck, IconSunHigh, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn, pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getWhosOutToday } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type AbsentEmployee = {
	id: string;
	userId: string;
	name: string;
	image: string | null;
	category: string;
	categoryColor: string | null;
	endsToday: boolean;
	returnDate: string;
};

type WhosOutData = {
	outToday: AbsentEmployee[];
	returningTomorrow: AbsentEmployee[];
	totalOut: number;
};

function AbsenceCard({ employee }: { employee: AbsentEmployee }) {
	const { t } = useTranslate();
	return (
		<div className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-md hover:border-primary/20">
			<div className="relative">
				<UserAvatar seed={employee.userId} image={employee.image} name={employee.name} size="sm" />
				<div
					className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background"
					style={{ backgroundColor: employee.categoryColor || "#94a3b8" }}
				/>
			</div>

			<div className="flex-1 min-w-0">
				<div className="font-medium text-sm truncate">{employee.name}</div>
				<div className="flex items-center gap-1 text-xs text-muted-foreground">
					{employee.endsToday ? (
						<span className="text-emerald-600 dark:text-emerald-400">{t("dashboard.whos-out.returns-tomorrow", "Returns tomorrow")}</span>
					) : (
						<span>{t("dashboard.whos-out.until-date", "Until {date}", { date: employee.returnDate })}</span>
					)}
				</div>
			</div>

			<Badge
				variant="secondary"
				className="shrink-0 text-xs font-medium"
				style={{
					backgroundColor: employee.categoryColor ? `${employee.categoryColor}20` : undefined,
					color: employee.categoryColor || undefined,
					borderColor: employee.categoryColor ? `${employee.categoryColor}40` : undefined,
				}}
			>
				{employee.category}
			</Badge>
		</div>
	);
}

function ReturningBadge({ employee }: { employee: AbsentEmployee }) {
	return (
		<div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 dark:bg-emerald-950/30">
			<div className="relative">
				<UserAvatar seed={employee.userId} image={employee.image} name={employee.name} size="xs" />
				<div className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 border border-background" />
			</div>
			<span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
				{employee.name.split(" ")[0]}
			</span>
		</div>
	);
}

function EmptyState() {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col items-center justify-center py-8 text-center">
			<div className="relative">
				<div className="rounded-full bg-gradient-to-br from-emerald-100 to-green-100 p-4 dark:from-emerald-900/30 dark:to-green-900/30">
					<IconSunHigh className="size-8 text-emerald-600 dark:text-emerald-400" />
				</div>
				<div className="absolute -right-1 -top-1 rounded-full bg-emerald-500 p-1">
					<IconCheck className="size-3 text-white" />
				</div>
			</div>
			<p className="mt-4 text-sm font-medium">{t("dashboard.whos-out.full-team", "Full team available!")}</p>
			<p className="mt-1 text-xs text-muted-foreground">{t("dashboard.whos-out.everyone-in", "Everyone is in the office today")}</p>
		</div>
	);
}

export function WhosOutTodayWidget() {
	const { t } = useTranslate();
	const { data, loading, refreshing, refetch } = useWidgetData<WhosOutData>(
		() => getWhosOutToday(),
		{
			errorMessage: t("dashboard.whos-out.error", "Failed to load today's absences"),
		},
	);

	const isEmpty = !loading && data && data.totalOut === 0;

	return (
		<DashboardWidget id="whos-out-today">
			<WidgetCard
				title={t("dashboard.whos-out.title", "Who's Out Today")}
				description={
					data
						? data.totalOut === 0
							? t("dashboard.whos-out.everyones-in", "Everyone's in!")
							: t("dashboard.whos-out.members-out", "{count} team {member} out", { count: data.totalOut, member: pluralize(data.totalOut, "member") })
						: t("dashboard.whos-out.team-availability", "Team availability")
				}
				icon={<IconUsers className="size-4 text-violet-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
				action={
					data && data.totalOut > 0 ? (
						<Badge
							variant="secondary"
							className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
						>
							{t("dashboard.whos-out.out-count", "{count} out", { count: data.totalOut })}
						</Badge>
					) : undefined
				}
			>
				{data && (
					<div className="space-y-4">
						{isEmpty ? (
							<EmptyState />
						) : (
							<>
								{/* Currently Out */}
								{data.outToday.length > 0 && (
									<div className="space-y-2">
										<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
											<IconBeach className="size-3.5 text-amber-500" />
											<span>{t("dashboard.whos-out.out-today", "Out Today")}</span>
											<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
												{data.outToday.length}
											</span>
										</div>
										<div className="space-y-2">
											{data.outToday.slice(0, 4).map((emp) => (
												<AbsenceCard key={emp.id} employee={emp} />
											))}
											{data.outToday.length > 4 && (
												<div className="flex items-center justify-center rounded-lg border border-dashed py-2 text-xs text-muted-foreground">
													{t("dashboard.whos-out.more-members", "+{count} more team members", { count: data.outToday.length - 4 })}
												</div>
											)}
										</div>
									</div>
								)}

								{/* Returning Tomorrow */}
								{data.returningTomorrow.length > 0 && (
									<div className="space-y-2">
										<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
											<IconCalendar className="size-3.5 text-emerald-500" />
											<span>{t("dashboard.whos-out.returning-tomorrow", "Returning Tomorrow")}</span>
										</div>
										<div className="flex flex-wrap gap-2">
											{data.returningTomorrow.slice(0, 4).map((emp) => (
												<ReturningBadge key={emp.id} employee={emp} />
											))}
											{data.returningTomorrow.length > 4 && (
												<div className="flex items-center rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
													+{data.returningTomorrow.length - 4}
												</div>
											)}
										</div>
									</div>
								)}
							</>
						)}

						<Button className="w-full group" variant="outline" size="sm" asChild>
							<Link href="/calendar">
								<IconCalendar className="mr-2 size-4 transition-transform group-hover:scale-110" />
								{t("dashboard.whos-out.view-calendar", "View Full Calendar")}
							</Link>
						</Button>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
