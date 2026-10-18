import "server-only";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import {
	fillNotificationTemplate,
	notificationParam,
} from "@/lib/notifications/notification-params";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { DocumentRequestCategory } from "./document-request.types";
import { listPersonnelFileNotificationRecipients } from "./notification-recipients";
import { MY_DOCUMENTS_PATH } from "./notifications";
import { personnelFilePath } from "./paths";

/**
 * Notifications of document requests (#1307), in the personnelFile
 * preference group. The employee hears of a new request and of every
 * decision (accepted, returned, cancelled); the covering officers hear of each
 * submission (#1402); a later slice adds the deadline reminders (#1406). One notification per
 * history event and recipient: the event id is the idempotency key.
 */

const logger = createLogger("PersonnelFileDocumentRequestNotifications");

export const DOCUMENT_REQUEST_NOTIFICATION_ENTITY_TYPE = "employee_document_request";

type NotifiedRequest = {
	id: string;
	employeeId: string;
	title: string;
	category: DocumentRequestCategory;
	/** `YYYY-MM-DD` */
	deadline: string;
};

const requestedCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentRequested.title",
	titleDefault: "Document requested",
	messageKey: "common:notifications.content.personnelFileDocumentRequested.message",
	messageDefault: 'Please upload "{title}" by {deadline}.',
} as const;

const cancelledCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentRequestCancelled.title",
	titleDefault: "Document request cancelled",
	messageKey: "common:notifications.content.personnelFileDocumentRequestCancelled.message",
	messageDefault: 'The request "{title}" was cancelled: {reason}',
} as const;

const returnedCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentRequestReturned.title",
	titleDefault: "Documents returned",
	messageKey: "common:notifications.content.personnelFileDocumentRequestReturned.message",
	messageDefault: 'Please upload "{title}" again by {deadline}: {reason}',
} as const;

const acceptedCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentRequestAccepted.title",
	titleDefault: "Documents accepted",
	messageKey: "common:notifications.content.personnelFileDocumentRequestAccepted.message",
	messageDefault: 'Your documents for "{title}" were accepted.',
} as const;

const DECISION_COPY = {
	cancelled: cancelledCopy,
	returned: returnedCopy,
	accepted: acceptedCopy,
} as const;

export type DocumentRequestDecision = keyof typeof DECISION_COPY;

function idempotencyKey(eventId: string, recipientUserId: string): string {
	return `personnel-file-document-request:${eventId}:${recipientUserId}`;
}

function requestParams(request: NotifiedRequest) {
	return {
		title: request.title,
		deadline: notificationParam.plainDate(parsePlainDate(request.deadline)),
	};
}

/** To the employee: a new request, what to upload and by when. */
export function buildDocumentRequestedNotification(input: {
	organizationId: string;
	recipientUserId: string;
	/** The request's `created` history event. */
	eventId: string;
	request: NotifiedRequest;
}): CreateNotificationParams {
	const params = requestParams(input.request);
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personnel_file_document_requested",
		title: requestedCopy.titleDefault,
		message: fillNotificationTemplate(requestedCopy.messageDefault, params),
		entityType: DOCUMENT_REQUEST_NOTIFICATION_ENTITY_TYPE,
		entityId: input.request.id,
		actionUrl: MY_DOCUMENTS_PATH,
		idempotencyKey: idempotencyKey(input.eventId, input.recipientUserId),
		metadata: {
			category: input.request.category,
			i18n: { ...requestedCopy, params },
		},
	};
}

/** To the employee: an officer accepted, returned or cancelled their request. */
export function buildDocumentRequestDecidedNotification(input: {
	organizationId: string;
	recipientUserId: string;
	/** The decision's history event. */
	eventId: string;
	request: NotifiedRequest;
	decision: DocumentRequestDecision;
	/** The typed reason of a return or cancel. */
	reason: string | null;
}): CreateNotificationParams {
	const copy = DECISION_COPY[input.decision];
	const params = { ...requestParams(input.request), reason: input.reason ?? "" };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personnel_file_document_request_decided",
		title: copy.titleDefault,
		message: fillNotificationTemplate(copy.messageDefault, params),
		entityType: DOCUMENT_REQUEST_NOTIFICATION_ENTITY_TYPE,
		entityId: input.request.id,
		actionUrl: MY_DOCUMENTS_PATH,
		idempotencyKey: idempotencyKey(input.eventId, input.recipientUserId),
		metadata: {
			category: input.request.category,
			decision: input.decision,
			i18n: { ...copy, params },
		},
	};
}

