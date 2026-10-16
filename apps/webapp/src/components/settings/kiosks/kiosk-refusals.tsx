"use client";

import { IconCloudOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { KioskRefusalData } from "@/app/[locale]/(app)/settings/kiosks/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { KioskFrozenAction } from "@/lib/time-tracking/kiosk/frozen-command";
import { kioskRefusalExplanation } from "@/lib/time-tracking/kiosk/frozen-refusal-reasons";
import { formatKioskInstant } from "./kiosk-format";

type Translate = ReturnType<typeof useTranslate>["t"];

function actionLabel(t: Translate, action: KioskFrozenAction): string {
	switch (action) {
		case "clock_in":
			return t("settings.kiosks.refusals.actions.clockIn", "Clock in");
		case "clock_out":
			return t("settings.kiosks.refusals.actions.clockOut", "Clock out");
		case "start_break":
			return t("settings.kiosks.refusals.actions.startBreak", "Start break");
		case "resume_break":
			return t("settings.kiosks.refusals.actions.resumeBreak", "Resume");
	}
}

function timeSourceLabel(t: Translate, timeSource: string): string {
	return timeSource === "device_clock"
		? t("settings.kiosks.refusals.timeSources.deviceClock", "Device clock")
		: t("settings.kiosks.refusals.timeSources.serverAnchor", "Server time");
}

function reasonLabel(t: Translate, reason: string): string {
	switch (kioskRefusalExplanation(reason)) {
		case "wrong_pin":
			return t("settings.kiosks.refusals.reasons.wrongPin", "Wrong PIN");
		case "pin_locked":
			return t("settings.kiosks.refusals.reasons.pinLocked", "PIN locked");
		case "pin_unchecked":
			return t("settings.kiosks.refusals.reasons.pinUnchecked", "PIN could not be checked");
		case "kiosk_retired":
			return t("settings.kiosks.refusals.reasons.kioskRetired", "Kiosk revoked or paired again");
		case "outside_window":
			return t("settings.kiosks.refusals.reasons.outsideWindow", "Arrived too late");
		case "clock_untrusted":
			return t("settings.kiosks.refusals.reasons.clockUntrusted", "Kiosk clock not trusted");
		case "not_assigned":
			return t("settings.kiosks.refusals.reasons.notAssigned", "Not assigned to the location");
		case "not_adopted":
			return t(
				"settings.kiosks.refusals.reasons.notAdopted",
				"Offline clocking not accepted by the organization",
			);
		case "month_closed":
			return t("settings.kiosks.refusals.reasons.monthClosed", "Month closed");
		case "holiday":
			return t("settings.kiosks.refusals.reasons.holiday", "Holiday without time recording");
		case "conflict":
			return t("settings.kiosks.refusals.reasons.conflict", "Conflicts with other recorded time");
		case "other":
			return t("settings.kiosks.refusals.reasons.other", "Could not be accepted");
	}
}

/**
 * Owner/admin list of clockings that offline kiosks queued and Z8 refused on
 * arrival (#1290): who, what, when it claims (in the kiosk's zone), which clock
 * timed it and why. The employee, or a kiosk-only employee's managers, were
 * notified when Z8 refused it.
 */
export function KioskRefusalList({ refusals }: { refusals: KioskRefusalData[] }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const title = t("settings.kiosks.refusals.title", "Refused offline clockings");

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCloudOff className="size-5" aria-hidden="true" />
					{title}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.kiosks.refusals.description",
						"Clockings saved on a kiosk while it was offline that were not recorded when it reconnected. The employee, or the managers of an employee without a sign-in, were notified.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{refusals.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("settings.kiosks.refusals.empty", "No offline clocking was refused.")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<Table aria-label={title}>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("settings.kiosks.refusals.columns.employee", "Employee")}
									</TableHead>
									<TableHead>{t("settings.kiosks.refusals.columns.action", "Action")}</TableHead>
									<TableHead>
										{t("settings.kiosks.refusals.columns.claimedAt", "Claimed time")}
									</TableHead>
									<TableHead>
										{t("settings.kiosks.refusals.columns.timeSource", "Time source")}
									</TableHead>
									<TableHead>{t("settings.kiosks.refusals.columns.reason", "Reason")}</TableHead>
									<TableHead>{t("settings.kiosks.refusals.columns.kiosk", "Kiosk")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{refusals.map((refusal) => (
									<TableRow key={refusal.id}>
										<TableCell className="font-medium">
											{refusal.employeeName ??
												t("settings.kiosks.refusals.unknownEmployee", "Not an employee")}
										</TableCell>
										<TableCell>{actionLabel(t, refusal.action)}</TableCell>
										<TableCell className="text-sm">
											{formatKioskInstant(locale, refusal.claimedAt, refusal.kioskTimezone)}
										</TableCell>
										<TableCell>{timeSourceLabel(t, refusal.timeSource)}</TableCell>
										<TableCell>{reasonLabel(t, refusal.reason)}</TableCell>
										<TableCell>{refusal.kioskName}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
