import { and, eq, inArray } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceEntry, employee } from "@/db/schema";
import { getEligibleManagerIdsForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { type DepartureTaskHandler, DepartureTaskNeedsResolutionError } from "./delivery";
import type { DeputyAssignment, ReleasedDeputyAssignments } from "./deputy-release";

const logger = createLogger("DeputyReleaseNotifications");

export const DEPUTY_UNAVAILABLE_NOTIFICATION_TYPE = "absence_deputy_unavailable" as const;

export type DeputyUnavailableAudience = "absent_employee" | "manager";

// Full ICU defaults spelled out so the Tolgee extractor pushes the whole message.
const TITLE = {
	key: "common:notifications.content.absenceDeputyUnavailable.title",
	fallback: "Deputy no longer available",
};
const COPY: Record<DeputyUnavailableAudience, { key: string; fallback: string }> = {
	absent_employee: {
		key: "common:notifications.content.absenceDeputyUnavailable.message",
		fallback:
			"{deputyName} is no longer available as deputy for your absence from {startDate} to {endDate}.",
	},
	manager: {
		key: "common:notifications.content.absenceDeputyUnavailable.managerMessage",
		fallback:
			"{deputyName} is no longer available as deputy for {employeeName}'s absence from {startDate} to {endDate}.",
	},
};

/**
 * "Y is no longer available as deputy for your absence from … to …" (#1014).
 * Dates are the absence's plain days in the recipient's locale, never
 * converted between zones; the category is never mentioned.
 */
export function buildDeputyUnavailableNotification(input: {
	organizationId: string;
	recipientUserId: string;
	audience: DeputyUnavailableAudience;
	absence: { id: string; startDate: string; endDate: string };
	absentEmployeeName: string;
	deputyName: string;
	/** The release (departure or deactivation) that cleared the deputy. */
	eventKey: string;
	locale: string;
}): CreateNotificationParams {
	const startDate = formatPlainDate(
		parsePlainDate(input.absence.startDate),
		input.locale,
		"dateMedium",
	);
	const endDate = formatPlainDate(
		parsePlainDate(input.absence.endDate),
		input.locale,
		"dateMedium",
	);
	const params =
		input.audience === "manager"
			? { deputyName: input.deputyName, employeeName: input.absentEmployeeName, startDate, endDate }
			: { deputyName: input.deputyName, startDate, endDate };
	const copy = COPY[input.audience];
	const message =
		input.audience === "manager"
			? `${input.deputyName} is no longer available as deputy for ${input.absentEmployeeName}'s absence from ${startDate} to ${endDate}.`
			: `${input.deputyName} is no longer available as deputy for your absence from ${startDate} to ${endDate}.`;
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: DEPUTY_UNAVAILABLE_NOTIFICATION_TYPE,
		title: TITLE.fallback,
		message,
		entityType: "absence_entry",
		entityId: input.absence.id,
		actionUrl:
			input.audience === "manager"
				? `/team/absences?year=${input.absence.startDate.slice(0, 4)}`
				: "/absences",
		idempotencyKey: `deputy-unavailable:${input.absence.id}:${input.eventKey}:${input.recipientUserId}`,
		metadata: {
			i18n: {
				titleKey: TITLE.key,
				titleDefault: TITLE.fallback,
				messageKey: copy.key,
				messageDefault: copy.fallback,
				params,
			},
		},
	};
}

type NotificationDatabase = Pick<typeof rootDatabase, "select" | "query">;

/**
 * The absent employee, while active, and their eligible managers (direct
 * managers, otherwise the team's primary manager; active managers and admins
 * only). The released deputy never receives it, even as a manager.
 */
export async function resolveDeputyUnavailableRecipients(
	database: NotificationDatabase,
	input: { organizationId: string; absentEmployeeId: string; deputyEmployeeId: string },
): Promise<Array<{ userId: string; audience: DeputyUnavailableAudience }>> {
	const managerIds = (
		await getEligibleManagerIdsForRequester({
			db: database,
			organizationId: input.organizationId,
			requesterEmployeeId: input.absentEmployeeId,
			requesterMode: "existing_workflow",
		})
	).filter((managerId) => managerId !== input.deputyEmployeeId);
	const employees = await database
		.select({ id: employee.id, userId: employee.userId, isActive: employee.isActive })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, [input.absentEmployeeId, ...managerIds]),
			),
		);
	const byId = new Map(employees.map((row) => [row.id, row]));
	const recipients: Array<{ userId: string; audience: DeputyUnavailableAudience }> = [];
	const absent = byId.get(input.absentEmployeeId);
	if (absent?.isActive && input.absentEmployeeId !== input.deputyEmployeeId) {
		recipients.push({ userId: absent.userId, audience: "absent_employee" });
	}
	for (const managerId of managerIds) {
		const manager = byId.get(managerId);
		if (!manager || recipients.some((recipient) => recipient.userId === manager.userId)) continue;
		recipients.push({ userId: manager.userId, audience: "manager" });
	}
	return recipients;
}

