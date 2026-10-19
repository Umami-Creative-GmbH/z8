import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
	buildDocumentRequestDecidedNotification,
	buildDocumentRequestedNotification,
	buildDocumentRequestReminderNotification,
	buildDocumentRequestSubmittedNotification,
} = await import("./document-request-notifications");

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

describe("buildDocumentRequestReminderNotification", () => {
	const reminded = { ...request, employeeName: "Anna Example" };

	it("reminds the employee 3 days before and on the deadline day, once per claimed reminder", () => {
		const soon = buildDocumentRequestReminderNotification({
			organizationId: "org",
			recipientUserId: "anna",
			markerId: "marker-1",
			audience: "employee",
			kind: "three_days_before",
			request: reminded,
		});
		expect(soon).toMatchObject({
			userId: "anna",
			organizationId: "org",
			type: "personnel_file_document_request_reminder",
			title: "Document due soon",
			message: 'Please upload "First aid refresher" by Nov 30, 2026.',
			entityType: "employee_document_request",
			entityId: request.id,
			actionUrl: "/my-documents",
			idempotencyKey: "personnel-file-document-request-reminder:marker-1:anna",
			metadata: {
				category: "certificate",
				reminder: "three_days_before",
				deadline: "2026-11-30",
				i18n: {
					titleKey: "common:notifications.content.personnelFileDocumentRequestDueSoon.title",
					messageKey: "common:notifications.content.personnelFileDocumentRequestDueSoon.message",
					params: {
						title: "First aid refresher",
						deadline: { kind: "plainDate", date: "2026-11-30" },
					},
				},
			},
		});
		const today = buildDocumentRequestReminderNotification({
			organizationId: "org",
			recipientUserId: "anna",
			markerId: "marker-1",
			audience: "employee",
			kind: "deadline_day",
			request: reminded,
		});
		expect(today).toMatchObject({
			type: "personnel_file_document_request_reminder",
			title: "Document due today",
			message: 'Please upload "First aid refresher" today.',
			idempotencyKey: "personnel-file-document-request-reminder:marker-1:anna",
		});
	});

	it("tells the employee and the officers that a request is overdue", () => {
		const employee = buildDocumentRequestReminderNotification({
			organizationId: "org",
			recipientUserId: "anna",
			markerId: "marker-1",
			audience: "employee",
			kind: "overdue",
			request: reminded,
		});
		expect(employee).toMatchObject({
			type: "personnel_file_document_request_overdue",
			title: "Document overdue",
			message: '"First aid refresher" was due on Nov 30, 2026. Please upload it.',
			actionUrl: "/my-documents",
		});
		const officer = buildDocumentRequestReminderNotification({
			organizationId: "org",
			recipientUserId: "otto",
			markerId: "marker-1",
			audience: "officer",
			kind: "overdue",
			request: reminded,
		});
		expect(officer).toMatchObject({
			userId: "otto",
			type: "personnel_file_document_request_overdue",
			title: "Requested document overdue",
			message: 'Anna Example has not handed in "First aid refresher", due on Nov 30, 2026.',
			actionUrl: `/personnel-files/${request.employeeId}`,
			idempotencyKey: "personnel-file-document-request-reminder:marker-1:otto",
			metadata: {
				i18n: {
					messageKey:
						"common:notifications.content.personnelFileDocumentRequestOverdue.officerMessage",
					params: { employee: "Anna Example" },
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

describe("buildDocumentRequestSubmittedNotification", () => {
	it("tells an officer who submitted for which request, leading to the employee's file", () => {
		const notification = buildDocumentRequestSubmittedNotification({
			organizationId: "org",
			recipientUserId: "otto",
			eventId: "event-5",
			employeeName: "Anna Example",
			request,
		});
		expect(notification).toMatchObject({
			userId: "otto",
			type: "personnel_file_document_request_submitted",
			title: "Documents submitted",
			message: 'Anna Example submitted documents for "First aid refresher". Please review them.',
			entityType: "employee_document_request",
			entityId: request.id,
			actionUrl: `/personnel-files/${request.employeeId}`,
			idempotencyKey: "personnel-file-document-request:event-5:otto",
			metadata: {
				category: "certificate",
				employeeId: request.employeeId,
				i18n: {
					titleKey: "common:notifications.content.personnelFileDocumentRequestSubmitted.title",
					messageKey: "common:notifications.content.personnelFileDocumentRequestSubmitted.message",
					params: { name: "Anna Example", title: "First aid refresher" },
				},
			},
		});
	});
});
