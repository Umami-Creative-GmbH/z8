/**
 * Builds one personal data export in the worker (#811): claim the pending
 * row, run every category collector, write the ZIP with its manifest and
 * README, store it privately, complete the row, then tell the requester. The
 * notification and email carry no file link: the file is downloaded from the
 * page the export was started on, while signed in.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	type Instant,
	type PlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { addJob } from "@/lib/queue";
import {
	deletePrivateObject,
	deletePrivateObjectVersions,
	uploadPrivateObject,
} from "@/lib/storage/export-s3-client";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { createInMemoryZipWriter, writePersonalDataArchive } from "./archive";
import type {
	CollectedCategory,
	PersonalDataCollector,
	PersonalDataExportKind,
	PersonalDataExportScope,
} from "./collector";
import { PERSONAL_DATA_COLLECTORS } from "./collectors";
import { loadReadmeTranslator, readmeContentsOf, renderPersonalDataExportReadme } from "./readme";
import { loadPersonalDataReadmeFacts } from "./readme-facts";
import {
	type ClaimedPersonalDataExport,
	claimPersonalDataExport,
	completePersonalDataExport,
	type DeletePersonalDataExportObject,
	failPendingPersonalDataExport,
	failPersonalDataExport,
} from "./store";

const logger = createLogger("PersonalDataExport");

type Database = typeof appDb;

export const MY_DATA_PATH = "/settings/my-data";

export interface PersonalDataExportJobInput {
	organizationId: string;
	exportId: string;
}

export type PersonalDataExportRunResult =
	| { status: "completed" }
	| { status: "failed"; errorCode: string }
	/** Not pending any more (already run, failed by the sweep, or deleted). */
	| { status: "skipped" }
	/** Failed or deleted while running; the stored file was removed. */
	| { status: "discarded" };

export interface PersonalDataExportProcessorDeps {
	now: () => Instant;
	collectors: readonly PersonalDataCollector[];
	upload: typeof uploadPrivateObject;
	deleteObject: DeletePersonalDataExportObject;
	notify: (params: CreateNotificationParams) => Promise<unknown>;
}

const defaultDeps: PersonalDataExportProcessorDeps = {
	now: () => systemClock.nowInstant(),
	collectors: PERSONAL_DATA_COLLECTORS,
	upload: uploadPrivateObject,
	deleteObject: deletePersonalDataExportObject,
	notify: (params) => createNotification(params),
};

class PersonalDataExportBuildError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "PersonalDataExportBuildError";
	}
}

/** The private storage key of one export; a secret that never leaves the server. */
export function personalDataExportStorageKey(input: {
	organizationId: string;
	employeeId: string;
	exportId: string;
}): string {
	return `personal-data-exports/${input.organizationId}/${input.employeeId}/${input.exportId}.zip`;
}

/** Deletes a stored export file: its recorded version, or every version without one. */
export async function deletePersonalDataExportObject(input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}): Promise<void> {
	if (input.versionId) {
		await deletePrivateObject(input);
		return;
	}
	await deletePrivateObjectVersions(input);
}

