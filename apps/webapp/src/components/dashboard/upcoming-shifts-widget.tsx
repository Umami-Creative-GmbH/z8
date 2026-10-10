"use client";

import { IconCalendarTime, IconChevronRight, IconClock, IconMapPin } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { getMyUpcomingShifts } from "@/app/[locale]/(app)/scheduling/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { UpcomingShift, UpcomingShifts } from "@/lib/scheduling/upcoming-shifts";
import { Link } from "@/navigation";
import { useShiftsEnabled } from "@/stores/organization-settings-store";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

/** The employee's next published shifts, shown while the organization plans shifts. */
export function UpcomingShiftsWidget() {
	const shiftsEnabled = useShiftsEnabled();
	if (!shiftsEnabled) return null;
	return <UpcomingShiftsWidgetContent />;
}

function UpcomingShiftsWidgetContent() {
	const { t } = useTranslate();
	const { data, loading, refreshing, refetch } = useWidgetData<UpcomingShifts>(
		() => getMyUpcomingShifts(),
		{ errorMessage: t("dashboard.upcoming-shifts.error", "Failed to load your upcoming shifts") },
	);

	if (!loading && !data) return null;

	return (
		<DashboardWidget id="upcoming-shifts">
			<WidgetCard
				title={t("dashboard.upcoming-shifts.title", "Upcoming Shifts")}
				description={t("dashboard.upcoming-shifts.description", "Your next planned shifts")}
				icon={<IconCalendarTime className="size-4 text-sky-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{data && (
					<div className="space-y-3">
						{data.shifts.length === 0 ? (
							<div className="rounded-xl border border-dashed p-4 text-center">
								<p className="font-medium text-sm">
									{t("dashboard.upcoming-shifts.empty", "No upcoming shifts")}
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{t(
										"dashboard.upcoming-shifts.empty-description",
										"Your next published shifts will show up here.",
									)}
								</p>
							</div>
						) : (
							<ul className="space-y-2">
								{data.shifts.map((shift) => (
									<li key={shift.id}>
										<UpcomingShiftRow shift={shift} today={data.today} />
									</li>
								))}
							</ul>
						)}

						<Button className="group w-full" variant="outline" asChild>
							<Link href="/scheduling">
								<IconCalendarTime className="mr-2 size-4 transition-transform group-hover:scale-110" />
								{t("dashboard.upcoming-shifts.view-schedule", "View schedule")}
							</Link>
						</Button>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}

function UpcomingShiftRow({ shift, today }: { shift: UpcomingShift; today: string }) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const date = parsePlainDate(shift.date);
	const daysUntil = date.since(parsePlainDate(today)).days;
	const place = [shift.locationName, shift.subareaName].filter(Boolean).join(" · ");
	const endsNextDay = shift.endTime <= shift.startTime;

	return (
		<Link
			href={`/scheduling?date=${shift.date}`}
			className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-[border-color,box-shadow] hover:border-primary/20 hover:shadow-md"
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium text-sm">
						{formatPlainDate(date, locale, "weekdayMonthDay")}
					</span>
					{daysUntil === 0 && (
						<Badge variant="secondary" className="shrink-0 text-xs">
							{t("dashboard.upcoming-shifts.today", "Today")}
						</Badge>
					)}
					{daysUntil === 1 && (
						<Badge variant="outline" className="shrink-0 text-xs">
							{t("dashboard.upcoming-shifts.tomorrow", "Tomorrow")}
						</Badge>
					)}
				</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
					<IconClock className="size-3 shrink-0" aria-hidden="true" />
					<span className="tabular-nums">
						{shift.startTime} – {shift.endTime}
					</span>
					{endsNextDay && (
						<span>({t("dashboard.upcoming-shifts.ends-next-day", "ends next day")})</span>
					)}
				</div>
				{place && (
					<div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
						<IconMapPin className="size-3 shrink-0" aria-hidden="true" />
						<span className="truncate">{place}</span>
					</div>
				)}
			</div>
			<IconChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</Link>
	);
}
