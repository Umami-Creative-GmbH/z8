import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { memberIsAccessibleOwnerOrAdmin } from "@/lib/employee-lifecycle/authority-sql";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";

/**
 * Schedule owners (#988): the org admin a scheduled export acts on behalf of.
 * Ownership follows the scheduled-export actions' org-admin rule
 * (`isOrgAdminCasl`), evaluated for the owner instead of the session: an
 * approved owner or admin membership whose employee profile, if any, is
 * active and not past a due departure. A schedule whose owner no longer
 * passes pauses, and every org admin hears about it so one can take it over.
 */

const logger = createLogger("ScheduledExportOwners");

export const SCHEDULED_EXPORTS_PATH = "/settings/scheduled-exports";

type ReadClient = Pick<DatabaseClient, "execute">;
type WriteClient = Pick<DatabaseClient, "execute" | "transaction">;

export interface ScheduleOwner {
	userId: string;
	name: string | null;
	email: string | null;
	/** Whether the user is an org admin of the organization, so may own its schedules. */
	eligible: boolean;
}

/** SQL condition: the user is an org admin of the organization at `now`. */
function isOrgAdmin(organizationId: SQL, userId: SQL, now: Instant): SQL {
	return sql`EXISTS (
		SELECT 1 FROM member m
		WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId}
			AND ${memberIsAccessibleOwnerOrAdmin(sql`${dateFromInstant(now)}::timestamptz`)}
	)`;
}

type OwnerRow = { id: string; name: string | null; email: string | null; eligible: boolean };

/** The named users as owners of the organization's schedules. A missing user is not eligible. */
export async function describeScheduleOwners(
	client: ReadClient,
	input: { organizationId: string; userIds: readonly string[]; now?: Instant },
): Promise<Map<string, ScheduleOwner>> {
	const owners = new Map<string, ScheduleOwner>();
	const userIds = [...new Set(input.userIds)];
	if (userIds.length === 0) return owners;
	const now = input.now ?? systemClock.nowInstant();
	const result = await client.execute<OwnerRow>(sql`
		SELECT u.id, u.name, u.email, ${isOrgAdmin(sql`${input.organizationId}`, sql`u.id`, now)} AS eligible
		FROM "user" u
		WHERE u.id IN (${sql.join(
			userIds.map((id) => sql`${id}`),
			sql`, `,
		)})
	`);
	for (const row of result.rows) {
		owners.set(row.id, {
			userId: row.id,
			name: row.name,
			email: row.email,
			eligible: row.eligible,
		});
	}
	for (const userId of userIds) {
		if (!owners.has(userId))
			owners.set(userId, { userId, name: null, email: null, eligible: false });
	}
	return owners;
}

export async function describeScheduleOwner(
	client: ReadClient,
	input: { organizationId: string; userId: string; now?: Instant },
): Promise<ScheduleOwner> {
	const owners = await describeScheduleOwners(client, { ...input, userIds: [input.userId] });
	return owners.get(input.userId) as ScheduleOwner;
}

/** Every org admin of the organization: who may own its schedules, and who hears when one pauses. */
export async function listScheduleOwnerCandidates(
	client: ReadClient,
	input: { organizationId: string; now?: Instant },
): Promise<ScheduleOwner[]> {
	const now = input.now ?? systemClock.nowInstant();
	const result = await client.execute<Omit<OwnerRow, "eligible">>(sql`
		SELECT DISTINCT u.id, u.name, u.email
		FROM member m
		JOIN "user" u ON u.id = m.user_id
		WHERE m.organization_id = ${input.organizationId}
			AND ${memberIsAccessibleOwnerOrAdmin(sql`${dateFromInstant(now)}::timestamptz`)}
		ORDER BY u.name, u.email, u.id
	`);
	return result.rows.map((row) => ({
		userId: row.id,
		name: row.name,
		email: row.email,
		eligible: true,
	}));
}

export interface PausedSchedule {
	id: string;
	organizationId: string;
	name: string;
	ownerId: string;
	ownerName: string | null;
}

type CandidateRow = {
	id: string;
	organization_id: string;
	name: string;
	owner_id: string;
	owner_name: string | null;
};

/**
 * Pauses every active schedule whose owner is no longer an org admin, within
 * the given scope (all organizations by default). Each pause commits with its
 * automatic `scheduled_export.paused` audit entry, attributed to the owner;
 * then every org admin of the schedule's organization is notified. A schedule
 * already paused is left alone, so each loss pauses and notifies once.
 */