export async function processPersonalDataExport(
	database: Database,
	input: PersonalDataExportJobInput,
	overrides: Partial<PersonalDataExportProcessorDeps> = {},
): Promise<PersonalDataExportRunResult> {
	const deps = { ...defaultDeps, ...overrides };
	const claimed = await claimPersonalDataExport(database, { ...input, now: deps.now() });
	if (!claimed) return { status: "skipped" };

	let stored: { key: string; bucket: string; versionId: string | null } | null = null;
	try {
		const subject = await loadSubject(database, claimed);
		const scope: PersonalDataExportScope = {
			organizationId: claimed.organizationId,
			employeeId: claimed.employeeId,
			userId: subject.userId,
			kind: claimed.kind,
		};
		const exportedAt = deps.now().toString();
		const categories: CollectedCategory[] = [];
		for (const collector of deps.collectors) {
			categories.push(await collector.collect(database, scope));
		}

		// The employee's UI language, else the organization's; also for admin exports.
		const locale = await resolveRecipientNotificationLocale({
			userId: subject.userId,
			organizationId: claimed.organizationId,
		});
		const facts = await loadPersonalDataReadmeFacts(database, {
			organizationId: claimed.organizationId,
			employeeId: claimed.employeeId,
			now: deps.now(),
		});
		const readme = renderPersonalDataExportReadme({
			...facts,
			contents: readmeContentsOf(categories, deps.collectors),
			t: await loadReadmeTranslator(locale),
			kind: claimed.kind,
			organizationName: subject.organizationName,
			employeeName: subject.employeeName,
			exportedAt,
			categories: categories.map((category) => category.category),
			csvCategories: categories
				.filter((category) => category.parts.some((part) => part.kind === "table"))
				.map((category) => category.category),
		});
		const zip = await writePersonalDataArchive(createInMemoryZipWriter(), {
			exportId: claimed.id,
			scope,
			exportedAt,
			locale,
			readme,
			categories,
		});

		const key = personalDataExportStorageKey({
			organizationId: claimed.organizationId,
			employeeId: claimed.employeeId,
			exportId: claimed.id,
		});
		let upload: { bucket: string; versionId: string | null };
		try {
			upload = await deps.upload(claimed.organizationId, key, zip, "application/zip");
		} catch {
			throw new PersonalDataExportBuildError("storage_failed");
		}
		stored = { key, ...upload };

		const completed = await completePersonalDataExport(database, {
			organizationId: claimed.organizationId,
			exportId: claimed.id,
			file: {
				...stored,
				sizeBytes: zip.byteLength,
				checksumSha256: createHash("sha256").update(zip).digest("hex"),
			},
			now: deps.now(),
		});
		if (!completed) {
			await removeStored(deps, claimed.organizationId, stored);
			return { status: "discarded" };
		}
		logger.info(
			{ exportId: claimed.id, organizationId: claimed.organizationId, sizeBytes: zip.byteLength },
			"Personal data export completed",
		);
		await notifyRequester(deps, claimed, subject.employeeName);
		if (claimed.kind === "admin") {
			await notifySubjectOfAdminExport(database, deps, claimed, subject, locale);
		}
		return { status: "completed" };
	} catch (error) {
		const errorCode = error instanceof PersonalDataExportBuildError ? error.code : "unexpected";
		logger.error(
			{ exportId: claimed.id, organizationId: claimed.organizationId, errorCode, error },
			"Personal data export failed",
		);
		const recorded = await failPersonalDataExport(database, {
			organizationId: claimed.organizationId,
			exportId: claimed.id,
			errorCode,
			now: deps.now(),
		});
		if (stored) await removeStored(deps, claimed.organizationId, stored);
		return recorded ? { status: "failed", errorCode } : { status: "discarded" };
	}
}

