"use client";

import { IconCoin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { WorkLocationIndicator } from "@/components/time-tracking/work-location-indicator";
import { calendarColors } from "@/lib/calendar/schedule-x-adapter";
import { formatTimeStringForPreference } from "@/lib/user-preferences/time-format";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";

interface CalendarWorkEventProps {
	calendarEvent: {
		title: string;
		_customContent?: { timeGrid?: string };
		_calendarTimeGridContent?: string;
		_workPeriodTimes?: { start: string; end?: string };
		calendarId?: string;
		start?: { hour?: number; minute?: number };
		end?: { hour?: number; minute?: number };
		_eventData?: {
			type: string;
			metadata: { workLocationType?: string | null; isBillable?: boolean };
		};
	};
}

export function CalendarTimeGridEvent({
	calendarEvent,
}: CalendarWorkEventProps) {
	return <CalendarWorkEvent calendarEvent={calendarEvent} timeGrid />;
}

export function CalendarCompactEvent(props: CalendarWorkEventProps) {
	return <CalendarWorkEvent {...props} />;
}

function CalendarWorkEvent({
	calendarEvent,
	timeGrid = false,
}: CalendarWorkEventProps & { timeGrid?: boolean }) {
	const { t } = useTranslate();
	const timeFormat = useTimeFormat();
	const billableTimeEnabled = useBillableTimeEnabled();
	const html = timeGrid
		? (calendarEvent._calendarTimeGridContent ??
			calendarEvent._customContent?.timeGrid)
		: undefined;
	const colors =
		calendarColors[calendarEvent.calendarId as keyof typeof calendarColors];
	const colorName = colors?.colorName;
	const time = (endpoint: CalendarWorkEventProps["calendarEvent"]["start"]) =>
		endpoint?.hour !== undefined && endpoint.minute !== undefined
			? formatTimeStringForPreference(
					`${String(endpoint.hour).padStart(2, "0")}:${String(endpoint.minute).padStart(2, "0")}`,
					timeFormat,
				)
			: null;
	const isWorkPeriod = calendarEvent._eventData?.type === "work_period";
	const recordedTimes = calendarEvent._workPeriodTimes;
	const start = isWorkPeriod
		? recordedTimes &&
			formatTimeStringForPreference(recordedTimes.start, timeFormat)
		: time(calendarEvent.start);
	const end = isWorkPeriod
		? recordedTimes?.end &&
			formatTimeStringForPreference(recordedTimes.end, timeFormat)
		: time(calendarEvent.end);
	return (
		<div
			className="flex h-full w-full min-w-0 items-start gap-1 rounded-sm px-1.5 py-1"
			style={
				colorName
					? {
							backgroundColor: `var(--sx-color-${colorName}-container)`,
							color: `var(--sx-color-on-${colorName}-container)`,
							borderInlineStart: `3px solid var(--sx-color-${colorName})`,
						}
					: undefined
			}
		>
			{calendarEvent._eventData?.type === "work_period" ? (
				<WorkLocationIndicator
					value={calendarEvent._eventData.metadata.workLocationType}
					t={t}
				/>
			) : null}
			{billableTimeEnabled &&
			calendarEvent._eventData?.type === "work_period" &&
			calendarEvent._eventData.metadata.isBillable ? (
				<IconCoin
					className="mt-0.5 size-3 shrink-0"
					role="img"
					aria-label={t("calendar.workPeriod.billable", "Billable")}
				/>
			) : null}
			<div className="min-w-0 flex-1">
				{html ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Internal Schedule-X adapter markup escapes all event strings before interpolation.
					<div dangerouslySetInnerHTML={{ __html: html }} />
				) : (
					<span className="block truncate">{calendarEvent.title}</span>
				)}
				{start ? (
					<span className="block text-[10px] opacity-80">
						{start}
						{timeGrid && end ? ` - ${end}` : ""}
					</span>
				) : null}
			</div>
		</div>
	);
}

export const calendarEventComponents = {
	timeGridEvent: CalendarTimeGridEvent,
	monthGridEvent: CalendarCompactEvent,
	monthAgendaEvent: CalendarCompactEvent,
};
