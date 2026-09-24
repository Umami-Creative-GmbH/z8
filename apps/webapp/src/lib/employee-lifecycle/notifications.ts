import { sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import type { DepartureReviewKind } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams, NotificationChannel } from "@/lib/notifications/types";
import { formatDepartureCutoff } from "./cutoff-display";
import { type DepartureTaskHandler, DepartureTaskNeedsResolutionError } from "./delivery";

export const OFFBOARDING_REVIEW_NOTIFICATION_TYPE = "employee_offboarding_review" as const;
export const OFFBOARDING_REVIEW_TITLE = "Employee offboarding needs review";

type NotificationDatabase = Pick<typeof rootDatabase, "execute">;

/**
 * Queues one planner task per open review of a departure. Called in the
 * transaction (or right after the write) that opens reviews, so a review is
 * never left without its notification intent. Each review plans once.
 */
export async function enqueueReviewNotifications(
	executor: NotificationDatabase,
	input: { organizationId: string; departureId: string },
): Promise<void> {
	await executor.execute(sql`
		INSERT INTO employee_departure_task
			(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key, payload)
		SELECT r.organization_id, r.employee_id, r.employment_period_id, r.departure_id, 'notify_review',
			'notify-review:' || r.id::text, jsonb_build_object('reviewId', r.id)
		FROM employee_departure_review r
		WHERE r.organization_id = ${input.organizationId}
			AND r.departure_id = ${input.departureId}::uuid AND r.status = 'open'
		ON CONFLICT DO NOTHING
	`);
}

export type ReviewNotificationRecipient = {
	userId: string;
	reason: "organization_admin" | "primary_manager";
};

/**
 * Owners and admins who may resolve departure work, plus the departed
 * employee's primary manager while that manager is an active, approved
 * member of the same organization. An inactive or missing manager simply
 * falls back to the admins. The departed employee never receives it.
 */
export async function resolveReviewRecipients(
	executor: NotificationDatabase,
	input: { organizationId: string; employeeId: string; now: Instant },
): Promise<ReviewNotificationRecipient[]> {
	const at = dateFromInstant(input.now);
	const result = await executor.execute<{
		user_id: string;
		reason: ReviewNotificationRecipient["reason"];
	}>(sql`
		SELECT DISTINCT ON (candidate.user_id) candidate.user_id, candidate.reason
		FROM (
			SELECT m.user_id, 'organization_admin' AS reason, 0 AS priority
			FROM member m
			WHERE m.organization_id = ${input.organizationId} AND m.status = 'approved'
				AND ('owner' = ANY(regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*'))
					OR 'admin' = ANY(regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')))
				AND NOT EXISTS (
					SELECT 1 FROM employee e
					WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
						AND (e.is_active = false
							OR employee_departure_denies_access(e.organization_id, e.id, ${at}::timestamptz))
				)
			UNION ALL
			SELECT manager.user_id, 'primary_manager' AS reason, 1 AS priority
			FROM employee_managers link
			JOIN employee subject
				ON subject.id = link.employee_id AND subject.organization_id = ${input.organizationId}
			JOIN employee manager
				ON manager.id = link.manager_id AND manager.organization_id = subject.organization_id
			JOIN member m
				ON m.user_id = manager.user_id AND m.organization_id = manager.organization_id
			WHERE link.employee_id = ${input.employeeId}::uuid AND link.is_primary = true
				AND manager.is_active = true AND m.status = 'approved'
				AND NOT employee_departure_denies_access(manager.organization_id, manager.id, ${at}::timestamptz)
		) candidate
		WHERE candidate.user_id <> (
			SELECT e.user_id FROM employee e
			WHERE e.organization_id = ${input.organizationId} AND e.id = ${input.employeeId}::uuid
		)
		ORDER BY candidate.user_id, candidate.priority
	`);
	return result.rows.map((row) => ({ userId: row.user_id, reason: row.reason }));
}

export type ReviewNotificationPlan = {
	deliveries: Array<{ recipientUserId: string; channel: NotificationChannel }>;
	suppressed: Array<{ recipientUserId: string; channel: NotificationChannel }>;
};

/**
 * One delivery per recipient and enabled channel. Opted-out channels are
 * recorded as suppressed, never as failures; the durable review stays
 * visible either way.
 */
