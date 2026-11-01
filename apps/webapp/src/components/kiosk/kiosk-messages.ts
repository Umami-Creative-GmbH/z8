"use client";

import { useTranslate } from "@tolgee/react";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type { KioskClockRefusal } from "@/lib/time-tracking/kiosk/protocol";
import type { KioskHomeNotice } from "./kiosk-turn-flow";

/** Refusals about the PIN or the employee: the kiosk asks for the PIN again. */
export const KIOSK_PIN_REFUSALS: ReadonlySet<string> = new Set([
	"wrong_pin",
	"pin_locked",
	"no_pin",
	"employee_not_assigned",
	"rate_limited",
]);

/**
 * What the home screen says about a badge (#1366): why a scan opened no turn,
 * why a badge turn ended without its action, (#1367) why the camera could not
 * scan, or (#1505) why a fob opened or registered nothing. Never names anyone, and always
 * points to the name-and-PIN way where it can help.
 */
export function useKioskHomeNoticeMessage(offlineMode: boolean) {
	const { t } = useTranslate();

	return function message(notice: KioskHomeNotice): string {
		switch (notice.code) {
			case "badge_not_accepted":
				return t(
					"timeTracking.kiosk.badge.notAccepted",
					"This badge is not accepted at this kiosk. Nothing was recorded. Tap your name to use your PIN, or ask your manager.",
				);
			case "badge_input_disabled":
				return t(
					"timeTracking.kiosk.badge.inputDisabled",
					"Badge scanning is switched off at this kiosk. Tap your name to use your PIN.",
				);
			case "badge_unreadable":
				return t(
					"timeTracking.kiosk.badge.unreadable",
					"This code is not a kiosk badge. Nothing was recorded. Scan your kiosk badge, or tap your name to use your PIN.",
				);
			case "badge_offline":
				return offlineMode
					? t(
							"timeTracking.kiosk.badge.offlinePin",
							"Badge clocking needs a connection. Nothing was recorded. Tap your name to clock with your PIN.",
						)
					: t(
							"timeTracking.kiosk.badge.offline",
							"Badge clocking needs a connection. Nothing was recorded.",
						);
			case "badge_failed":
				return t(
					"timeTracking.kiosk.badge.failed",
					"The badge could not be checked. Nothing was recorded. Scan it again, or tap your name to use your PIN.",
				);
			case "badge_rate_limited":
				return t(
					"timeTracking.kiosk.badge.rateLimited",
					"Too many badge scans at this kiosk. Try again in {seconds} seconds, or tap your name to use your PIN.",
					{ seconds: Math.max(1, Math.ceil(notice.retryAfter)) },
				);
			case "badge_not_recorded":
				return t(
					"timeTracking.kiosk.badge.notRecorded",
					"Your action was not recorded. Scan your badge again to choose it again.",
				);
			case "camera_denied":
				return t(
					"timeTracking.kiosk.camera.denied",
					"The kiosk may not use the camera. Allow camera access for this page in the browser, or tap your name to use your PIN.",
				);
			case "camera_missing":
				return t(
					"timeTracking.kiosk.camera.missing",
					"This kiosk has no camera that can scan. Tap your name to use your PIN.",
				);
			case "camera_unsupported":
				return t(
					"timeTracking.kiosk.camera.unsupported",
					"This browser cannot scan badges with the camera. Tap your name to use your PIN.",
				);
			case "camera_failed":
				return t(
					"timeTracking.kiosk.camera.failed",
					"The camera could not be started. Try again, or tap your name to use your PIN.",
				);
			// Only an offline-mode kiosk clocks by name and PIN without a connection (#1506).
			case "fob_offline":
				return offlineMode
					? t(
							"timeTracking.kiosk.fob.offline",
							"Fobs need a connection. Nothing was recorded. Tap your name to use your PIN.",
						)
					: t(
							"timeTracking.kiosk.fob.offlineOnly",
							"Fobs need a connection. Nothing was recorded.",
						);
			case "fob_failed":
				return t(
					"timeTracking.kiosk.fob.failed",
					"The fob could not be checked. Tap it again, or tap your name to use your PIN.",
				);
			case "fob_reader_disabled":
				return t(
					"timeTracking.kiosk.fob.readerDisabled",
					"The fob reader is switched off at this kiosk. Tap your name to use your PIN.",
				);
			case "fob_rate_limited":
				return t(
					"timeTracking.kiosk.fob.rateLimited",
					"Too many fob taps at this kiosk. Try again in {seconds} seconds, or tap your name to use your PIN.",
					{ seconds: Math.max(1, Math.ceil(notice.retryAfter)) },
				);
			case "fob_linked_to_other_employee":
				return t(
					"timeTracking.kiosk.fob.linkedToOther",
					"This fob is already registered to someone else. Nothing was changed. Ask your manager.",
				);
			case "fob_not_eligible":
				return t(
					"timeTracking.kiosk.fob.notEligible",
					"You cannot register a fob at this kiosk. Nothing was changed. Ask your manager.",
				);
		}
	};
}

/**
 * What the kiosk says when a call did nothing (#862). PIN messages say only
 * what the person must know (wrong, locked until when, none set up), never how
 * many attempts are left or anything about other employees.
 */
export function useKioskRefusalMessage(zone: string, locale: string) {
	const { t } = useTranslate();

	return function message(refusal: KioskClockRefusal | "offline"): string {
		// Only a call the kiosk never sent: one whose reply was lost is uncertain (#1363).
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
			// A clock-out's choice Clocking refused (#887): nothing was recorded.
			case "project_not_allowed":
			case "billable_not_allowed":
				return t(
					"timeTracking.kiosk.refusal.projectNotAllowed",
					"This project can no longer be booked. Nothing was recorded. Choose another one, or keep the current one, and try again.",
				);
			case "work_category_not_allowed":
				return t(
					"timeTracking.kiosk.refusal.workCategoryNotAllowed",
					"This work category can no longer be booked. Nothing was recorded. Choose another one, or keep the current one, and try again.",
				);
			case "not_recorded":
				// Z8 closed the earlier action as not recorded (#1363): only a fresh one may follow.
				return t(
					"timeTracking.kiosk.refusal.notRecorded",
					"Your action was not recorded. Enter your PIN to choose it again.",
				);
			case "attempt_closed":
				return t(
					"timeTracking.kiosk.refusal.attemptClosed",
					"This action was not recorded. Choose it again if you still want it.",
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
