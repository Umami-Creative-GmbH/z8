import { and, asc, eq, lte, sql } from "drizzle-orm";
import {
	type PersonalDetailsChangedEmailNotice,
	personalDetailsChangedEmail,
} from "@/db/schema/personal-details";
import { type Clock, dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { sendEmailNotification } from "@/lib/notifications/email-notifications";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { PersonalDetailsPart } from "./types";

const logger = createLogger("PersonalDetailsChangedNotice");

/** The employee's own settings page, where they see their personal details. */
export const OWN_PERSONAL_DETAILS_PATH = "/settings/profile";

// Each key sits next to its English default so the Tolgee extractor reads both.
const bankAccountChangedCopy = {
	titleKey: "common:notifications.content.personalDetailsChanged.title",
	titleDefault: "Your personal details changed",
	messageKey: "common:notifications.content.personalDetailsChanged.bankAccountChanged",
	messageDefault:
		"Your bank account was changed from {validFrom}. The IBAN now on file ends in {lastFour}. If you didn't expect this change, contact your HR team right away.",
} as const satisfies NotificationCopy;

const bankAccountEndedCopy = {
	titleKey: "common:notifications.content.personalDetailsChanged.title",
	titleDefault: "Your personal details changed",
	messageKey: "common:notifications.content.personalDetailsChanged.bankAccountEnded",
	messageDefault:
		"Your bank account was ended from {validFrom}. No bank account is on file for you from that day. If you didn't expect this change, contact your HR team right away.",
} as const satisfies NotificationCopy;

/** What happened to the part: a new value (of which only the IBAN's last four show), or an end. */
export type PersonalDetailsChangeOutcome =
	| { kind: "changed"; /** The only part of an IBAN a notice ever shows. */ ibanLastFour: string }
	| { kind: "ended" };

/** One applied change to an employee's personal details, as the notice tells it. */
export type PersonalDetailsChange = {
	organizationId: string;
	employeeId: string;
	/** The employee's user: the notice always goes to them, whoever made the change. */
	employeeUserId: string;
	part: PersonalDetailsPart;
	validFrom: string;
	outcome: PersonalDetailsChangeOutcome;
	/** The change's own UUID: one notice and one email per change. */
	changeId: string;
};

/**
 * The mandatory "personal details changed" notice (#2069): the safeguard against
 * payroll diversion. Never more of the IBAN than its last four characters. An end
 * (#2071) has its own wording and names no value.
 */
function buildPersonalDetailsChangedNotice(
	change: PersonalDetailsChange,
): CreateNotificationParams {
	const validFrom = {
		kind: "plainDate",
		date: change.validFrom,
		preset: "dateMedium",
	} as const;
	const content =
		change.outcome.kind === "ended"
			? translatedContent(bankAccountEndedCopy, { validFrom })
			: translatedContent(bankAccountChangedCopy, {
					validFrom,
					lastFour: change.outcome.ibanLastFour,
				});
	return {
		userId: change.employeeUserId,
		organizationId: change.organizationId,
		type: "personal_details_changed",
		title: content.title,
		message: content.message,
		entityType: "employee",
		entityId: change.employeeId,
		actionUrl: OWN_PERSONAL_DETAILS_PATH,
		idempotencyKey: `personal-details-changed:${change.changeId}`,
		metadata: { part: change.part, outcome: change.outcome.kind, i18n: content.i18n },
	};
}

type Writer = Pick<DatabaseClient, "insert">;
type Database = Pick<DatabaseClient, "select" | "update">;

/** An email delivery recorded with a change, to attempt once the change committed. */
export type PendingChangedEmail = { organizationId: string; id: string };

/**
 * Records the mandatory notice inside the change's own transaction, so a change
 * never commits without it: the in-app notice, and the email as a pending
 * delivery (one per change) that `deliverPersonalDetailsChangedEmail` sends after
 * commit and `retryPersonalDetailsChangedEmails` retries until it is sent.
 * Notification preferences are not consulted.
 */
export async function recordPersonalDetailsChangedNotice(
	tx: Writer,
	change: PersonalDetailsChange,
	now: Instant,
): Promise<PendingChangedEmail> {
	const notice = buildPersonalDetailsChangedNotice(change);
	await insertInAppNotification(notice, tx as Parameters<typeof insertInAppNotification>[1]);
	const email: PersonalDetailsChangedEmailNotice = {
		type: "personal_details_changed",
		title: notice.title,
		message: notice.message,
		actionUrl: notice.actionUrl ?? null,
		metadata: notice.metadata ?? null,
	};
	const [row] = await tx
		.insert(personalDetailsChangedEmail)
		.values({
			organizationId: change.organizationId,
			employeeId: change.employeeId,
			recipientUserId: change.employeeUserId,
			changeId: change.changeId,
			notice: email,
			availableAt: dateFromInstant(now),
			createdAt: dateFromInstant(now),
		})
		.returning({ id: personalDetailsChangedEmail.id });
	if (!row) throw new Error("The personal details changed email was not recorded");
	return { organizationId: change.organizationId, id: row.id };
}

/** How long an attempt holds its delivery; one that never settled is tried again after it. */
const ATTEMPT_CLAIM_MINUTES = 10;
/** Waits after the 1st, 2nd, … failed attempt; then every 6 hours until it is sent. */
const RETRY_BACKOFF_MINUTES = [5, 15, 60, 180, 360] as const;

function retryBackoffMinutes(failedAttempts: number): number {
	return RETRY_BACKOFF_MINUTES[Math.min(failedAttempts, RETRY_BACKOFF_MINUTES.length) - 1] ?? 360;
}

/** Only an error code is kept: a transport's own message may hold the address. */
function errorCode(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	return /^[a-z_]{1,64}$/.test(message) ? message : "send_failed";
}

export type ChangedEmailOutcome = "sent" | "unavailable" | "failed" | "not_due";

/**
 * Attempts one pending email delivery, whatever the employee's notification
 * preferences: claims it (so concurrent attempts never both send), sends it
 * durably and settles it. `sent` and `unavailable` (no email can reach the
 * employee: a kiosk-only address or no real transport) end it; a failure leaves
 * it pending for a retry after a backoff. A crash mid-attempt leaves the claim to
 * lapse, so the email is sent at least once.
 */
export async function deliverPersonalDetailsChangedEmail(
	database: Database,
	email: PendingChangedEmail,
	clock: Clock,
): Promise<ChangedEmailOutcome> {
	const table = personalDetailsChangedEmail;
	const claimedAt = clock.nowInstant();
	const ofDelivery = and(
		eq(table.id, email.id),
		eq(table.organizationId, email.organizationId),
		eq(table.status, "pending"),
	);
	const [claimed] = await database
		.update(table)
		.set({
			attempts: sql`${table.attempts} + 1`,
			availableAt: dateFromInstant(claimedAt.add({ minutes: ATTEMPT_CLAIM_MINUTES })),
		})
		.where(and(ofDelivery, lte(table.availableAt, dateFromInstant(claimedAt))))
		.returning({
			attempts: table.attempts,
			notice: table.notice,
			recipientUserId: table.recipientUserId,
		});
	if (!claimed) return "not_due";

	let sent: boolean;
	try {
		sent = await sendEmailNotification(
			{
				userId: claimed.recipientUserId,
				organizationId: email.organizationId,
				type: claimed.notice.type,
				title: claimed.notice.title,
				message: claimed.notice.message,
				metadata: claimed.notice.metadata ?? undefined,
				actionUrl: claimed.notice.actionUrl ?? undefined,
			},
			{ throwOnError: true },
		);
	} catch (error) {
		logger.warn(
			{
				error,
				organizationId: email.organizationId,
				deliveryId: email.id,
				attempts: claimed.attempts,
			},
			"Failed to email the personal details changed notice; it will be retried",
		);
		const failedAt = clock.nowInstant();
		// Only while this attempt still holds the claim; a later one owns it otherwise.
		await database
			.update(table)
			.set({
				availableAt: dateFromInstant(
					failedAt.add({ minutes: retryBackoffMinutes(claimed.attempts) }),
				),
				lastError: errorCode(error),
			})
			.where(and(ofDelivery, eq(table.attempts, claimed.attempts)));
		return "failed";
	}
	await database
		.update(table)
		.set({
			status: sent ? "sent" : "unavailable",
			settledAt: dateFromInstant(clock.nowInstant()),
			lastError: sent ? null : "unavailable",
		})
		.where(ofDelivery);
	return sent ? "sent" : "unavailable";
}

export type ChangedEmailRetryResult = {
	due: number;
	sent: number;
	unavailable: number;
	failed: number;
};

/** Attempts every pending email delivery that is due, oldest first, across organizations. */
export async function retryPersonalDetailsChangedEmails(
	database: Database,
	clock: Clock,
	limit = 100,
): Promise<ChangedEmailRetryResult> {
	const table = personalDetailsChangedEmail;
	const due = await database
		.select({ organizationId: table.organizationId, id: table.id })
		.from(table)
		.where(
			and(eq(table.status, "pending"), lte(table.availableAt, dateFromInstant(clock.nowInstant()))),
		)
		.orderBy(asc(table.availableAt))
		.limit(limit);
	const result: ChangedEmailRetryResult = { due: due.length, sent: 0, unavailable: 0, failed: 0 };
	for (const email of due) {
		const outcome = await deliverPersonalDetailsChangedEmail(database, email, clock).catch(
			(error: unknown) => {
				logger.error(
					{ error, organizationId: email.organizationId, deliveryId: email.id },
					"Failed to attempt the personal details changed email",
				);
				return "failed" as const;
			},
		);
		if (outcome !== "not_due") result[outcome] += 1;
	}
	return result;
}