export type DeputyUnavailableTransport = {
	send(params: CreateNotificationParams): Promise<unknown>;
	locale(input: { userId: string; organizationId: string }): Promise<string>;
};

async function loadNames(
	database: NotificationDatabase,
	organizationId: string,
	employeeIds: string[],
): Promise<Map<string, string>> {
	const rows = await database
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * One notification per recipient and cleared absence (#1014). Each send has
 * its own idempotency key, so a retried delivery never duplicates the inbox.
 */
export async function notifyDeputyUnavailable(
	deps: { database: NotificationDatabase; transport: DeputyUnavailableTransport },
	released: ReleasedDeputyAssignments,
): Promise<void> {
	if (released.assignments.length === 0) return;
	const names = await loadNames(deps.database, released.organizationId, [
		released.deputyEmployeeId,
		...released.assignments.map((assignment) => assignment.absentEmployeeId),
	]);
	const deputyName = names.get(released.deputyEmployeeId) ?? "";
	for (const assignment of released.assignments) {
		const recipients = await resolveDeputyUnavailableRecipients(deps.database, {
			organizationId: released.organizationId,
			absentEmployeeId: assignment.absentEmployeeId,
			deputyEmployeeId: released.deputyEmployeeId,
		});
		for (const recipient of recipients) {
			const locale = await deps.transport.locale({
				userId: recipient.userId,
				organizationId: released.organizationId,
			});
			await deps.transport.send(
				buildDeputyUnavailableNotification({
					organizationId: released.organizationId,
					recipientUserId: recipient.userId,
					audience: recipient.audience,
					absence: {
						id: assignment.absenceId,
						startDate: assignment.startDate,
						endDate: assignment.endDate,
					},
					absentEmployeeName: names.get(assignment.absentEmployeeId) ?? "",
					deputyName,
					eventKey: released.eventKey,
					locale,
				}),
			);
		}
	}
}

/**
 * After the commit of a deactivation outside a departure: forwards the
 * release's audit entries to the external audit service, as a manual deputy
 * change does, then notifies. Best effort, logged, never undoing the
 * committed release.
 */
export async function notifyDeputyUnavailableAfterCommit(
	deps: { database: NotificationDatabase; transport: DeputyUnavailableTransport },
	released: ReleasedDeputyAssignments | null | undefined,
): Promise<void> {
	released?.audit?.forwardCommitted();
	if (!released || released.assignments.length === 0) return;
	try {
		await notifyDeputyUnavailable(deps, released);
	} catch (error) {
		logger.error(
			{
				error,
				organizationId: released.organizationId,
				deputyEmployeeId: released.deputyEmployeeId,
			},
			"Could not notify that a deputy is no longer available",
		);
	}
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assignmentFromPayload(payload: Record<string, unknown>): DeputyAssignment | null {
	const { absenceId, absentEmployeeId, startDate, endDate } = payload;
	if (
		!isCanonicalUuid(absenceId) ||
		!isCanonicalUuid(absentEmployeeId) ||
		typeof startDate !== "string" ||
		typeof endDate !== "string" ||
		!PLAIN_DATE.test(startDate) ||
		!PLAIN_DATE.test(endDate)
	) {
		return null;
	}
	return { absenceId, absentEmployeeId, startDate, endDate };
}

/**
 * Delivers a departure's `notify_deputy_release` task: one cleared absence,
 * captured with its dates when the departure took effect. A cancelled
 * (deleted) absence needs no notification.
 */
export function createDeputyReleaseNotificationHandler(deps: {
	database: NotificationDatabase;
	transport: DeputyUnavailableTransport;
}): DepartureTaskHandler {
	return async (claim, context) => {
		const assignment = assignmentFromPayload(claim.payload);
		if (!assignment || !claim.departureId) {
			throw new DepartureTaskNeedsResolutionError("invalid_notification_payload");
		}
		const [absence] = await deps.database
			.select({ id: absenceEntry.id })
			.from(absenceEntry)
			.where(
				and(
					eq(absenceEntry.organizationId, claim.organizationId),
					eq(absenceEntry.id, assignment.absenceId),
				),
			)
			.limit(1);
		if (!absence) {
			await context.recordProgress({ outcome: "absence_gone" });
			return;
		}
		await notifyDeputyUnavailable(deps, {
			organizationId: claim.organizationId,
			deputyEmployeeId: claim.employeeId,
			eventKey: claim.departureId,
			assignments: [assignment],
		});
		await context.recordProgress({ outcome: "sent" });
	};
}
