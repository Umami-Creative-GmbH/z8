import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatNotificationParams } from "@/lib/notifications/notification-params";
import { buildAutoClockOutNotification, planAutoClockOutChannels } from "./notifications";
import { decision } from "./testing.test.fixture";

vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale: vi.fn(),
}));

// Intl separates some parts with no-break or thin spaces; compare the visible text.
const visible = (text: string) => text.replace(/[   ]/g, " ");

describe("automatic clock-out notification", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("stores English text and the cutoff as a typed time at the clock-out entry's offset", () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		const facts = decision();
		const notification = buildAutoClockOutNotification({
			decision: facts,
			recipientUserId: "recipient",
			endUtcOffsetMinutes: 60,
		});
		expect(notification.title).toBe("Automatically clocked out");
		expect(visible(notification.message)).toBe(
			"You were automatically clocked out after 720 minutes of uninterrupted work at Oct 25, 2026, 7:00 AM (Europe/Berlin) because your organization's time limit was reached.",
		);
		expect(notification.actionUrl).toBe(`/calendar/${facts.employeeId}?date=2026-10-24`);
		expect(notification.idempotencyKey).toBe(`automatic-clock-out:${facts.operationId}:recipient`);
		expect(notification.metadata?.i18n).toEqual({
			titleKey: "common:notifications.content.automaticClockOut.title",
			titleDefault: "Automatically clocked out",
			messageKey: "common:notifications.content.automaticClockOut.message",
			messageDefault:
				"You were automatically clocked out after {duration} minutes of uninterrupted work at {cutoff} ({timezone}) because your organization's time limit was reached.",
			params: {
				duration: "720",
				cutoff: { kind: "entryInstant", at: "2026-10-25T06:00:00Z", utcOffsetMinutes: 60 },
				timezone: "Europe/Berlin",
			},
		});
	});

	it("shows the cutoff at the entry's stored offset, not at the zone's rules", () => {
		const notification = buildAutoClockOutNotification({
			decision: decision(),
			recipientUserId: "recipient",
			endUtcOffsetMinutes: 120,
		});
		const params = notification.metadata?.i18n as { params: Record<string, unknown> };
		expect(visible(String(formatNotificationParams(params.params, { locale: "de" }).cutoff))).toBe(
			"25. Okt. 2026, 08:00",
		);
	});

	it("says the work ended at a forgotten break's start, not at the cutoff (#861)", () => {
		const facts = { ...decision(), closesAt: parseInstant("2026-10-24T21:00:00Z") };
		const notification = buildAutoClockOutNotification({
			decision: facts,
			recipientUserId: "recipient",
			endUtcOffsetMinutes: 120,
		});
		expect(visible(notification.message)).toContain(
			"start of your break at Oct 24, 2026, 11:00 PM",
		);
		expect(notification.message).toContain("720 minutes");
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.automaticClockOut.breakMessage",
			params: {
				cutoff: { kind: "entryInstant", at: "2026-10-24T21:00:00Z", utcOffsetMinutes: 120 },
				duration: "720",
			},
		});
	});

	it("reaches a German recipient in German, with the cutoff at the entry's offset", async () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		const { localizeOutboundNotification } = await import(
			"@/lib/notifications/outbound-localization"
		);
		const notification = buildAutoClockOutNotification({
			decision: decision(),
			recipientUserId: "recipient",
			endUtcOffsetMinutes: 60,
		});
		// Email and Telegram render through this; the stored metadata is JSON text.
		const localized = await localizeOutboundNotification({
			...notification,
			organizationId: notification.organizationId,
			metadata: JSON.stringify(notification.metadata),
			locale: "de",
		});
		expect(localized.title).toBe("Automatisch ausgestempelt");
		expect(visible(localized.message)).toContain("am 25. Okt. 2026, 07:00 (Europe/Berlin)");
		expect(localized.message).toContain("720 Minuten");
	});

	it("always includes inbox and stages enabled optional channels for independent availability checks", () => {
		expect(
			planAutoClockOutChannels({
				in_app: false,
				email: true,
				push: false,
				teams: true,
				telegram: false,
				slack: false,
				discord: false,
			}),
		).toEqual(["in_app", "email", "teams"]);
	});
});
