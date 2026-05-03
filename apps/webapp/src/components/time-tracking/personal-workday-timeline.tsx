"use client";

import {
	IconAlertTriangle,
	IconCalendar,
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineData,
	WorkdayTimelineItem,
	WorkdayTimelineResult,
	WorkdayTimelineSeverity,
	WorkdayTimelineWarningItem,
} from "@/app/[locale]/(app)/time-tracking/workday-timeline.types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PersonalWorkdayTimelineProps {
	result: WorkdayTimelineResult;
}

export function PersonalWorkdayTimeline({ result }: PersonalWorkdayTimelineProps) {
	const { t } = useTranslate();
	const selectedDate = result.success ? result.data.selectedDate : result.selectedDate;

	return (
		<Card>
			<CardHeader className="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1.5">
					<CardTitle>
						<h2 className="text-base font-semibold leading-none">
							{t("timeTracking.timeline.title", "Workday timeline")}
						</h2>
					</CardTitle>
					<CardDescription>{selectedDate.label}</CardDescription>
				</div>
				<DayPicker selectedDate={selectedDate} />
			</CardHeader>

			<CardContent>
				{result.success ? <TimelineContent result={result.data} /> : <UnavailableAlert />}
			</CardContent>
		</Card>
	);
}

function DayPicker({ selectedDate }: { selectedDate: SelectedWorkdayDate }) {
	const { t } = useTranslate();

	return (
		<nav aria-label={t("timeTracking.timeline.dayPicker", "Timeline day picker")}>
			<div className="flex items-center gap-1">
				<Button asChild size="sm" variant="outline">
					<Link
						aria-label={t("timeTracking.timeline.previousDay", "Previous day")}
						href={dayHref(selectedDate.previousDateKey)}
					>
						<IconChevronLeft aria-hidden="true" className="size-4" />
						<span className="sr-only">{t("timeTracking.timeline.previousDay", "Previous day")}</span>
					</Link>
				</Button>
				<Button asChild size="sm" variant="outline">
					<Link href={dayHref(selectedDate.todayDateKey)}>
						<IconCalendar aria-hidden="true" className="size-4" />
						{t("timeTracking.timeline.today", "Today")}
					</Link>
				</Button>
				<Button asChild size="sm" variant="outline">
					<Link
						aria-label={t("timeTracking.timeline.nextDay", "Next day")}
						href={dayHref(selectedDate.nextDateKey)}
					>
						<span className="sr-only">{t("timeTracking.timeline.nextDay", "Next day")}</span>
						<IconChevronRight aria-hidden="true" className="size-4" />
					</Link>
				</Button>
			</div>
		</nav>
	);
}

function TimelineContent({ result }: { result: WorkdayTimelineData }) {
	const hasContext = result.hasScheduledContext || result.hasRecordedActivity;
	const renderedWarningIds = new Set(result.dayWarnings.map((warning) => warning.id));
	const timelineItems = result.items.filter((item) => !renderedWarningIds.has(item.id));

	return (
		<div className="space-y-4">
			{result.dayWarnings.length > 0 && <WarningSummary warnings={result.dayWarnings} />}
			{timelineItems.length > 0 ? (
				<ol className="divide-y rounded-lg border">
					{timelineItems.map((item) => (
						<TimelineRow item={item} key={item.id} />
					))}
				</ol>
			) : (
				!hasContext && <EmptyState />
			)}
		</div>
	);
}

function WarningSummary({ warnings }: { warnings: WorkdayTimelineWarningItem[] }) {
	return (
		<div className="space-y-2">
			{warnings.map((warning) => (
				<WarningAlert key={warning.id} warning={warning} />
			))}
		</div>
	);
}

function WarningAlert({ warning }: { warning: WorkdayTimelineWarningItem }) {
	return (
		<Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
			<IconAlertTriangle aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
			<AlertTitle>{warning.title}</AlertTitle>
			<AlertDescription>
				{warning.subtitle && <p>{warning.subtitle}</p>}
				{warning.link && (
					<Link
						className="font-medium text-amber-900 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:text-amber-100 dark:focus-visible:ring-amber-400"
						href={warning.link.href}
					>
						{warning.link.label}
					</Link>
				)}
			</AlertDescription>
		</Alert>
	);
}

function TimelineRow({ item }: { item: WorkdayTimelineItem }) {
	const timeRange = getTimeRange(item);
	const content = <TimelineRowContent item={item} timeRange={timeRange} />;

	return (
		<li>
			{item.link ? (
				<Link
					className="block transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					href={item.link.href}
				>
					{content}
					<span className="sr-only"> {item.link.label}</span>
				</Link>
			) : (
				content
			)}
		</li>
	);
}

function TimelineRowContent({ item, timeRange }: { item: WorkdayTimelineItem; timeRange: string | null }) {
	return (
		<div className="flex gap-3 px-4 py-3">
			<div className={cn("mt-1 size-2.5 shrink-0 rounded-full", severityClassName(item.severity))} />
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="break-words font-medium text-sm leading-5">{item.title}</p>
					{item.badge && <Badge variant="secondary">{item.badge}</Badge>}
				</div>
				{timeRange && <p className="font-medium text-muted-foreground text-xs tabular-nums">{timeRange}</p>}
				{item.subtitle && (
					<p className="break-words text-muted-foreground text-sm leading-5">{item.subtitle}</p>
				)}
			</div>
		</div>
	);
}

function EmptyState() {
	const { t } = useTranslate();

	return (
		<div className="rounded-lg border border-dashed px-4 py-6 text-center">
			<p className="font-medium text-sm">
				{t("timeTracking.timeline.emptyTitle", "No activity recorded for this day.")}
			</p>
			<p className="mt-1 text-muted-foreground text-sm">
				{t(
					"timeTracking.timeline.emptyDescription",
					"There are no shifts, absences, or time entries for the selected day yet.",
				)}
			</p>
		</div>
	);
}

function UnavailableAlert() {
	const { t } = useTranslate();

	return (
		<Alert>
			<IconAlertTriangle aria-hidden="true" className="text-muted-foreground" />
			<AlertTitle>{t("timeTracking.timeline.unavailableTitle", "Timeline unavailable")}</AlertTitle>
			<AlertDescription>
				{t(
					"timeTracking.timeline.unavailableDescription",
					"Clocking time still works. Try refreshing this view later.",
				)}
			</AlertDescription>
		</Alert>
	);
}

function dayHref(dateKey: string) {
	return `/time-tracking?date=${encodeURIComponent(dateKey)}`;
}

function getTimeRange(item: WorkdayTimelineItem) {
	if (!item.startLabel && !item.endLabel) {
		return null;
	}

	return [item.startLabel, item.endLabel].filter(Boolean).join(" - ");
}

function severityClassName(severity: WorkdayTimelineSeverity | undefined) {
	switch (severity) {
		case "danger":
			return "bg-destructive";
		case "warning":
			return "bg-amber-500";
		default:
			return "bg-primary";
	}
}
