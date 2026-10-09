import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("./notification-recipients", () => ({ listPersonnelFileNotificationRecipients: vi.fn() }));

const { buildDueForDeletionNotification, DUE_FOR_DELETION_PATH } = await import(
	"./retention-reminders"
);

describe("due-for-deletion notification", () => {
	it("is one reminder per recipient and organization day, linking to the due list", () => {
		const notification = buildDueForDeletionNotification({
			organizationId: "org-1",
			recipientUserId: "user-1",
			localDate: "2034-01-01",
			documentCount: 3,
		});
		expect(notification).toMatchObject({
			userId: "user-1",
			organizationId: "org-1",
			type: "personnel_file_due_for_deletion",
			actionUrl: "/personnel-files/due-for-deletion",
			idempotencyKey: "personnel-file-due:org-1:2034-01-01:user-1",
			message: "3 employee documents are now due for deletion. Review and confirm the purge.",
			metadata: {
				documentCount: 3,
				i18n: {
					titleKey: "common:notifications.content.personnelFileDueForDeletion.title",
					messageKey: "common:notifications.content.personnelFileDueForDeletion.message",
					params: { count: 3 },
				},
			},
		});
		expect(DUE_FOR_DELETION_PATH).toBe(notification.actionUrl);
	});

	it("names no document and no employee", () => {
		const notification = buildDueForDeletionNotification({
			organizationId: "org-1",
			recipientUserId: "user-1",
			localDate: "2034-01-01",
			documentCount: 1,
		});
		expect(notification.message).toBe(
			"1 employee document is now due for deletion. Review and confirm the purge.",
		);
		expect(notification.entityId).toBeUndefined();
	});
});
