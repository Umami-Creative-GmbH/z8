"use client";

import { IconCalendar, IconCalendarEvent, IconClock } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type EmployeeClockStatus, UserAvatar } from "@/components/user-avatar";
import { useEmployeeClockStatuses } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type { DashboardWidgetData, DashboardWidgetSnapshot } from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { formatDashboardDate } from "./format-dashboard-date";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

type UpcomingAbsence = DashboardWidgetData["upcoming-time-off"][number] & {
	clockStatus?: EmployeeClockStatus;
};

function TimelineMarker({ daysUntil }: { daysUntil: number }) {
	const { t } = useTranslate();
	const isToday = daysUntil === 0;
	const isTomorrow = daysUntil === 1;
	const isSoon = daysUntil <= 3;

	return (
		<div className="flex flex-col items-center">
			<div
				className={cn(
					"flex size-10 items-center justify-center rounded-xl font-bold text-sm",
					isToday
						? "bg-gradient-to-br from-red-500 to-orange-500 text-white shadow-lg shadow-red-500/25"
						: isTomorrow
							? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25"
							: isSoon
								? "bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25"
								: "bg-muted text-muted-foreground",
				)}
			>
				{isToday ? "!" : isTomorrow ? "1" : daysUntil}
			</div>
			<span
				className={cn(
					"mt-1 text-[10px] font-medium",
					isToday
						? "text-red-600 dark:text-red-400"
						: isTomorrow
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground",
				)}
			>
				{isToday
					? t("dashboard.upcoming-time-off.today", "Today")
					: isTomorrow
						? t("dashboard.upcoming-time-off.tomorrow", "Tomorrow")
						: t("dashboard.upcoming-time-off.days", "days")}
			</span>
		</div>
	);
}

function AbsenceCard({ absence }: { absence: UpcomingAbsence }) {
	const { t } = useTranslate();
	const tolgee = useTolgee();
	const locale = tolgee.getLanguage() || "en";
	const daysUntil = absence.daysUntil;
	const duration = absence.absenceDays;
	const name = absence.employee.user.name || t("common.unknown", "Unknown");
	const durationLabel =
		duration === 1
			? t("dashboard.upcoming-time-off.day", "day")
			: t("dashboard.upcoming-time-off.days", "days");

	return (
		<div className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-[border-color,box-shadow] hover:shadow-md hover:border-primary/20">
			{/* Timeline Marker */}
			<TimelineMarker daysUntil={Math.max(0, daysUntil)} />

			{/* Connector Line */}
			<div className="mt-5 h-px w-3 bg-border" />

			{/* Content */}
			<div className="flex flex-1 items-center gap-3 min-w-0">
				<UserAvatar
					seed={absence.employee.user.id}
					image={absence.employee.user.image}
					name={name}
					size="sm"
					clockStatus={absence.clockStatus ?? "unknown"}
				/>

				<div className="flex-1 min-w-0">
					<div className="font-medium text-sm truncate">{name}</div>
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<IconCalendarEvent className="size-3" />
						<span>
							{formatDashboardDate(absence.startDate, locale)} -{" "}
							{formatDashboardDate(absence.endDate, locale)}
						</span>
					</div>
					<div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
						<IconClock className="size-3" />
						<span>
							{new Intl.NumberFormat(locale).format(duration)} {durationLabel}
						</span>
					</div>
				</div>

				{/* Category Badge */}
				<Badge
					variant="secondary"
					className="shrink-0 text-xs font-medium"
					style={{
						backgroundColor: absence.category.color ? `${absence.category.color}20` : undefined,
						color: absence.category.color || undefined,
						borderColor: absence.category.color ? `${absence.category.color}40` : undefined,
					}}
				>
					{absence.category.name}
				</Badge>
			</div>
		</div>
	);
}

export function UpcomingTimeOffWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["upcoming-time-off"]>;
} = {}) {
	const { t } = useTranslate();
	const {
		data: absences,
		loading,
		refreshing,
		refetch,
		error,
	} = useDashboardWidget("upcoming-time-off", initialSnapshot);
	const presence = useEmployeeClockStatuses(absences?.map((absence) => absence.employee.id) ?? [], {
		polling: false,
	});
	const absencesWithPresence = absences?.map((absence) => ({
		...absence,
		clockStatus: presence.getStatus(absence.employee.id),
	}));

	return (
		<DashboardWidget id="upcoming-time-off">
			<WidgetCard
				title={t("dashboard.upcoming-time-off.title", "Upcoming Time Off")}
				description={
					absences
						? t(
								"dashboard.upcoming-time-off.description-count",
								"Next {count} scheduled {absence}",
								{
									count: absences.length,
									absence:
										absences.length === 1
											? t("dashboard.upcoming-time-off.absence", "absence")
											: t("dashboard.upcoming-time-off.absences", "absences"),
								},
							)
						: t("dashboard.upcoming-time-off.description", "Scheduled team absences")
				}
				icon={<IconCalendar className="size-4 text-indigo-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ? (
					<WidgetReadError
						title={t("dashboard.upcoming-time-off.title", "Upcoming Time Off")}
						message={error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : !loading && absences?.length === 0 ? (
					<p role="status">{t("dashboard.upcoming-time-off.empty", "No upcoming time off")}</p>
				) : (
					absencesWithPresence && (
						<div className="space-y-3">
							{/* Timeline View */}
							<div className="space-y-2">
								{absencesWithPresence.map((absence) => (
									<AbsenceCard key={absence.id} absence={absence} />
								))}
							</div>

							{/* Action Button */}
							<Button className="w-full group" variant="outline" asChild>
								<Link href="/calendar">
									<IconCalendar className="mr-2 size-4 transition-transform group-hover:scale-110" />
									{t("dashboard.upcoming-time-off.view-calendar", "View Full Calendar")}
								</Link>
							</Button>
						</div>
					)
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
