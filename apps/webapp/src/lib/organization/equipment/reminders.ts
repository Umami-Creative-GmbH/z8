import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import {
	employee,
	employeeEmploymentPeriod,
	notificationPreference,
} from "@/db/schema";
import {
	equipmentAssignment,
	equipmentOfficerGrant,
} from "@/db/schema/equipment";
import { equipmentReminderDelivery } from "@/db/schema/equipment-reminders";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { translatedContent } from "@/lib/notifications/notification-copy";
import { notificationParam } from "@/lib/notifications/notification-params";
import {
	deliverNotificationToChannel,
	insertInAppNotification,
	loadNotificationChannelAvailability,
} from "@/lib/notifications/notification-service";
import {
	type CreateNotificationParams,
	isChannelEnabledByDefault,
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
} from "@/lib/notifications/types";
import {
	equipmentAssignmentScope,
	equipmentWorkerAccess,
	lockEquipmentContext,
} from "./access";
import {
	effectiveEquipmentDeadline,
	outstandingEquipmentQuantity,
} from "./deadlines";
import type { EquipmentTransaction } from "./setup";

type Delivery = typeof equipmentReminderDelivery.$inferSelect;
type Subject = { id: string; userId: string };

async function readOccasion(
	tx: EquipmentTransaction,
	organizationId: string,
	assignmentId: string,
	now: Instant,
) {
	const [row] = await tx
		.select({
			assignment: equipmentAssignment,
			timezone: organization.timezone,
			subject: {
				id: employee.id,
				userId: employee.userId,
				name: user.name,
				email: user.email,
				current: employeeHasOrganizationAccess(now),
			},
		})
		.from(equipmentAssignment)
		.innerJoin(
			organization,
			eq(organization.id, equipmentAssignment.organizationId),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, equipmentAssignment.employeeId),
				eq(employee.organizationId, equipmentAssignment.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(equipmentAssignment.organizationId, organizationId),
				eq(equipmentAssignment.id, assignmentId),
			),
		);
	if (!row) return null;
	const quantity = outstandingEquipmentQuantity(row.assignment);
	const deadline = effectiveEquipmentDeadline(
		row.assignment.explicitDeadline,
		row.assignment.departureDeadline,
	);
	if (quantity <= 0 || !deadline) return null;
	const timezone = row.timezone ?? "UTC";
	const today = now.toZonedDateTimeISO(timezone).toPlainDate();
	const days = parsePlainDate(deadline).until(today).days;
	const audience: "employee" | "staff" | null =
		days === -3 || days === 0
			? "employee"
			: days >= 1 && (days - 1) % 7 === 0
				? "staff"
				: null;
	return audience
		? {
				...row,
				timezone,
				quantity,
				deadline,
				audience,
				occasionDate: today.toString(),
			}
		: null;
}
type Occasion = NonNullable<Awaited<ReturnType<typeof readOccasion>>>;

