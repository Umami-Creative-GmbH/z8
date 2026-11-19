import type { useTranslate } from "@tolgee/react";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatDuration } from "@/lib/time-tracking/time-utils";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * The elapsed minutes of running work. The calendar moves a running event's end to "now" each
 * minute; before that, the server's count at read time stands in.
 */
function runningMinutes(event: CalendarEvent): number {
	if (event.endDate) {
		const elapsed = instantFromDate(event.endDate)
			.since(instantFromDate(event.date))
			.total({ unit: "minutes" });
		return Math.max(0, Math.floor(elapsed));
	}
	const reported = event.metadata.durationMinutes;
	return typeof reported === "number" ? reported : 0;
}

/**
 * A running work period's title in the viewer's language, with its live duration. The server
 * title is an English snapshot taken when the calendar was read.
 */
export function runningWorkPeriodTitle(event: CalendarEvent, t: Translate): string {
	const { projectName, taskName, employeeName } = event.metadata;
	const project =
		typeof projectName === "string" && projectName
			? `[${typeof taskName === "string" && taskName ? `${projectName} · ${taskName}` : projectName}] `
			: "";
	return `${project}${t("calendar.workPeriod.runningTitle", "{name} - {duration} (running)", {
		name: typeof employeeName === "string" ? employeeName : "",
		duration: formatDuration(runningMinutes(event)),
	})}`;
}

/** The labels of the "clock out on behalf" button on a running work period. */
export function runningClockOutLabels(t: Translate) {
	return {
		label: t("calendar.workPeriod.stop", "Stop"),
		ariaLabel: (name: string) =>
			t("calendar.workPeriod.stopFor", "Stop running work period for {name}", { name }),
	};
}
