"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { useProjectsEnabled } from "@/stores/organization-settings-store";

interface EventDetailsPanelProps {
	event: CalendarEvent;
	onClose: () => void;
}

type Translate = ReturnType<typeof useTranslate>["t"];

const formatDate = (date: Date) => {
	return format(date, "PPP"); // e.g., "January 1, 2024"
};

const formatDuration = (minutes: number) => {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
};

export function EventDetailsPanel({ event, onClose }: EventDetailsPanelProps) {
	const { t } = useTranslate();
	const projectsEnabled = useProjectsEnabled();

	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent>
				<SheetHeader>
					<div className="flex items-center gap-2">
						<div
							className="size-3 rounded-full"
							style={{ backgroundColor: event.color }}
						/>
						<SheetTitle>{getEventTitle(event, t)}</SheetTitle>
					</div>
					<SheetDescription className="flex items-center gap-2">
						<Badge variant="outline">{getEventTypeLabel(event, t)}</Badge>
						<span>{formatDate(event.date)}</span>
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6">
					<EventTypeDetails
						event={event}
						projectsEnabled={projectsEnabled}
						t={t}
					/>
				</div>

				{event.description && (
					<div className="mt-6 pt-4 border-t">
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.notes", "Notes")}
						</span>
						<p className="mt-1 text-sm">{getEventDescription(event, t)}</p>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}

function EventTypeDetails({
	event,
	projectsEnabled,
	t,
}: {
	event: CalendarEvent;
	projectsEnabled: boolean;
	t: Translate;
}) {
	switch (event.type) {
		case "holiday":
			return <HolidayDetails event={event} t={t} />;
		case "absence":
			return <AbsenceDetails event={event} t={t} />;
		case "work_period":
			return (
				<WorkPeriodDetails
					event={event}
					projectsEnabled={projectsEnabled}
					t={t}
				/>
			);
		case "time_entry":
			return <TimeEntryDetails event={event} t={t} />;
		default:
			return null;
	}
}

function HolidayDetails({ event, t }: { event: CalendarEvent; t: Translate }) {
	const metadata = event.metadata as {
		categoryName: string;
		blocksTimeEntry: boolean;
		isRecurring: boolean;
	};
	return (
		<div className="space-y-3">
			<div>
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.category", "Category")}
				</span>
				<p className="font-medium">{metadata.categoryName}</p>
			</div>
			{metadata.blocksTimeEntry && (
				<Badge variant="secondary">
					{t("calendar.details.blocksTimeEntry", "Blocks time tracking")}
				</Badge>
			)}
			{metadata.isRecurring && (
				<Badge variant="outline">
					{t("calendar.details.recurring", "Recurring yearly")}
				</Badge>
			)}
		</div>
	);
}

function AbsenceDetails({ event, t }: { event: CalendarEvent; t: Translate }) {
	const metadata = event.metadata as {
		categoryName: string;
		status: "pending" | "approved" | "rejected";
		employeeName: string;
	};
	const statusColors = {
		pending:
			"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		approved:
			"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
	};
	const statusLabels = {
		pending: t("calendar.status.pending", "Pending"),
		approved: t("calendar.status.approved", "Approved"),
		rejected: t("calendar.status.rejected", "Rejected"),
	};
	return (
		<div className="space-y-3">
			<DetailValue
				label={t("calendar.details.employee", "Employee")}
				value={metadata.employeeName}
			/>
			<DetailValue
				label={t("calendar.details.category", "Category")}
				value={metadata.categoryName}
			/>
			<div>
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.status", "Status")}
				</span>
				<div className="mt-1">
					<Badge className={statusColors[metadata.status]}>
						{statusLabels[metadata.status]}
					</Badge>
				</div>
			</div>
			{event.endDate && event.date.getTime() !== event.endDate.getTime() && (
				<DetailValue
					label={t("calendar.details.dateRange", "Date Range")}
					value={`${formatDate(event.date)} - ${formatDate(event.endDate)}`}
				/>
			)}
		</div>
	);
}

function WorkPeriodDetails({
	event,
	projectsEnabled,
	t,
}: {
	event: CalendarEvent;
	projectsEnabled: boolean;
	t: Translate;
}) {
	const metadata = event.metadata as {
		durationMinutes: number;
		employeeName: string;
		startTime?: string;
		endTime?: string;
		projectName?: string;
		projectColor?: string;
		surchargeMinutes?: number;
		totalCreditedMinutes?: number;
		surchargeBreakdown?: Array<{
			ruleName: string;
			percentage: number;
			surchargeMinutes: number;
		}>;
	};
	const hasSurcharge =
		metadata.surchargeMinutes && metadata.surchargeMinutes > 0;
	return (
		<div className="space-y-3">
			<DetailValue
				label={t("calendar.details.employee", "Employee")}
				value={metadata.employeeName}
			/>
			{projectsEnabled && metadata.projectName && (
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.project", "Project")}
					</span>
					<div className="flex items-center gap-2 mt-0.5">
						{metadata.projectColor && (
							<div
								className="size-3 rounded-full"
								style={{ backgroundColor: metadata.projectColor }}
							/>
						)}
						<p className="font-medium">{metadata.projectName}</p>
					</div>
				</div>
			)}
			<div>
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.duration", "Duration")}
				</span>
				{hasSurcharge ? (
					<div className="space-y-1 mt-1">
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">
								{t("calendar.details.baseWorked", "Base worked")}
							</span>
							<span className="tabular-nums">
								{formatDuration(metadata.durationMinutes)}
							</span>
						</div>
						<div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
							<span>{t("calendar.details.surcharge", "Surcharge")}</span>
							<span className="tabular-nums">
								+{formatDuration(metadata.surchargeMinutes!)}
							</span>
						</div>
						<div className="flex justify-between font-medium border-t pt-1">
							<span>{t("calendar.details.credited", "Credited")}</span>
							<span className="tabular-nums">
								{formatDuration(metadata.totalCreditedMinutes!)}
							</span>
						</div>
					</div>
				) : (
					<p className="font-medium">
						{formatDuration(metadata.durationMinutes)}
					</p>
				)}
			</div>
			{metadata.surchargeBreakdown &&
				metadata.surchargeBreakdown.length > 0 && (
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.surchargeBreakdown", "Surcharge Breakdown")}
						</span>
						<div className="mt-1 space-y-1">
							{metadata.surchargeBreakdown.map((rule) => (
								<div
									key={`${rule.ruleName}-${rule.percentage}-${rule.surchargeMinutes}`}
									className="flex justify-between text-sm bg-muted/50 rounded px-2 py-1"
								>
									<span>
										{rule.ruleName}{" "}
										<span className="text-muted-foreground">
											({rule.percentage}%)
										</span>
									</span>
									<span className="tabular-nums text-emerald-600 dark:text-emerald-400">
										+{formatDuration(rule.surchargeMinutes)}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			{metadata.startTime && metadata.endTime && (
				<DetailValue
					label={t("calendar.details.time", "Time")}
					value={`${metadata.startTime} - ${metadata.endTime}`}
				/>
			)}
		</div>
	);
}

function TimeEntryDetails({
	event,
	t,
}: {
	event: CalendarEvent;
	t: Translate;
}) {
	const metadata = event.metadata as {
		entryType: "clock_in" | "clock_out" | "correction";
		employeeName: string;
		time?: string;
	};
	const entryTypeLabels = {
		clock_in: t("calendar.entryType.clockIn", "Clock In"),
		clock_out: t("calendar.entryType.clockOut", "Clock Out"),
		correction: t("calendar.entryType.correction", "Correction"),
	};
	const entryTypeColors = {
		clock_in:
			"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		clock_out: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		correction:
			"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
	};
	return (
		<div className="space-y-3">
			<DetailValue
				label={t("calendar.details.employee", "Employee")}
				value={metadata.employeeName}
			/>
			<div>
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.type", "Type")}
				</span>
				<div className="mt-1">
					<Badge className={entryTypeColors[metadata.entryType]}>
						{entryTypeLabels[metadata.entryType]}
					</Badge>
				</div>
			</div>
			{metadata.time && (
				<DetailValue
					label={t("calendar.details.time", "Time")}
					value={metadata.time}
				/>
			)}
		</div>
	);
}

function DetailValue({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span className="text-sm text-muted-foreground">{label}</span>
			<p className="font-medium">{value}</p>
		</div>
	);
}

function getEventTypeLabel(event: CalendarEvent, t: Translate) {
	switch (event.type) {
		case "holiday":
			return t("calendar.eventType.holiday", "Holiday");
		case "absence":
			return t("calendar.eventType.absence", "Absence");
		case "work_period":
			return t("calendar.eventType.workPeriod", "Work Period");
		case "time_entry":
			return t("calendar.eventType.timeEntry", "Time Entry");
		default:
			return event.type;
	}
}

function getEventTitle(event: CalendarEvent, t: Translate) {
	return event.titleKey
		? t(event.titleKey, event.title, getEventTranslationParams(event))
		: event.title;
}

function getEventDescription(event: CalendarEvent, t: Translate) {
	if (!event.description) return "";
	return event.descriptionKey
		? t(
				event.descriptionKey,
				event.description,
				getEventTranslationParams(event),
			)
		: event.description;
}

function getEventTranslationParams(event: CalendarEvent) {
	return {
		duration: formatDurationParam(event.metadata?.durationMinutes),
	};
}

function formatDurationParam(value: unknown) {
	if (typeof value !== "number") return "";
	const minutes = Math.round(value);
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}
