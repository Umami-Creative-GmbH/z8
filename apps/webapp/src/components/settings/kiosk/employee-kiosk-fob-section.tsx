"use client";

import { IconNfc } from "@tabler/icons-react";
import { useTolgee, type useTranslate } from "@tolgee/react";
import {
	type EmployeeKioskFobState,
	removeEmployeeKioskFobAction,
} from "@/app/[locale]/(app)/settings/employees/kiosk-actions";
import { kioskDateLabel, kioskDayLabel } from "./kiosk-date-labels";
import { KioskFobRemoveControls } from "./kiosk-fob-remove-controls";
import { kioskFobDetails } from "./kiosk-fob-text";

type Translate = ReturnType<typeof useTranslate>["t"];

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
					? kioskDayLabel(ended.departureLastWorkingDay, locale)
					: kioskDateLabel(ended.at, fob.timezone, locale),
			},
		);
	}
	if (ended.reason === "removed") {
		return t("settings.employees.kioskFob.removedOn", "The last one was removed on {date}.", {
			date: kioskDateLabel(ended.at, fob.timezone, locale),
		});
	}
	return t("settings.employees.kioskFob.endedOn", "The last one ended on {date}.", {
		date: kioskDateLabel(ended.at, fob.timezone, locale),
	});
}

/**
 * The employee's kiosk fob (#1508, ADR 0014) for owners, admins and their
 * direct manager: when and where it was registered and its last four
 * characters, and removing it. Fobs are registered only at a kiosk, by the
 * employee. Hidden without a fob, a last one or any kiosk reading fobs.
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
	// Like the employee's own card: nothing to show where no kiosk reads fobs.
	if (!fob.active && !fob.lastEnded && !fob.fobReaderInUse) return null;
	const active = fob.active;
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

			{active && (
				<KioskFobRemoveControls
					remove={() => removeEmployeeKioskFobAction(employeeId, active.fobId)}
					confirmText={t(
						"settings.employees.kioskFob.confirmRemoveText",
						"The fob stops working at kiosks at once and can be registered again. The employee's kiosk PIN and kiosk badge keep working.",
					)}
					onRefresh={onChanged}
					t={t}
				/>
			)}
		</section>
	);
}
