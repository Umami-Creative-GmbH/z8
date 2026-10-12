"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftEndsNextDay, shiftPlaceLabel } from "@/lib/scheduling/shift-labels";

interface ShiftDetailsPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shift: ShiftWithRelations | null;
	organizationTimezone: string;
}

/** What an employee sees of one of their shifts: details only, nothing to edit. */
export function ShiftDetailsPanel({
	open,
	onOpenChange,
	shift,
	organizationTimezone,
}: ShiftDetailsPanelProps) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("scheduling:scheduling.shiftDetails.title", "Shift details")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{shift?.template?.name ??
							t("scheduling:scheduling.shiftDetails.description", "Your planned shift")}
					</ActionPanelDescription>
				</ActionPanelHeader>

				{shift && (
					<ActionPanelBody>
						<dl className="space-y-4">
							<ShiftDetail label={t("scheduling:scheduling.shiftDetails.date", "Date")}>
								{formatPlainDate(
									shiftCalendarDate(shift.date, organizationTimezone),
									locale,
									"weekdayDateLong",
								)}
							</ShiftDetail>
							<ShiftDetail label={t("scheduling:scheduling.shiftDetails.time", "Time")}>
								<span className="tabular-nums">
									{shift.startTime} – {shift.endTime}
								</span>
								{shiftEndsNextDay(shift) && (
									<span className="text-muted-foreground">
										{" "}
										({t("scheduling:scheduling.shiftDetails.endsNextDay", "ends next day")})
									</span>
								)}
							</ShiftDetail>
							{shift.subarea && (
								<ShiftDetail label={t("scheduling:scheduling.shiftDetails.location", "Location")}>
									{shiftPlaceLabel(shift.subarea.location.name, shift.subarea.name)}
								</ShiftDetail>
							)}
							{shift.notes && (
								<ShiftDetail label={t("scheduling:scheduling.shiftDetails.notes", "Notes")}>
									<span className="whitespace-pre-wrap">{shift.notes}</span>
								</ShiftDetail>
							)}
						</dl>
					</ActionPanelBody>
				)}

				<ActionPanelFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("scheduling:scheduling.shiftDetails.close", "Close")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function ShiftDetail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="space-y-1">
			<dt className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
			<dd className="text-sm">{children}</dd>
		</div>
	);
}
