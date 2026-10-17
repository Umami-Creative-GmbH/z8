import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	buildKioskFrozenRefusalNotification,
	resolveIcuSelects,
} from "./frozen-refusal-notification";

const base = {
	organizationId: "org-1",
	kioskId: "kiosk-1",
	operationId: "op-1",
	userId: "user-1",
	kioskName: "Front door",
	timezone: "Europe/Berlin",
	employeeName: "Wanda Worker",
	claimedAt: parseInstant("2026-08-03T07:00:00Z"),
};

describe("buildKioskFrozenRefusalNotification", () => {
	it("tells the employee the action, the claimed time in the recorded zone and the reason", () => {
		const notification = buildKioskFrozenRefusalNotification({
			...base,
			action: "start_break",
			reason: "pin_locked",
			recipient: "employee",
		});

		expect(notification).toMatchObject({
			userId: "user-1",
			organizationId: "org-1",
			type: "kiosk_command_refused",
			title: "Kiosk clocking not recorded",
			message:
				"Your break start at Aug 3, 2026, 9:00 AM (Europe/Berlin) on the kiosk Front door was not recorded: the kiosk PIN was locked after too many wrong attempts. Record your time again or ask your manager to correct it.",
			actionUrl: "/time-tracking",
			idempotencyKey: "kiosk-command-refused:kiosk-1:op-1",
		});
		expect(notification.metadata).toMatchObject({
			kioskId: "kiosk-1",
			operationId: "op-1",
			reason: "pin_locked",
			i18n: {
				titleKey: "common:notifications.content.kioskCommandRefused.title",
				messageKey: "common:notifications.content.kioskCommandRefused.message",
				params: {
					action: "start_break",
					reason: "pin_locked",
					kioskName: "Front door",
					employeeName: "Wanda Worker",
					time: {
						kind: "zonedInstant",
						at: "2026-08-03T07:00:00Z",
						timeZone: "Europe/Berlin",
					},
				},
			},
		});
	});

	it("names the employee for managers of a kiosk-only employee", () => {
		const notification = buildKioskFrozenRefusalNotification({
			...base,
			employeeName: "Kim Kiosk",
			action: "clock_out",
			reason: "kiosk_rotated",
			recipient: "managers",
		});

		expect(notification.message).toBe(
			"A clock-out by Kim Kiosk at Aug 3, 2026, 9:00 AM (Europe/Berlin) on the kiosk Front door was not recorded: the kiosk was revoked or paired again before it reconnected. Record the time for them or check it with them.",
		);
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.kioskCommandRefused.forwardedMessage",
			params: { reason: "kiosk_retired" },
		});
	});

	it("explains conflicts and unknown reasons in general terms", () => {
		const conflict = buildKioskFrozenRefusalNotification({
			...base,
			action: "clock_in",
			reason: "already_clocked_in",
			recipient: "employee",
		});
		expect(conflict.message).toContain("was not recorded: it conflicts with other recorded time.");
		const other = buildKioskFrozenRefusalNotification({
			...base,
			action: "resume_break",
			reason: "billing_required",
			recipient: "employee",
		});
		expect(other.message).toContain("Your return from break at");
		expect(other.message).toContain("was not recorded: Z8 could not accept it.");
	});

	it("explains a missing PIN and an unconfirmed connection in their own words", () => {
		const noPin = buildKioskFrozenRefusalNotification({
			...base,
			action: "clock_in",
			reason: "no_pin",
			recipient: "employee",
		});
		expect(noPin.message).toContain(
			"was not recorded: there was no kiosk PIN to check it against.",
		);
		const contact = buildKioskFrozenRefusalNotification({
			...base,
			action: "clock_in",
			reason: "contact_unverifiable",
			recipient: "employee",
		});
		expect(contact.message).toContain(
			"was not recorded: Z8 could not confirm the kiosk's last connection.",
		);
		expect(contact.metadata?.i18n).toMatchObject({ params: { reason: "contact_unverifiable" } });
	});

	it("shows the claimed time in the zone the kiosk recorded", () => {
		const notification = buildKioskFrozenRefusalNotification({
			...base,
			timezone: "Europe/London",
			action: "clock_in",
			reason: "wrong_pin",
			recipient: "employee",
		});
		expect(notification.message).toContain("at Aug 3, 2026, 8:00 AM (Europe/London)");
	});
});

describe("resolveIcuSelects", () => {
	it("picks each select's branch, falls back to other and keeps other placeholders", () => {
		const template =
			"{a, select, x {ex {name}} other {fallback}} and {b, select, y {why} other {else}} for {name}";
		expect(resolveIcuSelects(template, { a: "x", b: "z" })).toBe("ex {name} and else for {name}");
		expect(resolveIcuSelects("no selects {here}", {})).toBe("no selects {here}");
	});
});
