"use client";

import {
	IconAlertTriangle,
	IconCalendar,
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import type {
	WorkdayTimelineData,
	WorkdayTimelineItemType,
	WorkdayTimelineLink,
	WorkdayTimelineSeverity,
} from "@/app/[locale]/(app)/time-tracking/workday-timeline.types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { workPeriodFocusTargetId } from "@/lib/time-tracking/period-submissions/blocker-navigation";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

export interface SerializableSelectedWorkdayDate {
	dateKey: string;
	todayDateKey: string;
	previousDateKey: string;
	nextDateKey: string;
	label: string;
}

export type SerializableWorkdayTimelineData = Omit<
	WorkdayTimelineData,
	"selectedDate" | "items" | "dayWarnings"
> & {
	selectedDate: SerializableSelectedWorkdayDate;
	items: SerializableWorkdayTimelineItem[];
	dayWarnings: SerializableWorkdayTimelineItem[];
};

export interface SerializableWorkdayTimelineItem {
	id: string;
	type: WorkdayTimelineItemType;
	title: string;
	titleKey?: string;
	subtitle?: string;
	subtitleKey?: string;
	subtitleParams?: Record<string, string | number>;
	startLabel?: string;
	endLabel?: string;
	badge?: string;
	badgeKey?: string;
	severity?: WorkdayTimelineSeverity;
	link?: WorkdayTimelineLink;
	/** A work entry's work period, which a period blocker link focuses (#1349). */
	workPeriodId?: string;
}

export type SerializableWorkdayTimelineResult =
	| { success: true; data: SerializableWorkdayTimelineData }
	| {
			success: false;
			selectedDate: SerializableSelectedWorkdayDate;
			error: string;
	  };

interface PersonalWorkdayTimelineProps {
	result: SerializableWorkdayTimelineResult;
}

export function PersonalWorkdayTimeline({ result }: PersonalWorkdayTimelineProps) {
	const { t } = useTranslate();
	const locale = useLocale();
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
					<CardDescription>
						{Temporal.PlainDate.from(selectedDate.dateKey).toLocaleString(locale, {
							dateStyle: "long",
						})}
					</CardDescription>
				</div>
				<DayPicker selectedDate={selectedDate} />
			</CardHeader>

			<CardContent>
				{result.success ? <TimelineContent result={result.data} /> : <UnavailableAlert />}
			</CardContent>
		</Card>
	);
}

function DayPicker({ selectedDate }: { selectedDate: SerializableSelectedWorkdayDate }) {
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
						<span className="sr-only">
							{t("timeTracking.timeline.previousDay", "Previous day")}
						</span>
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

function TimelineContent({ result }: { result: SerializableWorkdayTimelineData }) {
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
				<EmptyState />
			)}
		</div>
	);
}

function WarningSummary({ warnings }: { warnings: SerializableWorkdayTimelineItem[] }) {
	return (
		<div className="space-y-2">
			{warnings.map((warning) => (
				<WarningAlert key={warning.id} warning={warning} />
			))}
		</div>
	);
}

/** A timeline item's copy in the viewer's language; unkeyed copy is user content shown as is. */
function useItemText(item: SerializableWorkdayTimelineItem) {
	const { t } = useTranslate();
	const locale = useLocale();
	const subtitleParams = item.subtitleParams
		? Object.fromEntries(
				Object.entries(item.subtitleParams).map(([name, value]) => [
					name,
					typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
						? Temporal.PlainDate.from(value).toLocaleString(locale, {
								dateStyle: "medium",
							})
						: value,
				]),
			)
		: undefined;

	return {
		title: item.titleKey ? t(item.titleKey, item.title) : item.title,
		subtitle:
			item.subtitle && item.subtitleKey
				? t(item.subtitleKey, item.subtitle, subtitleParams)
				: item.subtitle,
		badge: item.badge && item.badgeKey ? t(item.badgeKey, item.badge) : item.badge,
		linkLabel: item.link?.labelKey ? t(item.link.labelKey, item.link.label) : item.link?.label,
	};
}

function WarningAlert({ warning }: { warning: SerializableWorkdayTimelineItem }) {
	const text = useItemText(warning);

	return (
		<Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
			<IconAlertTriangle aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
			<AlertTitle>{text.title}</AlertTitle>
			<AlertDescription>
				{text.subtitle && <p>{text.subtitle}</p>}
				{warning.link && (
					<Link
						className="font-medium text-amber-900 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:text-amber-100 dark:focus-visible:ring-amber-400"
						href={warning.link.href}
					>
						{text.linkLabel}
					</Link>
				)}
			</AlertDescription>
		</Alert>
	);
}

function TimelineRow({ item }: { item: SerializableWorkdayTimelineItem }) {
	const text = useItemText(item);
	const timeRange = getTimeRange(item);
	const content = <TimelineRowContent severity={item.severity} text={text} timeRange={timeRange} />;
	// A work entry's row is where a period blocker link focuses it (#1349).
	const focusTargetId =
		item.type === "work-period" && item.workPeriodId
			? workPeriodFocusTargetId(item.workPeriodId)
			: undefined;

	return (
		<li
			id={focusTargetId}
			tabIndex={focusTargetId ? -1 : undefined}
			className={
				focusTargetId
					? "outline-none focus:bg-muted/50 focus:ring-2 focus:ring-ring focus:ring-inset"
					: undefined
			}
		>
			{item.link ? (
				<Link
					className="block transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					href={item.link.href}
				>
					{content}
					<span className="sr-only"> {text.linkLabel}</span>
				</Link>
			) : (
				content
			)}
		</li>
	);
}

function TimelineRowContent({
	text,
	severity,
	timeRange,
}: {
	text: ReturnType<typeof useItemText>;
	severity: WorkdayTimelineSeverity | undefined;
	timeRange: string | null;
}) {
	return (
		<div className="flex gap-3 px-4 py-3">
			<div className={cn("mt-1 size-2.5 shrink-0 rounded-full", severityClassName(severity))} />
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="break-words font-medium text-sm leading-5">{text.title}</p>
					{text.badge && <Badge variant="secondary">{text.badge}</Badge>}
				</div>
				{timeRange && (
					<p className="font-medium text-muted-foreground text-xs tabular-nums">{timeRange}</p>
				)}
				{text.subtitle && (
					<p className="break-words text-muted-foreground text-sm leading-5">{text.subtitle}</p>
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

function getTimeRange(item: SerializableWorkdayTimelineItem) {
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