export async function pauseSchedulesWithIneligibleOwners(
	client: WriteClient,
	input: {
		now: Instant;
		organizationId?: string;
		owner?: { userId: string } | { employeeId: string };
		/** The admin whose change took the owner's rights away, when one did. */
		triggeredBy?: string | null;
	},
): Promise<PausedSchedule[]> {
	const scope: SQL[] = [sql`s.is_active = true`];
	if (input.organizationId) scope.push(sql`s.organization_id = ${input.organizationId}`);
	if (input.owner && "userId" in input.owner) scope.push(sql`s.owner_id = ${input.owner.userId}`);
	if (input.owner && "employeeId" in input.owner) {
		scope.push(sql`s.owner_id = (
			SELECT e.user_id FROM employee e
			WHERE e.id = ${input.owner.employeeId}::uuid AND e.organization_id = s.organization_id
		)`);
	}
	const ownerLost = sql`NOT ${isOrgAdmin(sql`s.organization_id`, sql`s.owner_id`, input.now)}`;

	const candidates = await client.execute<CandidateRow>(sql`
		SELECT s.id, s.organization_id, s.name, s.owner_id, u.name AS owner_name
		FROM scheduled_export s
		LEFT JOIN "user" u ON u.id = s.owner_id
		WHERE ${sql.join(scope, sql` AND `)} AND ${ownerLost}
		ORDER BY s.organization_id, s.id
	`);

	const paused: PausedSchedule[] = [];
	await withAuditTrail(async (audit) => {
		// One schedule per transaction: one failure leaves the others paused.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		for (const candidate of candidates.rows) {
			try {
				await client.transaction(async (tx) => {
					// Re-checked under the row lock: a manual pause or a restored owner wins.
					const updated = await tx.execute<{ id: string }>(sql`
						UPDATE scheduled_export s SET is_active = false, updated_at = now()
						WHERE s.id = ${candidate.id}::uuid AND s.organization_id = ${candidate.organization_id}
							AND s.is_active = true AND ${ownerLost}
						RETURNING s.id
					`);
					if (updated.rows.length === 0) return;
					await audit.record(tx, {
						organizationId: candidate.organization_id,
						action: AuditAction.SCHEDULED_EXPORT_PAUSED,
						// Automatic actions are attributed to the schedule owner.
						actorUserId: candidate.owner_id,
						targetType: "scheduled_export",
						targetId: candidate.id,
						metadata: {
							automatic: true,
							reason: "owner_not_org_admin",
							ownerId: candidate.owner_id,
							triggeredBy: input.triggeredBy ?? null,
						},
					});
					paused.push({
						id: candidate.id,
						organizationId: candidate.organization_id,
						name: candidate.name,
						ownerId: candidate.owner_id,
						ownerName: candidate.owner_name,
					});
				});
			} catch (error) {
				logger.error(
					{ error, scheduleId: candidate.id, organizationId: candidate.organization_id },
					"Pausing a scheduled export whose owner is no longer an org admin failed",
				);
			}
		}
	});

	await notifyOrgAdmins(client, paused, input.now);
	return paused;
}

const pausedCopy = {
	titleKey: "common:notifications.content.scheduledExportPaused.title",
	titleDefault: "Scheduled export paused",
	messageKey: "common:notifications.content.scheduledExportPaused.message",
	messageDefault:
		'"{scheduleName}" was paused because its owner, {ownerName}, is no longer an org admin. Make yourself or another org admin its owner to resume it.',
} as const;

export function buildScheduleOwnerLostNotification(input: {
	recipientUserId: string;
	schedule: PausedSchedule;
	pausedAt: Instant;
}): CreateNotificationParams {
	const { schedule } = input;
	const params = {
		scheduleName: schedule.name,
		ownerName: schedule.ownerName ?? schedule.ownerId,
	};
	return {
		userId: input.recipientUserId,
		organizationId: schedule.organizationId,
		type: "scheduled_export_paused",
		title: pausedCopy.titleDefault,
		message: `"${params.scheduleName}" was paused because its owner, ${params.ownerName}, is no longer an org admin. Make yourself or another org admin its owner to resume it.`,
		entityType: "scheduled_export",
		entityId: schedule.id,
		actionUrl: SCHEDULED_EXPORTS_PATH,
		idempotencyKey: `scheduled-export-paused:${schedule.id}:${input.pausedAt.epochMilliseconds}:${input.recipientUserId}`,
		metadata: {
			scheduleId: schedule.id,
			ownerId: schedule.ownerId,
			i18n: { ...pausedCopy, params },
		},
	};
}

async function notifyOrgAdmins(client: ReadClient, paused: PausedSchedule[], now: Instant) {
	const adminsByOrganization = new Map<string, Promise<ScheduleOwner[]>>();
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const schedule of paused) {
		try {
			let admins = adminsByOrganization.get(schedule.organizationId);
			if (!admins) {
				admins = listScheduleOwnerCandidates(client, {
					organizationId: schedule.organizationId,
					now,
				});
				adminsByOrganization.set(schedule.organizationId, admins);
			}
			for (const admin of await admins) {
				await createNotification(
					buildScheduleOwnerLostNotification({
						recipientUserId: admin.userId,
						schedule,
						pausedAt: now,
					}),
				);
			}
		} catch (error) {
			logger.error(
				{ error, scheduleId: schedule.id, organizationId: schedule.organizationId },
				"Notifying org admins of a paused scheduled export failed",
			);
		}
	}
}
