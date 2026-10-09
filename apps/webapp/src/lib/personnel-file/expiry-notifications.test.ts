import { describe, expect, it } from "vitest";
import { buildExpiryReminderNotification } from "./expiry-notifications";

const document = {
	id: "doc-1",
	employeeId: "emp-1",
	employeeName: "Anna Berg",
	title: "First aid certificate",
	category: "certificate" as const,
	expiryDate: "2026-11-30",
};

describe("buildExpiryReminderNotification", () => {
	it("tells an officer which employee's document expires soon and links to the personnel file", () => {
		expect(
			buildExpiryReminderNotification({
				organizationId: "org-1",
				recipientUserId: "officer-1",
				audience: "officer",
				kind: "upcoming",
				document,
			}),
		).toEqual({
			userId: "officer-1",
			organizationId: "org-1",
			type: "personnel_file_expiry_upcoming",
			title: "A document expires soon",
			message: 'The document "First aid certificate" of Anna Berg expires on 2026-11-30.',
			entityType: "employee_document",
			entityId: "doc-1",
			actionUrl: "/personnel-files/emp-1",
			idempotencyKey: "personnel-file-expiry:doc-1:upcoming:2026-11-30:officer-1",
			metadata: {
				category: "certificate",
				expiryDate: "2026-11-30",
				i18n: {
					titleKey: "common:notifications.content.personnelFileExpiryUpcoming.title",
					titleDefault: "A document expires soon",
					messageKey: "common:notifications.content.personnelFileExpiryUpcoming.message",
					messageDefault: 'The document "{title}" of {employee} expires on {expiryDate}.',
					params: {
						title: "First aid certificate",
						employee: "Anna Berg",
						expiryDate: "2026-11-30",
					},
				},
			},
		});
	});

	it("tells the employee about their own document on its expiry date and links to My documents", () => {
		const notification = buildExpiryReminderNotification({
			organizationId: "org-1",
			recipientUserId: "anna",
			audience: "employee",
			kind: "expired_today",
			document,
		});
		expect(notification).toMatchObject({
			userId: "anna",
			type: "personnel_file_expired_today",
			title: "A document expires today",
			message: 'Your document "First aid certificate" expires today.',
			actionUrl: "/my-documents",
			idempotencyKey: "personnel-file-expiry:doc-1:expired_today:2026-11-30:anna",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			titleKey: "common:notifications.content.personnelFileExpiredToday.title",
			messageKey: "common:notifications.content.personnelFileExpiredToday.employeeMessage",
		});
	});
});
