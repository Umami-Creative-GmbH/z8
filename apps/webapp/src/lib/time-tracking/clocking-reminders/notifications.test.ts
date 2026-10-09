import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { buildClockingReminderNotification } from "./notifications";

const at = parseInstant;

describe("buildClockingReminderNotification", () => {
	// Live work from Monday 22:00 Berlin reached Monday's 8 h at Tuesday 06:00 Berlin.
	const overnight = {
		type: "forgotten_clock_out_reminder" as const,
		occasionKey: "forgotten_clock_out_reminder:policy_day:employee-1:2026-04-27",
		day: parsePlainDate("2026-04-27"),
		expectedAt: at("2026-04-28T04:00:00Z"),
		shift: null,
	};
	function build(locale: string) {
		const notification = buildClockingReminderNotification({
			reminder: overnight,
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
			locale,
		});
		const i18n = notification.metadata?.i18n as {
			messageKey: string;
			params: Record<string, string>;
		};
		return { message: notification.message, i18n };
	}

	it("names the day whose required hours a policy forgotten clock-out was judged against", () => {
		const { message, i18n } = build("en");
		expect(message).toBe(
			`You reached the required hours for Monday, April 27 at ${i18n.params.endTime} (Europe/Berlin). Clock out if you have finished working.`,
		);
		expect(i18n).toMatchObject({
			messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
			params: { day: "Monday, April 27", timezone: "Europe/Berlin" },
		});
	});

	it("formats the day and time in the employee's locale", () => {
		expect(build("de").i18n.params).toMatchObject({ day: "Montag, 27. April", endTime: "06:00" });
	});
});
