import { describe, expect, it } from "vitest";
import deCommon from "../../../messages/common/de.json";
import enCommon from "../../../messages/common/en.json";
import { getLocalizedNotificationContent } from "./localized-notification";
import type { NotificationWithMeta } from "./types";

const t = (key: string, defaultValue: string, params?: Record<string, unknown>) => {
	const translations: Record<string, string> = {
		"common:notifications.content.absenceRecorded.title": "Abwesenheit erfasst",
		"common:notifications.content.absenceRecorded.message":
			"{managerName} hat {absenceType} für {dateRange} in Ihrem Namen erfasst.",
		"common:notifications.content.teamMemberAdded.title": "Zum Team hinzugefügt",
		"common:notifications.content.teamMemberAdded.message":
			"Sie wurden von {performedByName} zum Team {teamName} hinzugefügt.",
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
	it("has common catalog entries for emitted notification i18n keys", () => {
		expect(enCommon.notifications.content).toMatchObject({
			absenceRequestSubmitted: {
				title: "Absence request submitted",
				message: "Your {categoryName} request for {dateRange} has been submitted and is pending approval.",
			},
			teamMemberAdded: {
				title: "Added to team",
				message: "You have been added to the {teamName} team by {performedByName}.",
			},
			teamMemberRemoved: {
				title: "Removed from team",
				message: "You have been removed from the {teamName} team by {performedByName}.",
			},
			passwordChanged: {
				title: "Password changed",
				message:
					"Your password was successfully changed. If you didn't make this change, please contact support immediately.",
			},
			shiftAssigned: {
				title: "Shift assigned",
				message:
					"You have been assigned a shift on {shiftDate} from {startTime} to {endTime} by {assignedByName}.",
			},
		});

		expect(deCommon.notifications.content).toMatchObject({
			absenceRequestSubmitted: {
				title: "Abwesenheitsanfrage eingereicht",
				message: "Ihre Anfrage für {categoryName} für {dateRange} wurde eingereicht und wartet auf Genehmigung.",
			},
			teamMemberAdded: {
				title: "Zum Team hinzugefügt",
				message: "Sie wurden von {performedByName} zum Team {teamName} hinzugefügt.",
			},
			teamMemberRemoved: {
				title: "Aus dem Team entfernt",
				message: "Sie wurden von {performedByName} aus dem Team {teamName} entfernt.",
			},
			passwordChanged: {
				title: "Passwort geändert",
				message:
					"Ihr Passwort wurde erfolgreich geändert. Wenn Sie diese Änderung nicht vorgenommen haben, wenden Sie sich bitte sofort an den Support.",
			},
			shiftAssigned: {
				title: "Schicht zugewiesen",
				message:
					"Ihnen wurde eine Schicht am {shiftDate} von {startTime} bis {endTime} von {assignedByName} zugewiesen.",
			},
		});
	});

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

	it("localizes notification content from generic i18n metadata", () => {
		const localized = getLocalizedNotificationContent(
			buildNotification({
				title: "Added to team",
				message: "You have been added to the Operations team by Mina Manager.",
				metadata: JSON.stringify({
					i18n: {
						titleKey: "common:notifications.content.teamMemberAdded.title",
						titleDefault: "Added to team",
						messageKey: "common:notifications.content.teamMemberAdded.message",
						messageDefault: "You have been added to the {teamName} team by {performedByName}.",
						params: {
							teamName: "Operations",
							performedByName: "Mina Manager",
						},
					},
				}),
			}),
			t,
			"de",
		);

		expect(localized.title).toBe("Zum Team hinzugefügt");
		expect(localized.message).toBe("Sie wurden von Mina Manager zum Team Operations hinzugefügt.");
	});
});