/** Same live grant and current/captured-former-team predicate as the authorized equipment views. */
async function staffRecipients(
	tx: EquipmentTransaction,
	organizationId: string,
	assignmentId: string,
	now: Instant,
) {
	const candidates = await tx
		.select({ userId: member.userId, email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		);
	const officers: string[] = [],
		administrators: string[] = [];
	for (const candidate of candidates) {
		if (isReservedEmail(candidate.email)) continue;
		const access = await equipmentWorkerAccess(
			tx,
			{ organizationId, userId: candidate.userId },
			now,
		);
		if (!access?.canManage) continue;
		// Admin scope must not widen a selected officer grant when deciding whether fallback is needed.
		if (access.canAdminister) administrators.push(candidate.userId);
		if (!access.isOfficer || !access.employeeId) continue;
		const [grant] = await tx
			.select()
			.from(equipmentOfficerGrant)
			.where(
				and(
					eq(equipmentOfficerGrant.organizationId, organizationId),
					eq(equipmentOfficerGrant.employeeId, access.employeeId),
					isNull(equipmentOfficerGrant.revokedAt),
				),
			);
		if (!grant) continue;
		const [covered] = await tx
			.select({ id: equipmentAssignment.id })
			.from(equipmentAssignment)
			.where(
				and(
					eq(equipmentAssignment.organizationId, organizationId),
					eq(equipmentAssignment.id, assignmentId),
					equipmentAssignmentScope(
						{
							...access,
							all: grant.scope === "all",
							teamIds: grant.teamIds,
							employeeIds: grant.employeeIds,
						},
						sql`equipment_assignment`,
						now,
					),
				),
			);
		if (covered) officers.push(candidate.userId);
	}
	return officers.length ? officers : administrators;
}
async function recipientAllowed(
	tx: EquipmentTransaction,
	occasion: Occasion,
	recipientUserId: string,
	now: Instant,
) {
	if (occasion.audience === "staff")
		return (
			await staffRecipients(
				tx,
				occasion.assignment.organizationId,
				occasion.assignment.id,
				now,
			)
		).includes(recipientUserId);
	if (
		!occasion.subject.current ||
		isReservedEmail(occasion.subject.email) ||
		occasion.subject.userId !== recipientUserId
	)
		return false;
	if (occasion.assignment.deactivationId) return false;
	if (occasion.assignment.employmentPeriodId) {
		const [period] = await tx
			.select({ status: employeeEmploymentPeriod.status })
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(
						employeeEmploymentPeriod.organizationId,
						occasion.assignment.organizationId,
					),
					eq(employeeEmploymentPeriod.employeeId, occasion.subject.id),
					eq(
						employeeEmploymentPeriod.id,
						occasion.assignment.employmentPeriodId,
					),
				),
			);
		if (period?.status !== "open") return false;
	}
	return !!(await equipmentWorkerAccess(
		tx,
		{
			organizationId: occasion.assignment.organizationId,
			userId: recipientUserId,
		},
		now,
	));
}
function reminderParams(
	occasion: Occasion,
	recipientUserId: string,
): CreateNotificationParams {
	const copy =
		occasion.audience === "employee"
			? {
					titleKey:
						"common:notifications.content.equipmentReturnReminder.title",
					titleDefault: "Equipment return due",
					messageKey:
						"common:notifications.content.equipmentReturnReminder.message",
					messageDefault:
						"Please return your outstanding equipment ({quantity}) by {deadline}. Open My equipment for the details.",
				}
			: {
					titleKey: "common:notifications.content.equipmentReturnOverdue.title",
					titleDefault: "Equipment return overdue",
					messageKey:
						"common:notifications.content.equipmentReturnOverdue.message",
					messageDefault:
						"{employeeName} has outstanding equipment ({quantity}) due on {deadline}. Open Equipment to arrange its return.",
				};
	const content = translatedContent(copy, {
		employeeName: occasion.subject.name,
		quantity: occasion.quantity,
		deadline: notificationParam.plainDate(parsePlainDate(occasion.deadline)),
	});
	const { assignment, deadline, timezone, occasionDate, audience } = occasion;
	return {
		userId: recipientUserId,
		organizationId: assignment.organizationId,
		type: "equipment_return_reminder",
		title: content.title,
		message: content.message,
		entityType: "equipment_assignment",
		entityId: assignment.id,
		actionUrl:
			audience === "employee"
				? "/my-equipment"
				: `/equipment?holderId=${occasion.subject.id}&outstanding=true`,
		idempotencyKey: `equipment:${assignment.id}:${deadline}:${timezone}:${occasionDate}:${audience}:${recipientUserId}`,
		metadata: { i18n: content.i18n, assignmentId: assignment.id },
	};
}
async function channelEnabled(
	tx: EquipmentTransaction,
	userId: string,
	channel: NotificationChannel,
) {
	const [preference] = await tx
		.select({ enabled: notificationPreference.enabled })
		.from(notificationPreference)
		.where(
			and(
				eq(notificationPreference.userId, userId),
				eq(
					notificationPreference.notificationType,
					"equipment_return_reminder",
				),
				eq(notificationPreference.channel, channel),
			),
		);
	return (
		preference?.enabled ??
		isChannelEnabledByDefault("equipment_return_reminder", channel)
	);
}
async function lockContext(
	tx: EquipmentTransaction,
	organizationId: string,
	userId: string,
	subject: Subject,
) {
	await lockEquipmentContext(tx, { organizationId, userId }, subject);
}
const deliveryWhere = (delivery: Pick<Delivery, "id" | "organizationId">) =>
	and(
		eq(equipmentReminderDelivery.organizationId, delivery.organizationId),
		eq(equipmentReminderDelivery.id, delivery.id),
	);
async function prepare(
	tx: EquipmentTransaction,
	delivery: Delivery,
	now: Instant,
) {
	const current = await readOccasion(
		tx,
		delivery.organizationId,
		delivery.assignmentId,
		now,
	);
	if (
		!current ||
		current.deadline !== delivery.deadline ||
		current.timezone !== delivery.timezone ||
		current.occasionDate !== delivery.occasionDate ||
		current.audience !== delivery.audience ||
		!(await recipientAllowed(tx, current, delivery.recipientUserId, now))
	) {
		await tx
			.update(equipmentReminderDelivery)
			.set({ state: "obsolete" })
			.where(deliveryWhere(delivery));
		return null;
	}
	if (!(await channelEnabled(tx, delivery.recipientUserId, delivery.channel))) {
		await tx
			.update(equipmentReminderDelivery)
			.set({ state: "suppressed" })
			.where(deliveryWhere(delivery));
		return null;
	}
	return reminderParams(current, delivery.recipientUserId);
}

