"use client";

import { useTranslate } from "@tolgee/react";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type { KioskClockRefusal } from "@/lib/time-tracking/kiosk/protocol";

/** Refusals about the PIN or the employee: the kiosk asks for the PIN again. */
export const KIOSK_PIN_REFUSALS: ReadonlySet<string> = new Set([
	"wrong_pin",
	"pin_locked",
	"no_pin",
	"employee_not_assigned",
	"rate_limited",
]);

/**
 * What the kiosk says when a call did nothing (#862). PIN messages say only
 * what the person must know (wrong, locked until when, none set up), never how
 * many attempts are left or anything about other employees.
 */
export function useKioskRefusalMessage(zone: string, locale: string) {
	const { t } = useTranslate();

	return function message(refusal: KioskClockRefusal | "offline"): string {
		if (refusal === "offline") {
			return t(
				"timeTracking.kiosk.offline.refused",
				"The kiosk is offline. Nothing was recorded; clocking works only while online.",
			);
		}
		switch (refusal.code) {
			case "wrong_pin":
				return t("timeTracking.kiosk.pin.wrong", "That PIN is not correct. Try again.");
			case "pin_locked": {
				const until =
					"lockedUntil" in refusal && typeof refusal.lockedUntil === "string"
						? formatKioskTime(refusal.lockedUntil, zone, locale)
						: "";
				return t(
					"timeTracking.kiosk.pin.locked",
					"Too many wrong PINs. Your PIN is locked until {time}. Try again then, or ask your manager to unlock it.",
					{ time: until },
				);
			}
			case "no_pin":
				return t(
					"timeTracking.kiosk.pin.none",
					"You have no kiosk PIN yet. Ask your manager for one.",
				);
			case "employee_not_assigned":
				return t(
					"timeTracking.kiosk.pin.notAssigned",
					"You cannot clock at this kiosk. Ask your manager.",
				);
			case "rate_limited": {
				const seconds =
					"retryAfter" in refusal && typeof refusal.retryAfter === "number"
						? Math.max(1, Math.ceil(refusal.retryAfter))
						: 60;
				return t(
					"timeTracking.kiosk.pin.rateLimited",
					"Too many PIN attempts at this kiosk. Try again in {seconds} seconds.",
					{ seconds },
				);
			}
			case "already_clocked_in":
				return t("timeTracking.kiosk.refusal.alreadyClockedIn", "You are already clocked in.");
			case "not_clocked_in":
				return t("timeTracking.kiosk.refusal.notClockedIn", "You are not clocked in.");
			case "already_on_break":
			case "on_break":
				return t("timeTracking.kiosk.refusal.onBreak", "You are already on a break.");
			case "no_break_in_progress":
				return t("timeTracking.kiosk.refusal.noBreak", "You are not on a break.");
			case "holiday_blocked":
				return t(
					"timeTracking.kiosk.refusal.holiday",
					"Clocking is blocked today because of a holiday. Ask your manager.",
				);
			case "under_review":
				return t(
					"timeTracking.kiosk.refusal.underReview",
					"Your time for today is under review. Ask your manager.",
				);
			case "month_closed":
				return t(
					"timeTracking.kiosk.refusal.monthClosed",
					"This time is in a closed month and cannot be changed. Ask your manager.",
				);
			case "billing_required":
				return t(
					"timeTracking.kiosk.refusal.billing",
					"Clocking is not available for your organization right now. Contact your admin.",
				);
			case "unconfirmed":
				return t(
					"timeTracking.kiosk.refusal.unconfirmed",
					"The kiosk could not confirm whether this was saved. Check your status before you try again.",
				);
			default:
				return t(
					"timeTracking.kiosk.refusal.generic",
					"That did not work. Nothing was recorded. Try again or ask your manager.",
				);
		}
	};
}
