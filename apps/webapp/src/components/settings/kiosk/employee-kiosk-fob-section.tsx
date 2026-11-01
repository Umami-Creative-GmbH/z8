"use client";

import { IconLoader2, IconNfc, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTolgee, type useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type EmployeeKioskFobState,
	removeEmployeeKioskFobAction,
} from "@/app/[locale]/(app)/settings/employees/kiosk-actions";
import { Button } from "@/components/ui/button";
import { kioskFobDateLabel, kioskFobDetails, kioskFobErrorMessage } from "./kiosk-fob-text";

type Translate = ReturnType<typeof useTranslate>["t"];

const SPINNER = "mr-2 size-4 animate-spin motion-reduce:animate-none";

/** A calendar day (ISO date) as it is, in the UI language. */
function dayLabel(day: string, locale: string): string {
	return Temporal.PlainDate.from(day).toLocaleString(locale, { dateStyle: "medium" });
}

function LastEnded({
	fob,
	locale,
	t,
}: {
	fob: EmployeeKioskFobState;
	locale: string;
	t: Translate;
}) {
	const ended = fob.lastEnded;
	if (!ended) return null;
	if (ended.reason === "departure") {
		return t(
			"settings.employees.kioskFob.endedByDeparture",
			"The last one ended with the employee's departure on {date}.",
			{
				// The departure date people know is the last working day, not the cutoff after it.
				date: ended.departureLastWorkingDay
					? dayLabel(ended.departureLastWorkingDay, locale)
					: kioskFobDateLabel(ended.at, fob.timezone, locale),
			},
		);
	}
	if (ended.reason === "removed") {
		return t("settings.employees.kioskFob.removedOn", "The last one was removed on {date}.", {
			date: kioskFobDateLabel(ended.at, fob.timezone, locale),
		});
	}
	return t("settings.employees.kioskFob.endedOn", "The last one ended on {date}.", {
		date: kioskFobDateLabel(ended.at, fob.timezone, locale),
	});
}

/**
 * The employee's kiosk fob (#1508, ADR 0014) for owners, admins and their
 * direct manager: when and where it was registered and its last 4 hex digits,
 * and removing it. Fobs are registered only at a kiosk, by the employee.
 */
export function KioskFobSection({
	employeeId,
	fob,
	onChanged,
	t,
}: {
	employeeId: string;
	fob: EmployeeKioskFobState;
	onChanged: () => Promise<unknown>;
	t: Translate;
}) {
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [confirming, setConfirming] = useState(false);
	// Removal names the fob this card shows, so a change made meanwhile is refused.
	const shownFobId = fob.active?.fobId ?? "";
	const removeMutation = useMutation({
		mutationFn: () => removeEmployeeKioskFobAction(employeeId, shownFobId),
		onSuccess: (result) => {
			setConfirming(false);
			if (!result.success) {
				toast.error(kioskFobErrorMessage(t, result.code));
				// Someone else changed the fob: show what is true now.
				if (result.code === "fob_changed") void onChanged();
				return;
			}
			toast.success(t("settings.kioskFob.removed", "Kiosk fob removed"));
			void onChanged();
		},
		onError: () => toast.error(kioskFobErrorMessage(t, "failed")),
	});
	const busy = removeMutation.isPending;
	const headingId = `kiosk-fob-${employeeId}`;

	return (
		<section className="space-y-3" aria-labelledby={headingId}>
			<h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
				<IconNfc className="size-4 text-muted-foreground" aria-hidden="true" />
				{t("settings.employees.kioskFob.heading", "Kiosk fob")}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.employees.kioskFob.description",
					"An NFC card or fob the employee taps at an online kiosk to pick their name. Their kiosk PIN still proves it is them.",
				)}
			</p>
			<div className="space-y-1 text-sm" aria-live="polite">
				{fob.active ? (
					<p>{kioskFobDetails(t, fob.active, fob.timezone, locale)}</p>
				) : (
					<>
						<p>
							{t(
								"settings.employees.kioskFob.none",
								"No kiosk fob. Employees register their own at a kiosk with an NFC fob reader, using their kiosk PIN.",
							)}
						</p>
						{fob.lastEnded && (
							<p className="text-muted-foreground">
								<LastEnded fob={fob} locale={locale} t={t} />
							</p>
						)}
					</>
				)}
			</div>

			{fob.active && confirming && (
				<p className="text-sm text-muted-foreground" role="alert">
					{t(
						"settings.employees.kioskFob.confirmRemoveText",
						"The fob stops working at kiosks at once and can be registered again. The employee's kiosk PIN and kiosk badge keep working.",
					)}
				</p>
			)}

			{fob.active && (
				<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
					{confirming ? (
						<>
							<Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button variant="destructive" onClick={() => removeMutation.mutate()} disabled={busy}>
								{busy && <IconLoader2 className={SPINNER} aria-hidden="true" />}
								{t("settings.kioskFob.confirmRemove", "Remove the fob")}
							</Button>
						</>
					) : (
						<Button variant="outline" onClick={() => setConfirming(true)} disabled={busy}>
							<IconTrash className="mr-2 size-4" aria-hidden="true" />
							{t("settings.kioskFob.remove", "Remove fob")}
						</Button>
					)}
				</div>
			)}
		</section>
	);
}