export function planReviewNotificationDeliveries(
	recipients: readonly ReviewNotificationRecipient[],
	preferences: ReadonlyMap<string, Record<NotificationChannel, boolean>>,
): ReviewNotificationPlan {
	const plan: ReviewNotificationPlan = { deliveries: [], suppressed: [] };
	for (const recipient of recipients) {
		const channels = preferences.get(recipient.userId);
		if (!channels) continue;
		for (const [channel, enabled] of Object.entries(channels) as Array<
			[NotificationChannel, boolean]
		>) {
			(enabled ? plan.deliveries : plan.suppressed).push({
				recipientUserId: recipient.userId,
				channel,
			});
		}
	}
	return plan;
}

// Keys are spelled out so the Tolgee extractor can see every one of them.
const REVIEW_MESSAGES: Record<DepartureReviewKind, { label: string; key: string }> = {
	clock_out: {
		label: "Needs review: offboarding clock-out",
		key: "common:notifications.content.employeeOffboardingReview.clock_out",
	},
	clock_repair: {
		label: "Timer repair required",
		key: "common:notifications.content.employeeOffboardingReview.clock_repair",
	},
	approval_handover: {
		label: "Approval duties need a replacement",
		key: "common:notifications.content.employeeOffboardingReview.approval_handover",
	},
	future_work: {
		label: "Future work needs review",
		key: "common:notifications.content.employeeOffboardingReview.future_work",
	},
	employment_terms: {
		label: "Future employment terms need review",
		key: "common:notifications.content.employeeOffboardingReview.employment_terms",
	},
};

/**
 * Notification content for one review and recipient. The cutoff is shown in
 * the zone frozen on the departure and the recipient's locale, never the
 * server's; in-app rendering re-localizes through the i18n metadata.
 */
export function buildReviewNotification(input: {
	organizationId: string;
	recipientUserId: string;
	review: { id: string; kind: DepartureReviewKind; employeeId: string };
	employeeName: string;
	cutoff: Instant;
	timezone: string;
	locale: string;
}): CreateNotificationParams {
	const cutoff = formatDepartureCutoff(input.cutoff, input.timezone, input.locale);
	const { label: reviewLabel, key: messageKey } = REVIEW_MESSAGES[input.review.kind];
	const message = `${input.employeeName}: ${reviewLabel} (departure effective ${cutoff}, ${input.timezone}).`;
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: OFFBOARDING_REVIEW_NOTIFICATION_TYPE,
		title: OFFBOARDING_REVIEW_TITLE,
		message,
		entityType: "employee_departure_review",
		entityId: input.review.id,
		actionUrl: `/settings/employees/${input.review.employeeId}?review=${input.review.id}`,
		idempotencyKey: `offboarding-review:${input.review.id}:${input.recipientUserId}`,
		metadata: {
			reviewKind: input.review.kind,
			i18n: {
				titleKey: "common:notifications.content.employeeOffboardingReview.title",
				titleDefault: OFFBOARDING_REVIEW_TITLE,
				messageKey,
				messageDefault: `{employeeName}: ${reviewLabel} (departure effective {cutoff}, {timezone}).`,
				params: { employeeName: input.employeeName, cutoff, timezone: input.timezone },
			},
		},
	};
}

export type ReviewNotificationTransport = {
	preferences(userId: string): Promise<Record<NotificationChannel, boolean>>;
	locale(input: { userId: string; organizationId: string }): Promise<string>;
	insertInApp(params: CreateNotificationParams): Promise<unknown>;
	deliver(
		channel: Exclude<NotificationChannel, "in_app">,
		params: CreateNotificationParams,
	): Promise<"sent" | "unavailable">;
};

type ReviewFacts = {
	id: string;
	kind: DepartureReviewKind;
	status: "open" | "resolved";
	employee_id: string;
	departure_id: string;
	employment_period_id: string;
	cutoff_at: Date;
	timezone: string;
	employee_name: string | null;
};

