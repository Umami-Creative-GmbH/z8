import { describe, expect, it } from "vitest";
import { buildDocumentSharedNotification } from "./notifications";

describe("buildDocumentSharedNotification", () => {
	const input = {
		organizationId: "org-1",
		recipientUserId: "user-anna",
		shareEventId: "11111111-1111-4111-8111-111111111111",
		document: {
			id: "22222222-2222-4222-8222-222222222222",
			title: "Payslip February",
			category: "payslip" as const,
		},
	};

	it("tells the employee a document is now in their documents, linking there", () => {
		const params = buildDocumentSharedNotification(input);
		expect(params).toMatchObject({
			userId: "user-anna",
			organizationId: "org-1",
			type: "personnel_file_document_shared",
			title: "New document in your personnel file",
			message: 'The document "Payslip February" was shared with you.',
			entityType: "employee_document",
			entityId: "22222222-2222-4222-8222-222222222222",
			actionUrl: "/my-documents",
		});
		expect(params.metadata).toMatchObject({
			i18n: {
				titleKey: "common:notifications.content.personnelFileDocumentShared.title",
				messageKey: "common:notifications.content.personnelFileDocumentShared.message",
				params: { title: "Payslip February" },
			},
		});
	});

	it("keys idempotency by the share event, so a later re-share notifies again", () => {
		const first = buildDocumentSharedNotification(input);
		const later = buildDocumentSharedNotification({
			...input,
			shareEventId: "33333333-3333-4333-8333-333333333333",
		});
		expect(first.idempotencyKey).toBe(
			"personnel-file-shared:11111111-1111-4111-8111-111111111111:user-anna",
		);
		expect(later.idempotencyKey).not.toBe(first.idempotencyKey);
	});
});
