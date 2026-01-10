"use client";

import { useTranslate } from "@tolgee/react";
import { format } from "@/lib/datetime/luxon-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";

interface EventDetailsPanelProps {
	event: CalendarEvent;
	onClose: () => void;
}

export function EventDetailsPanel({ event, onClose }: EventDetailsPanelProps) {
	const { t } = useTranslate();

	const getEventTypeLabel = () => {
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
	};

	const formatDate = (date: Date) => {
		return format(date, "PPP"); // e.g., "January 1, 2024"
	};

	const formatTime = (date: Date) => {
		return format(date, "p"); // e.g., "2:30 PM"
	};

	const formatDuration = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	const renderHolidayDetails = () => {
		const metadata = event.metadata as {
			categoryName: string;
			categoryType: string;
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
					<Badge variant="outline">{t("calendar.details.recurring", "Recurring yearly")}</Badge>
				)}
			</div>
		);
	};

	const renderAbsenceDetails = () => {
		const metadata = event.metadata as {
			categoryName: string;
			status: "pending" | "approved" | "rejected";
			employeeName: string;
			startDate?: string;
			endDate?: string;
		};

		const statusColors = {
			pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
			approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
			rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		};

		const statusLabels = {
			pending: t("calendar.status.pending", "Pending"),
			approved: t("calendar.status.approved", "Approved"),
			rejected: t("calendar.status.rejected", "Rejected"),
		};

		return (
			<div className="space-y-3">
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.employee", "Employee")}
					</span>
					<p className="font-medium">{metadata.employeeName}</p>
				</div>
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.category", "Category")}
					</span>
					<p className="font-medium">{metadata.categoryName}</p>
				</div>
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.status", "Status")}
					</span>
					<div className="mt-1">
						<Badge className={statusColors[metadata.status]}>{statusLabels[metadata.status]}</Badge>
					</div>
				</div>
				{event.endDate && event.date.getTime() !== event.endDate.getTime() && (
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.dateRange", "Date Range")}
						</span>
						<p className="font-medium">
							{formatDate(event.date)} - {formatDate(event.endDate)}
						</p>
					</div>
				)}
			</div>
		);
	};

	const renderWorkPeriodDetails = () => {
		const metadata = event.metadata as {
			durationMinutes: number;
			employeeName: string;
			startTime?: string;
			endTime?: string;
			periodCount?: number;
		};

		return (
			<div className="space-y-3">
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.employee", "Employee")}
					</span>
					<p className="font-medium">{metadata.employeeName}</p>
				</div>
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.duration", "Duration")}
					</span>
					<p className="font-medium">{formatDuration(metadata.durationMinutes)}</p>
				</div>
				{metadata.startTime && metadata.endTime && (
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.time", "Time")}
						</span>
						<p className="font-medium">
							{metadata.startTime} - {metadata.endTime}
						</p>
					</div>
				)}
				{metadata.periodCount && metadata.periodCount > 1 && (
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.periods", "Work Periods")}
						</span>
						<p className="font-medium">{metadata.periodCount}</p>
					</div>
				)}
			</div>
		);
	};

	const renderTimeEntryDetails = () => {
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
			clock_in: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
			clock_out: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
			correction: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		};

		return (
			<div className="space-y-3">
				<div>
					<span className="text-sm text-muted-foreground">
						{t("calendar.details.employee", "Employee")}
					</span>
					<p className="font-medium">{metadata.employeeName}</p>
				</div>
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
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.time", "Time")}
						</span>
						<p className="font-medium">{metadata.time}</p>
					</div>
				)}
			</div>
		);
	};

	const renderDetails = () => {
		switch (event.type) {
			case "holiday":
				return renderHolidayDetails();
			case "absence":
				return renderAbsenceDetails();
			case "work_period":
				return renderWorkPeriodDetails();
			case "time_entry":
				return renderTimeEntryDetails();
			default:
				return null;
		}
	};

	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent>
				<SheetHeader>
					<div className="flex items-center gap-2">
						<div
							className="w-3 h-3 rounded-full"
							style={{ backgroundColor: event.color }}
						/>
						<SheetTitle>{event.title}</SheetTitle>
					</div>
					<SheetDescription className="flex items-center gap-2">
						<Badge variant="outline">{getEventTypeLabel()}</Badge>
						<span>{formatDate(event.date)}</span>
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6">{renderDetails()}</div>

				{event.description && (
					<div className="mt-6 pt-4 border-t">
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.notes", "Notes")}
						</span>
						<p className="mt-1 text-sm">{event.description}</p>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
