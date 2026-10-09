"use client";

import { IconExternalLink, IconLoader2, IconMapPin } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
	getPositionStampViewerAccessAction,
	showWorkPeriodPositionsAction,
	type WorkPeriodPositionStampData,
} from "@/app/[locale]/(app)/calendar/position-stamps-actions";
import { Button } from "@/components/ui/button";
import { formatUtcOffset, offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";
import type { PositionCaptureErrorCode } from "@/lib/time-tracking/position-capture/errors";
import { positionCaptureErrorMessage } from "./error-message";

interface WorkPeriodPositionsSectionProps {
	workPeriodId: string;
	/** The work period's employee. */
	employeeId: string;
}

type Shown =
	| { state: "hidden" }
	| { state: "loading" }
	| { state: "failed"; code: PositionCaptureErrorCode | undefined }
	| { state: "shown"; stamps: WorkPeriodPositionStampData[] };

async function readViewerAccess() {
	const result = await getPositionStampViewerAccessAction();
	return result.success ? result.data : null;
}

/**
 * "Show positions" on a single work period's detail (#831). Positions are
 * fetched only when the viewer asks, never with the calendar. The server checks
 * the viewer again and logs the access when they are not the employee.
 */
export function WorkPeriodPositionsSection({
	workPeriodId,
	employeeId,
}: WorkPeriodPositionsSectionProps) {
	const { t } = useTranslate();
	const [shown, setShown] = useState<Shown>({ state: "hidden" });
	const { data: access } = useQuery({
		queryKey: queryKeys.positionStamps.viewerAccess(),
		queryFn: readViewerAccess,
		staleTime: 5 * 60_000,
		retry: false,
	});

	if (!access?.available) return null;
	const ownWorkPeriod = access.ownEmployeeId === employeeId;
	if (!ownWorkPeriod && !access.mayViewOthers) return null;

	const show = async () => {
		setShown({ state: "loading" });
		const result = await showWorkPeriodPositionsAction({ workPeriodId }).catch(() => null);
		setShown(
			result?.success
				? { state: "shown", stamps: result.data.stamps }
				: { state: "failed", code: result && !result.success ? result.code : undefined },
		);
	};

	return (
		<section className="space-y-2 rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-2 text-sm font-medium">
					<IconMapPin className="size-4" aria-hidden="true" />
					{t("calendar.details.positions.title", "Positions")}
				</span>
				{shown.state === "shown" ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setShown({ state: "hidden" })}
					>
						{t("calendar.details.positions.hide", "Hide positions")}
					</Button>
				) : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void show()}
						disabled={shown.state === "loading"}
					>
						{shown.state === "loading" ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : null}
						{t("calendar.details.positions.show", "Show positions")}
					</Button>
				)}
			</div>
			{!ownWorkPeriod ? (
				<p className="text-xs text-muted-foreground">
					{t(
						"calendar.details.positions.loggedHint",
						"The employee can see who looked at their positions: the viewing is logged.",
					)}
				</p>
			) : null}
			{shown.state === "failed" ? (
				<p className="text-sm text-destructive">
					{positionCaptureErrorMessage(t, shown.code) ??
						t("calendar.details.positions.failed", "Positions could not be loaded")}
				</p>
			) : null}
			{shown.state === "shown" ? <PositionStampList stamps={shown.stamps} /> : null}
		</section>
	);
}

function PositionStampList({ stamps }: { stamps: WorkPeriodPositionStampData[] }) {
	const { t } = useTranslate();
	if (stamps.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("calendar.details.positions.none", "No positions were recorded for this work period.")}
			</p>
		);
	}
	return (
		<ul className="space-y-3">
			{stamps.map((stamp) => {
				const eventTime = formatEventTime(stamp);
				return (
					<li key={stamp.event} className="space-y-1 text-sm">
						<p className="text-muted-foreground">
							{stamp.event === "clock_in"
								? t("calendar.details.positions.clockIn", "Clock-in")
								: t("calendar.details.positions.clockOut", "Clock-out")}
						</p>
						<p className="font-medium tabular-nums">
							{`${stamp.latitude.toFixed(5)}, ${stamp.longitude.toFixed(5)}`}
						</p>
						<p className="text-muted-foreground">
							{t("calendar.details.positions.accuracy", "within {meters} m", {
								meters: Math.ceil(stamp.accuracyMeters),
							})}
						</p>
						{stamp.originalEvent ? (
							<p className="text-xs text-muted-foreground">
								{stamp.event === "clock_in"
									? t(
											"calendar.details.positions.originalClockIn",
											"Recorded with the original clock-in at {time}. The times were corrected later.",
											{ time: eventTime },
										)
									: t(
											"calendar.details.positions.originalClockOut",
											"Recorded with the original clock-out at {time}. The times were corrected later.",
											{ time: eventTime },
										)}
							</p>
						) : null}
						<a
							href={mapsUrl(stamp)}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
						>
							{t("calendar.details.positions.openInMaps", "Open in maps")}
							<IconExternalLink className="size-3.5" aria-hidden="true" />
						</a>
					</li>
				);
			})}
		</ul>
	);
}

/** A link the viewer chooses to follow; nothing is sent to a map service before that. */
function mapsUrl(stamp: WorkPeriodPositionStampData): string {
	const { latitude, longitude } = stamp;
	return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

/** The stamped clock event's time at its own recorded offset, never the viewer's zone. */
function formatEventTime(stamp: WorkPeriodPositionStampData): string {
	const local = Temporal.Instant.from(stamp.eventAt).toZonedDateTimeISO(
		offsetMinutesToTimeZoneId(stamp.eventUtcOffsetMinutes),
	);
	const date = local.toPlainDate().toString();
	const time = local.toPlainTime().toString({ smallestUnit: "minute" });
	return `${date} ${time} (${formatUtcOffset(stamp.eventUtcOffsetMinutes)})`;
}
