import type { Instant } from "@/lib/datetime/temporal-core";
import type { KioskVehicleUse } from "@/lib/time-tracking/kiosk/protocol";
import type {
	BreakVehicleUse,
	ClockVehicleUse,
} from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import {
	type VehicleUseWarning,
	vehicleUsePlausibilityWarnings,
} from "@/lib/time-tracking/vehicle-use/plausibility";
import {
	buildWorkVehicleUse,
	organizationVehicleIdOf,
	type WorkVehicleUseInput,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	breakClosingVehicleUse,
	breakVehicleUseFromReading,
	type ClockVehicleUseDraftResult,
	clockInVehicleUseFromDraft,
	clockOutVehicleUseFromDraft,
	closingVehicleUse,
} from "../time-tracking/clock-vehicle-use-draft";
import type { VehicleUseDraft } from "../time-tracking/vehicle-use-draft";
import { vehicleUseFromDraft } from "../time-tracking/vehicle-use-draft";
import type { KioskPanelAction } from "./kiosk-employee-panel";

/**
 * Vehicle use at the kiosk (#1123, spec #807): what each action asks and sends,
 * with the web clock's drafts (#1122) and plausibility warnings (#1121). Pure:
 * the facts come from the employee-status snapshot.
 *
 * - `clock_in`: the vehicle and start reading, pre-filled.
 * - `clock_out`: the end reading (the distance without a start reading), or the
 *   whole vehicle use while the work records none. Also when ending the day on a
 *   break: the reading is the closed work's end.
 * - `break`: one reading when resuming, while the work records a vehicle. A
 *   break's start asks nothing: the vehicle stands still until the resume.
 */
export type KioskVehicleQuestion = "clock_in" | "clock_out" | "break";

export function kioskVehicleQuestion(
	action: KioskPanelAction,
	vehicleUse: KioskVehicleUse | undefined,
): KioskVehicleQuestion | null {
	if (!vehicleUse) return null;
	switch (action) {
		case "clock_in":
			return "clock_in";
		case "clock_out":
		case "end_day":
			return "clock_out";
		case "resume_break":
			return vehicleUse.live ? "break" : null;
		case "start_break":
			return null;
	}
}

/** What the action sends beside it; a refusal is shown, and the action then runs without it. */
export function kioskVehicleUseRequest(
	question: KioskVehicleQuestion,
	context: KioskVehicleUse,
	draft: VehicleUseDraft,
	reading: string,
): ClockVehicleUseDraftResult<ClockVehicleUse | BreakVehicleUse> {
	switch (question) {
		case "clock_in":
			return clockInVehicleUseFromDraft(draft);
		case "clock_out":
			return clockOutVehicleUseFromDraft(draft, context.live);
		case "break":
			return breakVehicleUseFromReading(reading, context.live);
	}
}

/** The vehicle use the action would leave on the work, for its warnings; null when none. */
function checkedUse(
	question: KioskVehicleQuestion,
	context: KioskVehicleUse,
	draft: VehicleUseDraft,
	reading: string,
): WorkVehicleUseInput | null {
	const request = kioskVehicleUseRequest(question, context, draft, reading);
	if (!request.ok || !request.vehicleUse) return null;
	if (question === "clock_in") {
		const result = vehicleUseFromDraft({ ...draft, endKm: "", distanceKm: "" });
		return result.ok ? result.input : null;
	}
	if (question === "clock_out") return closingVehicleUse(context.live, draft);
	// The break reading ends the work the break closed, as at the web clock.
	return breakClosingVehicleUse(context.live, reading);
}

/**
 * The web clock's plausibility warnings (#1121) for what the action is about to
 * record. A clock-in starts work `at` now; a clock-out ends the live work, from
 * `since`, `at` when it takes effect (a break's start when ending the day on a
 * break); a resume's break reading ends the work the break closed at its start.
 * Warnings never hold the action.
 */
export function kioskVehicleUseWarnings(
	question: KioskVehicleQuestion,
	context: KioskVehicleUse,
	draft: VehicleUseDraft,
	reading: string,
	work: { since: Instant | null; at: Instant },
): VehicleUseWarning[] {
	const input = checkedUse(question, context, draft, reading);
	if (!input) return [];
	const built = buildWorkVehicleUse(input);
	if (!built.ok) return [];
	const vehicleId = organizationVehicleIdOf(built.use);
	const closing = question !== "clock_in" && work.since !== null;
	return vehicleUsePlausibilityWarnings({
		use: built.use,
		start: closing && work.since ? work.since : work.at,
		end: closing ? work.at : null,
		lastRecordedEndKm: vehicleId ? (context.lastEndKmByVehicleId[vehicleId] ?? null) : null,
		vehicleOnOtherLiveWork: vehicleId ? context.vehiclesOnOtherLiveWork.includes(vehicleId) : false,
	});
}
