import { describe, expect, it } from "vitest";
import {
	buildDocumentSharedNotification,
	buildEmployeeUploadNotification,
	buildPayslipBatchSharedNotification,
} from "./notifications";

describe("buildEmployeeUploadNotification", () => {
	const input = {
		organizationId: "org-1",
		recipientUserId: "user-officer",
		employeeName: "Anna Example",
		document: {
			id: "22222222-2222-4222-8222-222222222222",
			employeeId: "44444444-4444-4444-8444-444444444444",
			title: "First aid course",
			category: "certificate" as const,
		},
	};

	it("tells the officer who uploaded a certificate, linking to the employee's file", () => {
		const params = buildEmployeeUploadNotification(input);
		expect(params).toMatchObject({
			userId: "user-officer",
			organizationId: "org-1",
			type: "personnel_file_employee_upload",
			title: "New document in a personnel file",
			message: "Anna Example uploaded a certificate",
			entityType: "employee_document",
			entityId: "22222222-2222-4222-8222-222222222222",
			actionUrl: "/personnel-files/44444444-4444-4444-8444-444444444444",
			idempotencyKey:
				"personnel-file-employee-upload:22222222-2222-4222-8222-222222222222:user-officer",
		});
		expect(params.metadata).toMatchObject({
			category: "certificate",
			i18n: {
				titleKey: "common:notifications.content.personnelFileEmployeeUpload.title",
				messageKey: "common:notifications.content.personnelFileEmployeeUpload.certificate",
				params: { name: "Anna Example", title: "First aid course" },
			},
		});
	});

	it("calls an other-category upload a document", () => {
		const params = buildEmployeeUploadNotification({
			...input,
			document: { ...input.document, category: "other" },
		});
		expect(params.message).toBe("Anna Example uploaded a document");
		expect(params.metadata).toMatchObject({
			i18n: { messageKey: "common:notifications.content.personnelFileEmployeeUpload.other" },
		});
	});

	it("names the absence of a sick note and leads to the employee's sick notes (#982)", () => {
		const params = buildEmployeeUploadNotification({
			...input,
			document: {
				...input.document,
				title: "Sick note 12–14 Oct 2026",
				category: "sick_note",
				absence: { startDate: "2026-10-12", endDate: "2026-10-14" },
			},
		});
		expect(params.message.replace(/\s/gu, " ")).toMatch(
			/^Anna Example uploaded a sick note for 12\s?–\s?14 Oct 2026$/,
		);
		expect(params.actionUrl).toBe(
			"/personnel-files/44444444-4444-4444-8444-444444444444?category=sick_note",
		);
		expect(params.metadata).toMatchObject({
			category: "sick_note",
			i18n: {
				messageKey: "common:notifications.content.personnelFileEmployeeUpload.sickNote",
				params: { name: "Anna Example", dateRange: expect.stringContaining("Oct 2026") },
			},
		});
	});

	it("names the recorder of a sick note uploaded on the employee's behalf (#984)", () => {
		const params = buildEmployeeUploadNotification({
			...input,
			uploaderName: "Max Manager",
			document: {
				...input.document,
				title: "Sick note 12–14 Oct 2026",
				category: "sick_note",
				absence: { startDate: "2026-10-12", endDate: "2026-10-14" },
			},
		});
		expect(params.message.replace(/\s/gu, " ")).toMatch(
			/^Max Manager uploaded a sick note for Anna Example, 12\s?–\s?14 Oct 2026$/,
		);
		expect(params.actionUrl).toBe(
			"/personnel-files/44444444-4444-4444-8444-444444444444?category=sick_note",
		);
		expect(params.metadata).toMatchObject({
			dateRangeDays: { startDate: "2026-10-12", endDate: "2026-10-14" },
			i18n: {
				messageKey: "common:notifications.content.personnelFileEmployeeUpload.sickNoteOnBehalf",
				params: {
					uploader: "Max Manager",
					name: "Anna Example",
					dateRange: expect.stringContaining("Oct 2026"),
				},
			},
		});
	});
});

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

describe("buildPayslipBatchSharedNotification", () => {
	it("tells the employee once per batch about their payslip for the pay period", () => {
		const params = buildPayslipBatchSharedNotification({
			organizationId: "org-1",
			recipientUserId: "user-anna",
			batchId: "44444444-4444-4444-8444-444444444444",
			payPeriod: { year: 2026, month: 9 },
			documentCount: 2,
		});
		expect(params).toMatchObject({
			userId: "user-anna",
			type: "personnel_file_document_shared",
			message: "Your payslip for 2026-09 was shared with you.",
			entityType: "payslip_batch",
			entityId: "44444444-4444-4444-8444-444444444444",
			actionUrl: "/my-documents",
			idempotencyKey: "personnel-file-payslip-batch:44444444-4444-4444-8444-444444444444:user-anna",
		});
		expect(params.metadata).toMatchObject({
			documentCount: 2,
			i18n: { params: { payPeriod: "2026-09" } },
		});
	});
});
