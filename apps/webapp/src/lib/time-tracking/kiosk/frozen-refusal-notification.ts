import type { Instant } from "@/lib/datetime/temporal-core";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import {
	fillNotificationTemplate,
	type NotificationParamValue,
	notificationParam,
} from "@/lib/notifications/notification-params";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { KioskFrozenAction, KioskFrozenRefusalReason } from "./frozen-command";
import { kioskRefusalExplanation } from "./frozen-refusal-reasons";

// Each key sits next to its English default so the Tolgee extractor reads both. The action and
// the reason (a `KioskRefusalExplanation`) are ICU selects, so every channel renders them in the
// recipient's language; the stored English fallback picks its branches from the same default.
const employeeCopy = {
	titleKey: "common:notifications.content.kioskCommandRefused.title",
	titleDefault: "Kiosk clocking not recorded",
	messageKey: "common:notifications.content.kioskCommandRefused.message",
	messageDefault:
		"Your {action, select, clock_in {clock-in} clock_out {clock-out} start_break {break start} resume_break {return from break} other {clocking}} at {time} on the kiosk {kioskName} was not recorded: {reason, select, wrong_pin {the PIN was wrong} pin_locked {the kiosk PIN was locked after too many wrong attempts} no_pin {there was no kiosk PIN to check it against} pin_unchecked {the PIN could not be checked} kiosk_retired {the kiosk was revoked or paired again before it reconnected} contact_unverifiable {Z8 could not confirm the kiosk's last connection} outside_window {its time was outside the window Z8 accepts} clock_untrusted {the kiosk's clock could not be trusted for it} not_assigned {the employee is not assigned to the kiosk's location} not_adopted {the organization does not accept offline kiosk clockings} month_closed {the month is closed} holiday {the day is a holiday without time recording} conflict {it conflicts with other recorded time} other {Z8 could not accept it}}. Record your time again or ask your manager to correct it.",
} as const satisfies NotificationCopy;

/** To the managers of a kiosk-only employee (#860 forwarding): the message names the employee. */
const managersCopy = {
	titleKey: "common:notifications.content.kioskCommandRefused.title",
	titleDefault: "Kiosk clocking not recorded",
	messageKey: "common:notifications.content.kioskCommandRefused.forwardedMessage",
	messageDefault:
		"A {action, select, clock_in {clock-in} clock_out {clock-out} start_break {break start} resume_break {return from break} other {clocking}} by {employeeName} at {time} on the kiosk {kioskName} was not recorded: {reason, select, wrong_pin {the PIN was wrong} pin_locked {the kiosk PIN was locked after too many wrong attempts} no_pin {there was no kiosk PIN to check it against} pin_unchecked {the PIN could not be checked} kiosk_retired {the kiosk was revoked or paired again before it reconnected} contact_unverifiable {Z8 could not confirm the kiosk's last connection} outside_window {its time was outside the window Z8 accepts} clock_untrusted {the kiosk's clock could not be trusted for it} not_assigned {the employee is not assigned to the kiosk's location} not_adopted {the organization does not accept offline kiosk clockings} month_closed {the month is closed} holiday {the day is a holiday without time recording} conflict {it conflicts with other recorded time} other {Z8 could not accept it}}. Record the time for them or check it with them.",
} as const satisfies NotificationCopy;

/** The index just past the `}` that closes the `{` at `open`. */
function closingBrace(template: string, open: number): number {
	let depth = 0;
	for (let index = open; index < template.length; index += 1) {
		if (template[index] === "{") depth += 1;
		else if (template[index] === "}") {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
	}
	return template.length;
}

/**
 * Resolves each `{name, select, …}` of an English default to the branch its
 * value picks (else `other`), for the stored fallback text. Other placeholders
 * stay for `fillNotificationTemplate`.
 */
export function resolveIcuSelects(template: string, values: Record<string, string>): string {
	let resolved = "";
	let index = 0;
	const select = /\{(\w+), select, /g;
	for (let match = select.exec(template); match; match = select.exec(template)) {
		const end = closingBrace(template, match.index);
		const body = template.slice(match.index + match[0].length, end - 1);
		const branches = new Map<string, string>();
		for (let at = 0; at < body.length; ) {
			const head = /\s*(\w+)\s*\{/y;
			head.lastIndex = at;
			const branch = head.exec(body);
			if (!branch) break;
			const open = head.lastIndex - 1;
			const close = closingBrace(body, open);
			branches.set(branch[1], body.slice(open + 1, close - 1));
			at = close;
		}
		const value = values[match[1]];
		resolved += template.slice(index, match.index);
		resolved +=
			(value !== undefined ? branches.get(value) : undefined) ?? branches.get("other") ?? match[0];
		index = end;
		select.lastIndex = end;
	}
	return resolved + template.slice(index);
}

export type KioskFrozenRefusalNotificationInput = {
	organizationId: string;
	kioskId: string;
	operationId: string;
	/** The employee's user: the notification is addressed to them, and forwarded if kiosk-only. */
	userId: string;
	kioskName: string;
	/** The zone the kiosk recorded the command in: the claimed time is shown as it was then. */
	timezone: string;
	employeeName: string;
	action: KioskFrozenAction;
	claimedAt: Instant;
	reason: KioskFrozenRefusalReason;
	/** Who will read it: the employee, or (kiosk-only employee) their managers. */
	recipient: "employee" | "managers";
};

/**
 * A refused frozen kiosk command as its employee is told (#1290): the action,
 * the instant it claims in the zone the kiosk recorded, the kiosk and why Z8
 * refused it, so nobody walks away believing they clocked. Addressed to the
 * employee's user; `createNotification` forwards a kiosk-only employee's to
 * their managers (#860), who get the copy that names the employee.
 */
export function buildKioskFrozenRefusalNotification(
	input: KioskFrozenRefusalNotificationInput,
): CreateNotificationParams {
	const explanation = kioskRefusalExplanation(input.reason);
	const copy = input.recipient === "employee" ? employeeCopy : managersCopy;
	const params: Record<string, NotificationParamValue> = {
		action: input.action,
		reason: explanation,
		kioskName: input.kioskName,
		employeeName: input.employeeName,
		time: notificationParam.zonedInstant(input.claimedAt, input.timezone),
	};
	const english = resolveIcuSelects(copy.messageDefault, {
		action: input.action,
		reason: explanation,
	});
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
