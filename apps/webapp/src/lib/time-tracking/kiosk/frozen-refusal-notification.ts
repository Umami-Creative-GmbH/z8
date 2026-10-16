import type { Instant } from "@/lib/datetime/temporal-core";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import {
	fillNotificationTemplate,
	type NotificationParamValue,
	notificationParam,
} from "@/lib/notifications/notification-params";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { KioskFrozenAction } from "./frozen-command";
import { type KioskRefusalExplanation, kioskRefusalExplanation } from "./frozen-refusal-reasons";

// Each key sits next to its English default so the Tolgee extractor reads both. The action and
// the reason are ICU selects, so every channel renders them in the recipient's language.
const ACTION_SELECT =
	"{action, select, clock_in {clock-in} clock_out {clock-out} start_break {break start} resume_break {return from break} other {clocking}}";
const REASON_SELECT =
	"{reason, select, wrong_pin {the PIN was wrong} pin_locked {the kiosk PIN was locked after too many wrong attempts} pin_unchecked {the PIN could not be checked} kiosk_retired {the kiosk was revoked or paired again before it reconnected} outside_window {its time was outside the window Z8 accepts} clock_untrusted {the kiosk's clock could not be trusted for it} not_assigned {the employee is not assigned to the kiosk's location} not_adopted {the organization does not accept offline kiosk clockings} month_closed {the month is closed} holiday {the day is a holiday without time recording} conflict {it conflicts with other recorded time} other {Z8 could not accept it}}";

const employeeCopy = {
	titleKey: "common:notifications.content.kioskCommandRefused.title",
	titleDefault: "Kiosk clocking not recorded",
	messageKey: "common:notifications.content.kioskCommandRefused.message",
	messageDefault:
		"Your {action, select, clock_in {clock-in} clock_out {clock-out} start_break {break start} resume_break {return from break} other {clocking}} at {time} on the kiosk {kioskName} was not recorded: {reason, select, wrong_pin {the PIN was wrong} pin_locked {the kiosk PIN was locked after too many wrong attempts} pin_unchecked {the PIN could not be checked} kiosk_retired {the kiosk was revoked or paired again before it reconnected} outside_window {its time was outside the window Z8 accepts} clock_untrusted {the kiosk's clock could not be trusted for it} not_assigned {the employee is not assigned to the kiosk's location} not_adopted {the organization does not accept offline kiosk clockings} month_closed {the month is closed} holiday {the day is a holiday without time recording} conflict {it conflicts with other recorded time} other {Z8 could not accept it}}. Record your time again or ask your manager to correct it.",
} as const satisfies NotificationCopy;

/** To the managers of a kiosk-only employee (#860 forwarding): the message names the employee. */
const managersCopy = {
	titleKey: "common:notifications.content.kioskCommandRefused.title",
	titleDefault: "Kiosk clocking not recorded",
	messageKey: "common:notifications.content.kioskCommandRefused.forwardedMessage",
	messageDefault:
		"A {action, select, clock_in {clock-in} clock_out {clock-out} start_break {break start} resume_break {return from break} other {clocking}} by {employeeName} at {time} on the kiosk {kioskName} was not recorded: {reason, select, wrong_pin {the PIN was wrong} pin_locked {the kiosk PIN was locked after too many wrong attempts} pin_unchecked {the PIN could not be checked} kiosk_retired {the kiosk was revoked or paired again before it reconnected} outside_window {its time was outside the window Z8 accepts} clock_untrusted {the kiosk's clock could not be trusted for it} not_assigned {the employee is not assigned to the kiosk's location} not_adopted {the organization does not accept offline kiosk clockings} month_closed {the month is closed} holiday {the day is a holiday without time recording} conflict {it conflicts with other recorded time} other {Z8 could not accept it}}. Record the time for them or check it with them.",
} as const satisfies NotificationCopy;

/** Picks one ICU select branch in English, for the stored fallback text. */
function selectBranch(select: string, value: string): string {
	const branches = new Map(
		[...select.matchAll(/(\w+) \{([^{}]*)\}/g)].map((match) => [match[1], match[2]]),
	);
	return branches.get(value) ?? branches.get("other") ?? value;
}

export type KioskFrozenRefusalNotificationInput = {
	organizationId: string;
	kioskId: string;
	operationId: string;
	/** The employee's user: the notification is addressed to them, and forwarded if kiosk-only. */
	userId: string;
	kioskName: string;
	/** The kiosk's zone: the claimed time is shown as the kiosk would have shown it. */
	kioskTimezone: string;
	employeeName: string;
	action: KioskFrozenAction;
	claimedAt: Instant;
	reason: string;
	/** Who will read it: the employee, or (kiosk-only employee) their managers. */
	recipient: "employee" | "managers";
};

/**
 * A refused frozen kiosk command as its employee is told (#1290): the action,
 * the instant it claims in the kiosk's zone, the kiosk and why Z8 refused it,
 * so nobody walks away believing they clocked. Addressed to the employee's
 * user; `createNotification` forwards a kiosk-only employee's to their
 * managers (#860), who get the copy that names the employee.
 */
export function buildKioskFrozenRefusalNotification(
	input: KioskFrozenRefusalNotificationInput,
): CreateNotificationParams {
	const explanation: KioskRefusalExplanation = kioskRefusalExplanation(input.reason);
	const copy = input.recipient === "employee" ? employeeCopy : managersCopy;
	const params: Record<string, NotificationParamValue> = {
		action: input.action,
		reason: explanation,
		kioskName: input.kioskName,
		employeeName: input.employeeName,
		time: notificationParam.zonedInstant(input.claimedAt, input.kioskTimezone),
	};
	const english = copy.messageDefault
		.replace(ACTION_SELECT, selectBranch(ACTION_SELECT, input.action))
		.replace(REASON_SELECT, selectBranch(REASON_SELECT, explanation));
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: "kiosk_command_refused",
		title: copy.titleDefault,
		message: fillNotificationTemplate(english, params),
		entityType: "kiosk",
		entityId: input.kioskId,
		actionUrl: "/time-tracking",
		idempotencyKey: `kiosk-command-refused:${input.kioskId}:${input.operationId}`,
		metadata: {
			kioskId: input.kioskId,
			operationId: input.operationId,
			reason: input.reason,
			i18n: translatedContent(copy, params).i18n,
		},
	};
}
