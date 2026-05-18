import { describe, expect, it } from "vitest";
import { getLocalizedNotificationContent } from "./localized-notification";
import type { NotificationWithMeta } from "./types";

const t = (key: string, defaultValue: string, params?: Record<string, unknown>) => {
	const translations: Record<string, string> = {
		"common:notifications.content.absenceRecorded.title": "Abwesenheit erfasst",
		"common:notifications.content.absenceRecorded.message":
			"{managerName} hat {absenceType} für {dateRange} in Ihrem Namen erfasst.",
		"common:notifications.time.justNow": "gerade eben",
	};

	return Object.entries(params ?? {}).reduce(
		(message, [name, value]) => message.replace(`{${name}}`, String(value)),
		translations[key] ?? defaultValue,
	);
};

function buildNotification(overrides: Partial<NotificationWithMeta>): NotificationWithMeta {
	return {
		id: "notification-1",
		userId: "user-1",
		organizationId: "org-1",
		type: "absence_request_approved",
		title: "Absence recorded",
		message: "Manager recorded Vacation for May 18 - May 18 on your behalf.",
		entityType: "absence_entry",
		entityId: "absence-1",
		actionUrl: "/absences",
		isRead: false,
		readAt: null,
		metadata: JSON.stringify({
			managerRecorded: true,
			managerName: "Mina Manager",
			absenceType: "Urlaub",
			startDate: "2026-05-18",
			endDate: "2026-05-18",
		}),
		createdAt: new Date(),
		timeAgo: "just now",
		...overrides,
	};
}

describe("getLocalizedNotificationContent", () => {
	it("localizes manager-recorded absence notification content from metadata", () => {
		const localized = getLocalizedNotificationContent(buildNotification({}), t, "de");

		expect(localized.title).toBe("Abwesenheit erfasst");
		expect(localized.message).toBe("Mina Manager hat Urlaub für 18. Mai in Ihrem Namen erfasst.");
		expect(localized.timeAgo).toBe("gerade eben");
	});

	it("falls back to stored notification text when metadata is not structured", () => {
		const localized = getLocalizedNotificationContent(
			buildNotification({
				title: "Custom title",
				message: "Custom message",
				metadata: null,
			}),
			t,
			"de",
		);

		expect(localized.title).toBe("Custom title");
		expect(localized.message).toBe("Custom message");
	});
});
