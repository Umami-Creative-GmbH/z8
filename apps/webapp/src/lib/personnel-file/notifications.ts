import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { DocumentCategory } from "./document.types";

/**
 * Tells the employee when one of their employee documents becomes shared
 * (#865): uploaded as shared, or changed from HR-only to shared. One
 * notification per share event; changing a document back to HR-only sends
 * nothing. Delivered in-app and on the employee's configured channels.
 */

const logger = createLogger("PersonnelFileNotifications");

const documentSharedCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentShared.title",
	titleDefault: "New document in your personnel file",
	messageKey: "common:notifications.content.personnelFileDocumentShared.message",
	messageDefault: 'The document "{title}" was shared with you.',
} as const;

export const MY_DOCUMENTS_PATH = "/my-documents";

export function buildDocumentSharedNotification(input: {
	organizationId: string;
	recipientUserId: string;
	/** The audit record of the upload or visibility change that shared it. */
	shareEventId: string;
	document: { id: string; title: string; category: DocumentCategory };
}): CreateNotificationParams {
	const params = { title: input.document.title };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personnel_file_document_shared",
		title: documentSharedCopy.titleDefault,
		message: documentSharedCopy.messageDefault.replace("{title}", params.title),
		entityType: "employee_document",
		entityId: input.document.id,
		actionUrl: MY_DOCUMENTS_PATH,
		idempotencyKey: `personnel-file-shared:${input.shareEventId}:${input.recipientUserId}`,
		metadata: {
			category: input.document.category,
			i18n: { ...documentSharedCopy, params },
		},
	};
}

type Database = typeof appDb;

/**
 * Notifies the employee after the sharing change committed. Never throws: the
 * document is shared either way. A former employee is not notified.
 */
export async function notifyDocumentShared(
	database: Database,
	input: {
		organizationId: string;
		shareEventId: string;
		document: { id: string; employeeId: string; title: string; category: DocumentCategory };
	},
): Promise<void> {
	try {
		const [recipient] = await database
			.select({ userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.document.employeeId),
					eq(employee.organizationId, input.organizationId),
					employeeHasOrganizationAccess(),
				),
			)
			.limit(1);
		if (!recipient) return;
		await createNotification(
			buildDocumentSharedNotification({ ...input, recipientUserId: recipient.userId }),
		);
	} catch (error) {
		logger.error(
			{ error, documentId: input.document.id, organizationId: input.organizationId },
			"Failed to notify the employee of a shared document",
		);
	}
}