async function loadReview(
	database: NotificationDatabase,
	organizationId: string,
	reviewId: string,
): Promise<ReviewFacts | null> {
	const result = await database.execute<ReviewFacts>(sql`
		SELECT r.id, r.kind, r.status, r.employee_id, r.departure_id, r.employment_period_id,
			d.cutoff_at, d.timezone, u.name AS employee_name
		FROM employee_departure_review r
		JOIN employee_departure d ON d.id = r.departure_id AND d.organization_id = r.organization_id
		JOIN employee e ON e.id = r.employee_id AND e.organization_id = r.organization_id
		LEFT JOIN "user" u ON u.id = e.user_id
		WHERE r.organization_id = ${organizationId} AND r.id = ${reviewId}::uuid
	`);
	return result.rows[0] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Handles `notify_review` tasks in two phases. A planner task (payload
 * `{ reviewId }`) resolves recipients and preferences and queues one
 * delivery task per recipient and channel. A delivery task sends exactly one
 * channel: in-app through the idempotent notification row, external channels
 * behind an attempt marker so a crash mid-send becomes an ambiguous outcome
 * for review instead of a blind resend. A resolved review sends nothing.
 */
export function createReviewNotificationHandler(deps: {
	database: NotificationDatabase;
	clock: { nowInstant(): Instant };
	transport: ReviewNotificationTransport;
}): DepartureTaskHandler {
	return async (claim, context) => {
		const reviewId = claim.payload.reviewId;
		if (typeof reviewId !== "string" || !UUID.test(reviewId)) {
			throw new DepartureTaskNeedsResolutionError("invalid_notification_payload");
		}
		const review = await loadReview(deps.database, claim.organizationId, reviewId);
		if (!review || review.status !== "open") {
			await context.recordProgress({ outcome: "review_closed" });
			return;
		}
		const now = deps.clock.nowInstant();
		const recipients = await resolveReviewRecipients(deps.database, {
			organizationId: claim.organizationId,
			employeeId: review.employee_id,
			now,
		});

		const channel = claim.payload.channel;
		const recipientUserId = claim.payload.recipientUserId;
		if (channel === undefined && recipientUserId === undefined) {
			const preferences = new Map<string, Record<NotificationChannel, boolean>>();
			for (const recipient of recipients) {
				preferences.set(recipient.userId, await deps.transport.preferences(recipient.userId));
			}
			const plan = planReviewNotificationDeliveries(recipients, preferences);
			for (const delivery of plan.deliveries) {
				await deps.database.execute(sql`
					INSERT INTO employee_departure_task
						(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key,
							payload, available_at)
					VALUES (${claim.organizationId}, ${review.employee_id}::uuid,
						${review.employment_period_id}::uuid, ${review.departure_id}::uuid, 'notify_review',
						${`notify-review:${reviewId}:${delivery.recipientUserId}:${delivery.channel}`},
						${JSON.stringify({
							reviewId,
							recipientUserId: delivery.recipientUserId,
							channel: delivery.channel,
						})}::jsonb,
						${dateFromInstant(now)})
					ON CONFLICT DO NOTHING
				`);
			}
			await context.recordProgress({
				outcome: "planned",
				deliveries: plan.deliveries.length,
				suppressed: plan.suppressed,
			});
			return;
		}

		if (typeof recipientUserId !== "string" || typeof channel !== "string" || !isChannel(channel)) {
			throw new DepartureTaskNeedsResolutionError("invalid_notification_payload");
		}
		// Recipients are re-validated at delivery: no foreign or departed user.
		if (!recipients.some((recipient) => recipient.userId === recipientUserId)) {
			await context.recordProgress({ outcome: "recipient_ineligible" });
			return;
		}
		const locale = await deps.transport.locale({
			userId: recipientUserId,
			organizationId: claim.organizationId,
		});
		const params = buildReviewNotification({
			organizationId: claim.organizationId,
			recipientUserId,
			review: { id: review.id, kind: review.kind, employeeId: review.employee_id },
			employeeName: review.employee_name ?? "Employee",
			cutoff: instantFromDate(new Date(review.cutoff_at)),
			timezone: review.timezone,
			locale,
		});
		if (channel === "in_app") {
			await deps.transport.insertInApp(params);
			await context.recordProgress({ outcome: "sent" });
			return;
		}
		if (typeof claim.payload.attemptedAt === "string") {
			// A previous attempt may or may not have reached the provider.
			throw new DepartureTaskNeedsResolutionError("delivery_ambiguous");
		}
		await context.recordProgress({ attemptedAt: dateFromInstant(now).toISOString() });
		let outcome: "sent" | "unavailable";
		try {
			outcome = await deps.transport.deliver(channel, params);
		} catch (error) {
			// A reported transport failure is known not delivered: retry is safe.
			await context.recordProgress({ attemptedAt: null });
			throw error;
		}
		await context.recordProgress({ outcome });
	};
}

const CHANNELS = new Set<NotificationChannel>([
	"in_app",
	"push",
	"email",
	"teams",
	"telegram",
	"discord",
	"slack",
]);

function isChannel(value: string): value is NotificationChannel {
	return CHANNELS.has(value as NotificationChannel);
}
