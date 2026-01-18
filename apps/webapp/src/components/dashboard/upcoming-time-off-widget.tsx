"use client";

import { IconCalendar, IconCalendarEvent, IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { differenceInDays, format } from "@/lib/datetime/luxon-utils";
import { cn, pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getUpcomingAbsences } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type UpcomingAbsence = {
	id: string;
	startDate: Date;
	endDate: Date;
	employee: {
		user: {
			id: string;
			name: string | null;
			image: string | null;
		};
	};
	category: {
		name: string;
		color: string | null;
	};
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
				{isToday ? t("dashboard.upcoming-time-off.today", "Today") : isTomorrow ? t("dashboard.upcoming-time-off.tomorrow", "Tomorrow") : t("dashboard.upcoming-time-off.days", "days")}
			</span>
		</div>
	);
}

function AbsenceCard({ absence }: { absence: UpcomingAbsence }) {
	const { t } = useTranslate();
	const daysUntil = differenceInDays(new Date(absence.startDate), new Date());
	const duration = differenceInDays(new Date(absence.endDate), new Date(absence.startDate)) + 1;
	const name = absence.employee.user.name || t("common.unknown", "Unknown");

	return (
		<div className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-md hover:border-primary/20">
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
				/>

				<div className="flex-1 min-w-0">
					<div className="font-medium text-sm truncate">{name}</div>
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<IconCalendarEvent className="size-3" />
						<span>
							{format(new Date(absence.startDate), "MMM d")} -{" "}
							{format(new Date(absence.endDate), "MMM d")}
						</span>
					</div>
					<div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
						<IconClock className="size-3" />
						<span>
							{duration} {pluralize(duration, "day")}
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

export function UpcomingTimeOffWidget() {
	const { t } = useTranslate();
	const {
		data: absences,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<UpcomingAbsence[]>(() => getUpcomingAbsences(5), {
		errorMessage: t("dashboard.upcoming-time-off.error", "Failed to load upcoming time off"),
	});

	if (!loading && (!absences || absences.length === 0)) return null;

	return (
		<DashboardWidget id="upcoming-time-off">
			<WidgetCard
				title={t("dashboard.upcoming-time-off.title", "Upcoming Time Off")}
				description={
					absences
						? t("dashboard.upcoming-time-off.description-count", "Next {count} scheduled {absence}", { count: absences.length, absence: pluralize(absences.length, "absence") })
						: t("dashboard.upcoming-time-off.description", "Scheduled team absences")
				}
				icon={<IconCalendar className="size-4 text-indigo-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{absences && (
					<div className="space-y-3">
						{/* Timeline View */}
						<div className="space-y-2">
							{absences.map((absence) => (
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
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