/** Public scheduled-worker seam. No cached reminder decision can authorize dispatch. */
export async function runEquipmentReminders(clock: Clock) {
	const assignments = await db
		.select({
			id: equipmentAssignment.id,
			organizationId: equipmentAssignment.organizationId,
			subject: { id: employee.id, userId: employee.userId },
		})
		.from(equipmentAssignment)
		.innerJoin(
			employee,
			and(
				eq(employee.id, equipmentAssignment.employeeId),
				eq(employee.organizationId, equipmentAssignment.organizationId),
			),
		)
		// Equipment tracking switched off (#1572): no reminders go out. Recipients are
		// checked again through `equipmentWorkerAccess`, which also refuses.
		.innerJoin(
			organization,
			and(
				eq(organization.id, equipmentAssignment.organizationId),
				eq(organization.equipmentEnabled, true),
			),
		)
		.where(eq(equipmentAssignment.returnRequired, true));
	const result = { inAppCreated: 0, externalSent: 0, externalFailed: 0 };
	for (const assignment of assignments) {
		const { organizationId, subject } = assignment;
		// Discovery grants no authority. Each recipient is checked again under access/lifecycle/equipment locks.
		const candidates = await db.transaction(async (tx) => {
			const occasion = await readOccasion(
				tx,
				organizationId,
				assignment.id,
				clock.nowInstant(),
			);
			if (!occasion) return [];
			return occasion.audience === "employee"
				? [subject.userId]
				: staffRecipients(
						tx,
						organizationId,
						assignment.id,
						clock.nowInstant(),
					);
		});
		for (const userId of candidates)
			await db.transaction(async (tx) => {
				await lockContext(tx, organizationId, userId, subject);
				const now = clock.nowInstant();
				const occasion = await readOccasion(
					tx,
					organizationId,
					assignment.id,
					now,
				);
				if (!occasion || !(await recipientAllowed(tx, occasion, userId, now)))
					return;
				for (const channel of NOTIFICATION_CHANNELS)
					await tx
						.insert(equipmentReminderDelivery)
						.values({
							organizationId,
							assignmentId: assignment.id,
							deadline: occasion.deadline,
							timezone: occasion.timezone,
							occasionDate: occasion.occasionDate,
							audience: occasion.audience,
							recipientUserId: userId,
							channel,
							createdAt: dateFromInstant(now),
						})
						.onConflictDoNothing();
			});
		const pending = await db
			.select()
			.from(equipmentReminderDelivery)
			.where(
				and(
					eq(equipmentReminderDelivery.organizationId, organizationId),
					eq(equipmentReminderDelivery.assignmentId, assignment.id),
					eq(equipmentReminderDelivery.state, "pending"),
				),
			);
		for (const delivery of pending) {
			const claimed = await db.transaction(async (tx) => {
				await lockContext(
					tx,
					organizationId,
					delivery.recipientUserId,
					subject,
				);
				const [live] = await tx
					.select()
					.from(equipmentReminderDelivery)
					.where(deliveryWhere(delivery));
				if (live?.state !== "pending") return false;
				const now = clock.nowInstant();
				const params = await prepare(tx, live, now);
				if (!params) return false;
				if (delivery.channel === "in_app") {
					const inserted = await insertInAppNotification(params, tx);
					await tx
						.update(equipmentReminderDelivery)
						.set({ state: "sent", sentAt: dateFromInstant(now) })
						.where(deliveryWhere(delivery));
					if (inserted.kind === "created") result.inAppCreated++;
					return false;
				}
				// Commit before transport: like driving-licence reminders, ambiguous sends are never retried.
				await tx
					.update(equipmentReminderDelivery)
					.set({ state: "attempted" })
					.where(deliveryWhere(delivery));
				return true;
			});
			if (!claimed || delivery.channel === "in_app") continue;
			const channel = delivery.channel;
			await db.transaction(async (tx) => {
				await lockContext(
					tx,
					organizationId,
					delivery.recipientUserId,
					subject,
				);
				const now = clock.nowInstant();
				const params = await prepare(tx, delivery, now);
				if (!params) return;
				try {
					const available = await loadNotificationChannelAvailability(
						organizationId,
						{ durable: true },
					);
					const state = available[channel]
						? await deliverNotificationToChannel(channel, params, null, {
								durable: true,
							})
						: "unavailable";
					await tx
						.update(equipmentReminderDelivery)
						.set({
							state,
							sentAt: state === "sent" ? dateFromInstant(now) : null,
						})
						.where(deliveryWhere(delivery));
					if (state === "sent") result.externalSent++;
				} catch {
					result.externalFailed++;
				}
			});
		}
	}
	return result;
}
