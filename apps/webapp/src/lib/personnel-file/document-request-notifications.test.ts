import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildDocumentRequestDecidedNotification, buildDocumentRequestedNotification } =
	await import("./document-request-notifications");

const request = {
	id: "c0000000-0000-4000-8000-000000000001",
	employeeId: "e0000000-0000-4000-8000-000000000001",
	title: "First aid refresher",
	category: "certificate" as const,
	deadline: "2026-11-30",
};

describe("buildDocumentRequestedNotification", () => {
	it("tells the employee what to upload and by when, once per request event", () => {
		const notification = buildDocumentRequestedNotification({
			organizationId: "org",
			recipientUserId: "anna",
			eventId: "event-1",
			request,
		});
		expect(notification).toMatchObject({
			userId: "anna",
			organizationId: "org",
			type: "personnel_file_document_requested",
			title: "Document requested",
			message: 'Please upload "First aid refresher" by Nov 30, 2026.',
			entityType: "employee_document_request",
			entityId: request.id,
			actionUrl: "/my-documents",
			idempotencyKey: "personnel-file-document-request:event-1:anna",
			metadata: {
				category: "certificate",
				i18n: {
					titleKey: "common:notifications.content.personnelFileDocumentRequested.title",
					messageKey: "common:notifications.content.personnelFileDocumentRequested.message",
					params: {
						title: "First aid refresher",
						deadline: { kind: "plainDate", date: "2026-11-30" },
					},
				},
			},
		});
	});
});

describe("buildDocumentRequestDecidedNotification", () => {
	it("tells the employee a request was cancelled, with the reason", () => {
		const notification = buildDocumentRequestDecidedNotification({
			organizationId: "org",
			recipientUserId: "anna",
			eventId: "event-2",
			request,
			decision: "cancelled",
			reason: "Training was cancelled.",
		});
		expect(notification).toMatchObject({
			type: "personnel_file_document_request_decided",
			title: "Document request cancelled",
			message: 'The request "First aid refresher" was cancelled: Training was cancelled.',
			actionUrl: "/my-documents",
			idempotencyKey: "personnel-file-document-request:event-2:anna",
			metadata: { decision: "cancelled" },
		});
	});

	it("words returns and acceptances", () => {
		const returned = buildDocumentRequestDecidedNotification({
			organizationId: "org",
			recipientUserId: "anna",
			eventId: "event-3",
			request,
			decision: "returned",
			reason: "The scan is unreadable.",
		});
		expect(returned.title).toBe("Documents returned");
		expect(returned.message).toBe(
			'Please upload "First aid refresher" again by Nov 30, 2026: The scan is unreadable.',
		);
		const accepted = buildDocumentRequestDecidedNotification({
			organizationId: "org",
			recipientUserId: "anna",
			eventId: "event-4",
			request,
			decision: "accepted",
			reason: null,
		});
		expect(accepted.title).toBe("Documents accepted");
		expect(accepted.message).toBe('Your documents for "First aid refresher" were accepted.');
	});
});
