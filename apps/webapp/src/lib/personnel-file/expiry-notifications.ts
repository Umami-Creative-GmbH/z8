import type { CreateNotificationParams, NotificationType } from "@/lib/notifications/types";
import type { DocumentCategory } from "./document.types";
import type { ExpiryReminderKind } from "./expiry";
import { MY_DOCUMENTS_PATH } from "./notifications";

/**
 * Expiry reminder notifications (#869): an upcoming reminder within the
 * organization's lead time and an expired-today reminder on the expiry date.
 * Officers (or owners and admins) are told whose document it is and get a
 * link to that personnel file; the employee, only for shared documents, gets
 * a link to My documents.
 */

export type ExpiryReminderAudience = "employee" | "officer";

const copy = {
	upcoming: {
		officer: {
			titleKey: "common:notifications.content.personnelFileExpiryUpcoming.title",
			titleDefault: "A document expires soon",
			messageKey: "common:notifications.content.personnelFileExpiryUpcoming.message",
			messageDefault: 'The document "{title}" of {employee} expires on {expiryDate}.',
		},
		employee: {
			titleKey: "common:notifications.content.personnelFileExpiryUpcoming.title",
			titleDefault: "A document expires soon",
			messageKey: "common:notifications.content.personnelFileExpiryUpcoming.employeeMessage",
			messageDefault: 'Your document "{title}" expires on {expiryDate}.',
		},
	},
	expired_today: {
		officer: {
			titleKey: "common:notifications.content.personnelFileExpiredToday.title",
			titleDefault: "A document expires today",
			messageKey: "common:notifications.content.personnelFileExpiredToday.message",
			messageDefault: 'The document "{title}" of {employee} expires today.',
		},
		employee: {
			titleKey: "common:notifications.content.personnelFileExpiredToday.title",
			titleDefault: "A document expires today",
			messageKey: "common:notifications.content.personnelFileExpiredToday.employeeMessage",
			messageDefault: 'Your document "{title}" expires today.',
		},
	},
} as const satisfies Record<
	ExpiryReminderKind,
	Record<
		ExpiryReminderAudience,
		{ titleKey: string; titleDefault: string; messageKey: string; messageDefault: string }
	>
>;

const TYPES: Record<ExpiryReminderKind, NotificationType> = {
	upcoming: "personnel_file_expiry_upcoming",
	expired_today: "personnel_file_expired_today",
};

export const PERSONNEL_FILES_PATH = "/personnel-files";

export interface ExpiringDocumentRef {
	id: string;
	employeeId: string;
	employeeName: string;
	title: string;
	category: DocumentCategory;
	/** YYYY-MM-DD */
	expiryDate: string;
}

function fill(template: string, params: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

export function buildExpiryReminderNotification(input: {
	organizationId: string;
	recipientUserId: string;
	audience: ExpiryReminderAudience;
	kind: ExpiryReminderKind;
	document: ExpiringDocumentRef;
}): CreateNotificationParams {
	const { document } = input;
	const text = copy[input.kind][input.audience];
	const params: Record<string, string> =
		input.audience === "officer"
			? { title: document.title, employee: document.employeeName, expiryDate: document.expiryDate }
			: { title: document.title, expiryDate: document.expiryDate };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: TYPES[input.kind],
		title: text.titleDefault,
		message: fill(text.messageDefault, params),
		entityType: "employee_document",
		entityId: document.id,
		actionUrl:
			input.audience === "officer"
				? `${PERSONNEL_FILES_PATH}/${document.employeeId}`
				: MY_DOCUMENTS_PATH,
		idempotencyKey: `personnel-file-expiry:${document.id}:${input.kind}:${document.expiryDate}:${input.recipientUserId}`,
		metadata: {
			category: document.category,
			expiryDate: document.expiryDate,
			i18n: { ...text, params },
		},
	};
}
