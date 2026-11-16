"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { Badge } from "@/components/ui/badge";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftEndsNextDay, shiftPlaceLabel } from "@/lib/scheduling/shift-labels";

/** The same calendar records, with native buttons for keyboard and non-gesture access. */
export function ScheduleShiftList({
	shifts,
	organizationTimezone,
	onSelect,
}: {
	shifts: ShiftWithRelations[];
	organizationTimezone: string;
	onSelect: (shift: ShiftWithRelations) => void;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	return (
		<details className="rounded-lg border">
			<summary className="cursor-pointer rounded-lg p-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				{t("scheduling:scheduling.scheduler.shiftList", "Shift list")} ({shifts.length})
			</summary>
			<ul className="divide-y border-t">
				{shifts.map((shift) => (
					<li
						key={shift.id}
						className="[content-visibility:auto] [contain-intrinsic-size:auto_5rem]"
					>
						<button
							type="button"
							onClick={() => onSelect(shift)}
							className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span className="min-w-0 space-y-1 break-words">
								<span className="block font-medium">
									{shift.employee?.user
										? buildAuthUserDisplayName(shift.employee.user)
										: shift.employeeId
											? t("scheduling:scheduling.scheduler.assigned", "Assigned")
											: t("scheduling:scheduling.scheduler.open", "Open Shift")}
								</span>
								<span className="block text-muted-foreground">
									{shiftPlaceLabel(shift.subarea?.location.name, shift.subarea?.name)}
								</span>
							</span>
							<span className="tabular-nums">
								{formatPlainDate(
									shiftCalendarDate(shift.date, organizationTimezone),
									locale,
									"weekdayMonthDay",
								)}{" "}
								· {shift.startTime} – {shift.endTime}
								{shiftEndsNextDay(shift) && (
									<> ({t("scheduling:scheduling.shiftDetails.endsNextDay", "ends next day")})</>
								)}
							</span>
							<Badge variant={shift.status === "draft" ? "outline" : "secondary"}>
								{shift.status === "draft"
									? t("scheduling:scheduling.shiftDialog.draft", "Draft")
									: t("scheduling:scheduling.shiftDialog.published", "Published")}
							</Badge>
						</button>
					</li>
				))}
			</ul>
		</details>
	);
}