async function loadSubject(database: Database, claimed: ClaimedPersonalDataExport) {
	const [row] = await database
		.select({
			userId: employee.userId,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
			organizationName: organization.name,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.where(
			and(eq(employee.id, claimed.employeeId), eq(employee.organizationId, claimed.organizationId)),
		)
		.limit(1);
	if (!row) throw new PersonalDataExportBuildError("employee_not_found");
	return {
		userId: row.userId,
		email: row.email,
		employeeName: buildAuthUserDisplayName(row),
		organizationName: row.organizationName,
		organizationTimezone: resolveOrganizationTimezone(row.organizationTimezone).timezone,
	};
}

type ExportSubject = Awaited<ReturnType<typeof loadSubject>>;

async function removeStored(
	deps: PersonalDataExportProcessorDeps,
	organizationId: string,
	stored: { key: string; bucket: string; versionId: string | null },
): Promise<void> {
	try {
		await deps.deleteObject({ organizationId, ...stored });
	} catch (error) {
		logger.warn({ organizationId, error }, "Could not remove a discarded personal data export");
	}
}

const readyCopy = {
	titleKey: "common:notifications.content.personalDataExportReady.title",
	titleDefault: "Your personal data export is ready",
	messageKey: "common:notifications.content.personalDataExportReady.message",
	messageDefault:
		"Your personal data export is ready. Download it on My data while signed in; it is deleted after 7 days.",
} as const;

const adminReadyCopy = {
	titleKey: "common:notifications.content.personalDataExportReady.adminTitle",
	titleDefault: "Personal data export ready",
	messageKey: "common:notifications.content.personalDataExportReady.adminMessage",
	messageDefault:
		"The personal data export of {employeeName} is ready. Download it from their employee page while signed in; it is deleted after 7 days.",
} as const;

/** The requester's "export ready" notice: in-app and email, never a file link. */
export function buildPersonalDataExportReadyNotification(input: {
	exportId: string;
	organizationId: string;
	employeeId: string;
	kind: PersonalDataExportKind;
	recipientUserId: string;
	employeeName: string;
}): CreateNotificationParams {
	const admin = input.kind === "admin";
	const params = { employeeName: input.employeeName };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personal_data_export_ready",
		title: admin ? adminReadyCopy.titleDefault : readyCopy.titleDefault,
		message: admin
			? `The personal data export of ${input.employeeName} is ready. Download it from their employee page while signed in; it is deleted after 7 days.`
			: readyCopy.messageDefault,
		entityType: "personal_data_export",
		entityId: input.exportId,
		actionUrl: admin ? `/settings/employees/${input.employeeId}` : MY_DATA_PATH,
		idempotencyKey: `personal-data-export-ready:${input.exportId}:${input.recipientUserId}`,
		metadata: {
			exportId: input.exportId,
			kind: input.kind,
			i18n: admin ? { ...adminReadyCopy, params } : { ...readyCopy, params },
		},
	};
}

async function notifyRequester(
	deps: PersonalDataExportProcessorDeps,
	claimed: ClaimedPersonalDataExport,
	employeeName: string,
): Promise<void> {
	if (!claimed.requestedByUserId) return;
	try {
		await deps.notify(
			buildPersonalDataExportReadyNotification({
				exportId: claimed.id,
				organizationId: claimed.organizationId,
				employeeId: claimed.employeeId,
				kind: claimed.kind,
				recipientUserId: claimed.requestedByUserId,
				employeeName,
			}),
		);
	} catch (error) {
		// The export is complete and listed on its page; a lost notice must not fail it.
		logger.warn(
			{ exportId: claimed.id, error },
			"Could not notify the personal data export requester",
		);
	}
}

const adminExportedCopy = {
	titleKey: "common:notifications.content.personalDataExportAdminExported.title",
	titleDefault: "Your personal data was exported",
	messageKey: "common:notifications.content.personalDataExportAdminExported.message",
	messageDefault: "An administrator exported your personal data on {onDate}.",
} as const;

/**
 * The employee's notice that an org admin exported their personal data (in-app
 * and email). `day` is the completion day in the organization's zone; the
 * email shows it in `locale`, the in-app list in the reader's locale.
 */
export function buildPersonalDataExportAdminExportedNotification(input: {
	exportId: string;
	organizationId: string;
	recipientUserId: string;
	day: PlainDate;
	locale: string;
}): CreateNotificationParams {
	const englishDate = formatPlainDate(input.day, "en", "dateMedium");
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personal_data_export_admin_exported",
		title: adminExportedCopy.titleDefault,
		message: `An administrator exported your personal data on ${englishDate}.`,
		entityType: "personal_data_export",
		entityId: input.exportId,
		// Where the employee can request their own copy; never the admin's file.
		actionUrl: MY_DATA_PATH,
		idempotencyKey: `personal-data-export-admin-exported:${input.exportId}`,
		metadata: {
			exportId: input.exportId,
			onDay: input.day.toString(),
			i18n: {
				...adminExportedCopy,
				params: { onDate: formatPlainDate(input.day, input.locale, "dateMedium") },
			},
		},
	};
}

/**
 * Tells a **current** employee that an admin export of their data completed.
 * Former employees get nothing, and neither do kiosk-only employees: they
 * cannot sign in, and their notices would be forwarded to their managers.
 */
async function notifySubjectOfAdminExport(
	database: Database,
	deps: PersonalDataExportProcessorDeps,
	claimed: ClaimedPersonalDataExport,
	subject: ExportSubject,
	locale: string,
): Promise<void> {
	try {
		if (isReservedEmail(subject.email)) return;
		const now = deps.now();
		const access = await resolveEmployeeOrganizationAccess(database, {
			userId: subject.userId,
			organizationId: claimed.organizationId,
			now,
		});
		if (!access.allowed || access.employeeId !== claimed.employeeId) return;
		await deps.notify(
			buildPersonalDataExportAdminExportedNotification({
				exportId: claimed.id,
				organizationId: claimed.organizationId,
				recipientUserId: subject.userId,
				day: plainDateAt(now, subject.organizationTimezone),
				locale,
			}),
		);
	} catch (error) {
		// The export is complete; a lost notice must not fail it.
		logger.warn(
			{ exportId: claimed.id, error },
			"Could not tell the employee about the admin export of their data",
		);
	}
}

/**
 * Queues the build, one BullMQ job per export without automatic retries. A
 * queue failure fails the export, so the employee can request again at once.
 */
export async function enqueuePersonalDataExport(
	database: Database,
	input: PersonalDataExportJobInput,
	now: () => Instant = () => systemClock.nowInstant(),
): Promise<boolean> {
	try {
		await addJob(
			"process-personal-data-export",
			{ type: "personal-data-export", ...input },
			{ priority: 4, attempts: 1, jobId: `personal-data-export-${input.exportId}` },
		);
		return true;
	} catch (error) {
		logger.error({ ...input, error }, "Failed to queue a personal data export");
		await failPendingPersonalDataExport(database, {
			...input,
			errorCode: "enqueue_failed",
			now: now(),
		});
		return false;
	}
}