type Database = typeof appDb;

/**
 * Notifies the request's employee after the event committed, unless their
 * employment ended. Never throws: the event happened either way.
 */
export async function notifyDocumentRequestEmployee(
	database: Database,
	input: {
		organizationId: string;
		request: NotifiedRequest;
		build: (recipientUserId: string) => CreateNotificationParams;
	},
): Promise<void> {
	try {
		const [recipient] = await database
			.select({ userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.request.employeeId),
					eq(employee.organizationId, input.organizationId),
					employeeHasOrganizationAccess(),
				),
			)
			.limit(1);
		if (!recipient) return;
		await createNotification(input.build(recipient.userId));
	} catch (error) {
		logger.error(
			{ error, requestId: input.request.id, organizationId: input.organizationId },
			"Failed to notify the employee of a document request",
		);
	}
}

/** Tells the employee about a new request. */
export function notifyDocumentRequested(
	database: Database,
	input: { organizationId: string; eventId: string; request: NotifiedRequest },
): Promise<void> {
	return notifyDocumentRequestEmployee(database, {
		organizationId: input.organizationId,
		request: input.request,
		build: (recipientUserId) => buildDocumentRequestedNotification({ ...input, recipientUserId }),
	});
}

const submittedCopy = {
	titleKey: "common:notifications.content.personnelFileDocumentRequestSubmitted.title",
	titleDefault: "Documents submitted",
	messageKey: "common:notifications.content.personnelFileDocumentRequestSubmitted.message",
	messageDefault: '{name} submitted documents for "{title}". Please review them.',
} as const;

/** To an officer (or owner/admin): the employee submitted documents for a request (#1402). */
export function buildDocumentRequestSubmittedNotification(input: {
	organizationId: string;
	recipientUserId: string;
	/** The request's `submitted` history event. */
	eventId: string;
	employeeName: string;
	request: NotifiedRequest;
}): CreateNotificationParams {
	const params = { ...requestParams(input.request), name: input.employeeName };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personnel_file_document_request_submitted",
		title: submittedCopy.titleDefault,
		message: fillNotificationTemplate(submittedCopy.messageDefault, params),
		entityType: DOCUMENT_REQUEST_NOTIFICATION_ENTITY_TYPE,
		entityId: input.request.id,
		actionUrl: personnelFilePath(input.request.employeeId),
		idempotencyKey: idempotencyKey(input.eventId, input.recipientUserId),
		metadata: {
			category: input.request.category,
			employeeId: input.request.employeeId,
			i18n: { ...submittedCopy, params },
		},
	};
}

/**
 * Tells the officers covering the request's employee and category that the
 * employee submitted, or the owners and admins when no officer covers them
 * (the employee-upload rule). Call after the submission committed. Never throws.
 */
export async function notifyDocumentRequestSubmitted(
	database: Database,
	input: { organizationId: string; eventId: string; request: NotifiedRequest },
): Promise<void> {
	try {
		const [recipients, [subject]] = await Promise.all([
			listPersonnelFileNotificationRecipients(database, {
				organizationId: input.organizationId,
				employeeId: input.request.employeeId,
				category: input.request.category,
			}),
			database
				.select({ name: user.name, employeeNumber: employee.employeeNumber })
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(
					and(
						eq(employee.id, input.request.employeeId),
						eq(employee.organizationId, input.organizationId),
					),
				)
				.limit(1),
		]);
		const employeeName = subject?.name?.trim() || subject?.employeeNumber || "An employee";
		await Promise.all(
			recipients.map((recipientUserId) =>
				createNotification(
					buildDocumentRequestSubmittedNotification({ ...input, recipientUserId, employeeName }),
				),
			),
		);
	} catch (error) {
		logger.error(
			{ error, requestId: input.request.id, organizationId: input.organizationId },
			"Failed to notify officers of a document request submission",
		);
	}
}

/** Tells the employee about an officer's decision on their request. */
export function notifyDocumentRequestDecided(
	database: Database,
	input: {
		organizationId: string;
		eventId: string;
		request: NotifiedRequest;
		decision: DocumentRequestDecision;
		reason: string | null;
	},
): Promise<void> {
	return notifyDocumentRequestEmployee(database, {
		organizationId: input.organizationId,
		request: input.request,
		build: (recipientUserId) =>
			buildDocumentRequestDecidedNotification({ ...input, recipientUserId }),
	});
}
