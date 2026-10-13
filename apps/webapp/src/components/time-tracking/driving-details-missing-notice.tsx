"use client";

import { IconAlertTriangle, IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import {
	type MissingDrivingDetail,
	missingDrivingDetail,
} from "@/lib/time-tracking/vehicle-use/driving-details-missing";
import type { DrivingDetailsMissingWork } from "@/lib/time-tracking/vehicle-use/driving-details-missing-store";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { Link } from "@/navigation";

interface Props {
	work: DrivingDetailsMissingWork[];
	employeeId: string;
	timeFormat: TimeFormat;
	/** More flagged work exists than listed. */
	truncated: boolean;
}

function useMissingLabel() {
	const { t } = useTranslate();
	return (missing: MissingDrivingDetail | null) => {
		switch (missing) {
			case "readings":
				return t("timeTracking.drivingDetailsMissing.missing.readings", "No odometer readings");
			case "start_reading":
				return t("timeTracking.drivingDetailsMissing.missing.startReading", "No start reading");
			case "end_reading":
				return t("timeTracking.drivingDetailsMissing.missing.endReading", "No end reading");
			default:
				return t("timeTracking.drivingDetailsMissing.missing.vehicle", "No vehicle");
		}
	};
}

/**
 * The employee's own work showing "driving details missing" (#1127): completed work lacking its
 * vehicle or an odometer reading while vehicle use is expected of them. It stays until each work
 * period is completed; nothing is blocked meanwhile.
 */
export function DrivingDetailsMissingNotice({ work, employeeId, timeFormat, truncated }: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const missingLabel = useMissingLabel();
	if (work.length === 0) return null;
	const at = (instant: string, offsetMinutes: number, preset: "dateMedium" | "time") =>
		formatCapturedOffsetInstant(parseInstant(instant), {
			locale,
			timeFormat,
			offsetMinutes,
			preset,
		});

	return (
		<Card
			className="border-amber-500/40 bg-amber-500/5"
			role="region"
			aria-labelledby="driving-details-missing-title"
		>
			<CardHeader className="gap-1">
				<CardTitle id="driving-details-missing-title" className="flex items-center gap-2 text-base">
					<IconAlertTriangle
						className="size-4 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
					{t("timeTracking.drivingDetailsMissing.title", "Driving details missing")}
				</CardTitle>
				<CardDescription>
					{t(
						"timeTracking.drivingDetailsMissing.description",
						"Your organization expects the vehicle and odometer readings for your work. Add them to these work periods.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2">
				<ul className="divide-y rounded-lg border bg-card">
					{work.map((item) => (
						<li
							key={item.workPeriodId}
							className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
						>
							<span className="tabular-nums">
								{at(item.startedAt, item.startOffsetMinutes, "dateMedium")},{" "}
								{at(item.startedAt, item.startOffsetMinutes, "time")} –{" "}
								{at(item.endedAt, item.endOffsetMinutes ?? item.startOffsetMinutes, "time")}
							</span>
							<span className="flex items-center gap-2">
								<span className="text-muted-foreground">
									{missingLabel(missingDrivingDetail(item.vehicleUse))}
								</span>
								<Button asChild variant="ghost" size="sm">
									<Link href={`/calendar/${employeeId}?date=${item.workDay}`}>
										<IconCalendar className="size-4" aria-hidden="true" />
										{t("timeTracking.drivingDetailsMissing.open", "Open in calendar")}
									</Link>
								</Button>
							</span>
						</li>
					))}
				</ul>
				{truncated ? (
					<p className="text-muted-foreground text-xs">
						{t(
							"timeTracking.drivingDetailsMissing.truncated",
							"Only the newest work periods are listed. Complete these to see the rest.",
						)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
