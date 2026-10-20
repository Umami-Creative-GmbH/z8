import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, notificationPreference } from "@/db/schema";
import {
	drivingAuthorization,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { drivingLicenceReminderDelivery } from "@/db/schema/driving-licence-reminders";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { translatedContent } from "@/lib/notifications/notification-copy";
import { notificationParam } from "@/lib/notifications/notification-params";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { isChannelEnabledByDefault } from "@/lib/notifications/types";
import { resolveDrivingLicenceEmployeeAccess } from "./access";
import {
	currentDrivingEmployment,
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import { listDrivingLicenceIntendedDriverIds } from "./intended-drivers";
import { reconcileDrivingLicenceTasks } from "./tasks";
import type { DrivingLicenceTransaction } from "./verifiers";

export interface DrivingLicenceReminderOccasion {
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string | null;
	key: string;
	kind: "deadline" | "suspension";
	classCode: string | null;
	validThrough: string | null;
	leadDays: number | null;
}
export interface DrivingLicenceReminderRecipients {
	employee: { userId: string; name: string; personalRoute: boolean } | null;
	verifiers: Array<{ userId: string; employeeId: string }>;
}
/** Shared with terminal personal-reminder tasks: authority is always resolved at execution time. */
export async function resolveDrivingLicenceReminderRecipients(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	employeeId: string,
	now: Instant,
): Promise<DrivingLicenceReminderRecipients> {
	const [subject] = await tx
		.select({ userId: user.id, name: user.name, email: user.email })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.innerJoin(
			member,
			and(
				eq(member.userId, user.id),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.id, employeeId),
				employeeHasOrganizationAccess(now),
			),
		);
	if (!subject) return { employee: null, verifiers: [] };
	const candidates = await tx
		.select({
			userId: employee.userId,
			employeeId: employee.id,
			email: user.email,
		})
		.from(drivingLicenceVerifierGrant)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingLicenceVerifierGrant.verifierEmployeeId),
				eq(employee.organizationId, organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, organizationId),
				isNull(drivingLicenceVerifierGrant.revokedAt),
			),
		)
		.for("share", { of: drivingLicenceVerifierGrant });
	const verifiers: DrivingLicenceReminderRecipients["verifiers"] = [];
	for (const candidate of candidates) {
		if (isReservedEmail(candidate.email)) continue;
		const access = await resolveDrivingLicenceEmployeeAccess(tx, {
			organizationId,
			userId: candidate.userId,
			employeeId,
			now,
		});
		if (
			access.canVerify &&
			!verifiers.some((v) => v.userId === candidate.userId)
		)
			verifiers.push({
				userId: candidate.userId,
				employeeId: candidate.employeeId,
			});
	}
	return {
		employee: {
			userId: subject.userId,
			name: subject.name,
			personalRoute: !isReservedEmail(subject.email),
		},
		verifiers,
	};
}
/** Current occurrences, including the closest missed lead threshold while the deadline remains current. */
export async function collectDrivingLicenceReminderOccasions(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	employeeId?: string,
): Promise<DrivingLicenceReminderOccasion[]> {
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	if (!policy?.enabled) return [];
	const participants = (
		await listDrivingLicenceIntendedDriverIds(tx, organizationId, employeeId)
	).map((id) => ({ employeeId: id }));
	const occasions: DrivingLicenceReminderOccasion[] = [];
	for (const participant of participants) {
		const employment = await currentDrivingEmployment(
			tx,
			organizationId,
			participant.employeeId,
			now,
		);
		if (!employment?.hasAccess) continue;
		await materializeExpiredDrivingAuthorizations(
			tx,
			organizationId,
			now,
			participant.employeeId,
		);
		const rows = await tx
			.select()
			.from(drivingAuthorization)
			.where(
				and(
					eq(drivingAuthorization.organizationId, organizationId),
					eq(drivingAuthorization.employeeId, participant.employeeId),
				),
			);
		const [global] = await tx
			.select()
			.from(drivingLicenceSubject)
			.where(
				and(
					eq(drivingLicenceSubject.organizationId, organizationId),
					eq(drivingLicenceSubject.employeeId, participant.employeeId),
				),
			);
		const currentGlobal =
			global &&
			global.employmentPeriodId === employment.periodId &&
			(!employment.lastDepartureAt ||
				instantFromDate(global.suspendedAt).epochNanoseconds >
					instantFromDate(employment.lastDepartureAt).epochNanoseconds);
		const common = {
			organizationId,
			employeeId: participant.employeeId,
			employmentPeriodId: employment.periodId,
		};
		if (currentGlobal) {
			occasions.push({
				...common,
				key: `global:${employment.periodId}:${global.suspendedAt.toISOString()}`,
				kind: "suspension",
				classCode: null,
				validThrough: null,
				leadDays: null,
			});
			continue;
		}
		for (const row of rows) {
			if (
				row.employmentPeriodId !== employment.periodId ||
				row.state === "ended" ||
				(employment.lastDepartureAt &&
					(!row.lastSuccessfulAt ||
						instantFromDate(row.lastSuccessfulAt).epochNanoseconds <=
							instantFromDate(employment.lastDepartureAt).epochNanoseconds))
			)
				continue;
			const identity = `${employment.periodId}:${row.id}:${row.supportingCheckId}`;
			if (row.state === "suspended") {
				occasions.push({
					...common,
					key: `suspended:${identity}:${row.suspendedAt?.toISOString()}`,
					kind: "suspension",
					classCode: row.classCode,
					validThrough: row.validThrough,
					leadDays: null,
				});
				continue;
			}
			const today = now.toZonedDateTimeISO(row.deadlineTimezone).toPlainDate();
			const days = today.until(parsePlainDate(row.validThrough)).days;
			const lead = [...policy.reminderLeadDays]
				.filter((d) => days >= 0 && days <= d)
				.sort((a, b) => a - b)[0];
			if (lead === undefined) continue;
			occasions.push({
				...common,
				key: `deadline:${identity}:${row.validThrough}:${row.deadlineTimezone}:${lead}`,
				kind: "deadline",
				classCode: row.classCode,
				validThrough: row.validThrough,
				leadDays: lead,
			});
		}
	}
	return occasions;
}
function reminderParams(
	occasion: DrivingLicenceReminderOccasion,
	recipientUserId: string,
	employeeName: string,
): CreateNotificationParams {
	const suspended = occasion.kind === "suspension";
	const copy = suspended
		? {
				titleKey:
					"common:notifications.content.drivingAuthorizationSuspended.title",
				titleDefault: "Driving authorization suspended",
				messageKey:
					"common:notifications.content.drivingAuthorizationSuspended.message",
				messageDefault:
					"Driving authorization for {employeeName} ({classes}) is suspended. A new check and explicit reinstatement are required before driving.",
			}
		: {
				titleKey: "common:notifications.content.drivingLicenceReminder.title",
				titleDefault: "Driving licence check due",
				messageKey:
					"common:notifications.content.drivingLicenceReminder.message",
				messageDefault:
					"Arrange an original driving licence check for {employeeName}, class {classes}, by {deadline}.",
			};
	const content = translatedContent(copy, {
		employeeName,
		classes: occasion.classCode ?? "*",
		...(occasion.validThrough
			? {
					deadline: notificationParam.plainDate(
						parsePlainDate(occasion.validThrough),
					),
				}
			: {}),
	});
	return {
		userId: recipientUserId,
		organizationId: occasion.organizationId,
		type: suspended
			? "driving_authorization_suspended"
			: "driving_licence_reminder",
		title: content.title,
		message: content.message,
		entityType: "driving_licence",
		entityId: occasion.employeeId,
		actionUrl: `/driving-licence?employeeId=${occasion.employeeId}`,
		idempotencyKey: `driving:${occasion.key}:${recipientUserId}`,
		metadata: {
			i18n: content.i18n,
			employeeId: occasion.employeeId,
			occasionKey: occasion.key,
		},
	};
}
async function prepareReminderEmail(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	id: string,
	now: Instant,
	expectedState: "pending" | "attempted",
) {
	const [delivery] = await tx
		.select()
		.from(drivingLicenceReminderDelivery)
		.where(
			and(
				eq(drivingLicenceReminderDelivery.organizationId, organizationId),
				eq(drivingLicenceReminderDelivery.id, id),
			),
		)
		.for("update");
	if (delivery?.emailState !== expectedState) return;
	const occasions = await collectDrivingLicenceReminderOccasions(
		tx,
		organizationId,
		now,
		delivery.employeeId,
	);
	const current = occasions.find(
		(o) =>
			o.key === delivery.occasionKey &&
			o.employmentPeriodId === delivery.employmentPeriodId,
	);
	const recipients = await resolveDrivingLicenceReminderRecipients(
		tx,
		organizationId,
		delivery.employeeId,
		now,
	);
	const allowed =
		recipients.verifiers.some((v) => v.userId === delivery.recipientUserId) ||
		(recipients.employee?.personalRoute &&
			recipients.employee.userId === delivery.recipientUserId);
	const condition = and(
		eq(drivingLicenceReminderDelivery.organizationId, organizationId),
		eq(drivingLicenceReminderDelivery.id, id),
	);
	if (!current || !allowed || !recipients.employee) {
		await tx
			.update(drivingLicenceReminderDelivery)
			.set({ emailState: "obsolete" })
			.where(condition);
		return;
	}
	const payload = reminderParams(
		current,
		delivery.recipientUserId,
		recipients.employee.name,
	);
	const [preference] = await tx
		.select({ enabled: notificationPreference.enabled })
		.from(notificationPreference)
		.where(
			and(
				eq(notificationPreference.userId, delivery.recipientUserId),
				eq(notificationPreference.notificationType, payload.type),
				eq(notificationPreference.channel, "email"),
			),
		);
	if (
		!(preference?.enabled ?? isChannelEnabledByDefault(payload.type, "email"))
	) {
		await tx
			.update(drivingLicenceReminderDelivery)
			.set({ emailState: "suppressed" })
			.where(condition);
		return;
	}
	return { payload, condition, delivery };
}

export async function runDrivingLicenceReminders(clock: Clock) {
	const organizations = await db
		.select({ organizationId: drivingLicencePolicy.organizationId })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.enabled, true));
	const result = {
		organizationsProcessed: 0,
		inAppCreated: 0,
		emailSent: 0,
		emailFailed: 0,
	};
	for (const { organizationId } of organizations) {
		await db.transaction(async (tx) => {
			await lockDrivingLicenceOrganization(tx, organizationId);
			const now = clock.nowInstant();
			const occasions = await collectDrivingLicenceReminderOccasions(
				tx,
				organizationId,
				now,
			);
			await reconcileDrivingLicenceTasks(tx, organizationId, now, occasions);
			for (const occasion of occasions) {
				const recipients = await resolveDrivingLicenceReminderRecipients(
					tx,
					organizationId,
					occasion.employeeId,
					now,
				);
				if (!recipients.employee) continue;
				const userIds = [
					...new Set([
						...recipients.verifiers.map((v) => v.userId),
						...(recipients.employee.personalRoute
							? [recipients.employee.userId]
							: []),
					]),
				];
				for (const userId of userIds) {
					const payload = reminderParams(
						occasion,
						userId,
						recipients.employee.name,
					);
					const [delivery] = await tx
						.insert(drivingLicenceReminderDelivery)
						.values({
							organizationId,
							employeeId: occasion.employeeId,
							employmentPeriodId: occasion.employmentPeriodId,
							occasionKey: occasion.key,
							recipientUserId: userId,
							createdAt: dateFromInstant(now),
						})
						.onConflictDoNothing()
						.returning();
					if (!delivery) continue;
					const inserted = await insertInAppNotification(payload, tx);
					if (inserted.kind === "created") {
						await tx
							.update(drivingLicenceReminderDelivery)
							.set({ notificationId: inserted.notification.id })
							.where(
								and(
									eq(
										drivingLicenceReminderDelivery.organizationId,
										organizationId,
									),
									eq(drivingLicenceReminderDelivery.id, delivery.id),
								),
							);
						result.inAppCreated++;
					}
				}
			}
		});
		// Email failure cannot roll back mandatory inbox creation or suspension materialization.
		const pending = await db
			.select({ id: drivingLicenceReminderDelivery.id })
			.from(drivingLicenceReminderDelivery)
			.where(
				and(
					eq(drivingLicenceReminderDelivery.organizationId, organizationId),
					eq(drivingLicenceReminderDelivery.emailState, "pending"),
				),
			);
		for (const { id } of pending) {
			const claimed = await db.transaction(async (tx) => {
				await lockDrivingLicenceOrganization(tx, organizationId);
				const now = clock.nowInstant();
				const prepared = await prepareReminderEmail(
					tx,
					organizationId,
					id,
					now,
					"pending",
				);
				if (!prepared) return false;
				await tx
					.update(drivingLicenceReminderDelivery)
					.set({
						emailState: "attempted",
						emailAttempts: prepared.delivery.emailAttempts + 1,
					})
					.where(prepared.condition);
				return true;
			});
			if (!claimed) continue;
			// The attempt is committed before SMTP. An interrupted/ambiguous send is never retried.
			// Recheck live authority and freshness while holding the organization lock for dispatch.
			await db.transaction(async (tx) => {
				await lockDrivingLicenceOrganization(tx, organizationId);
				const now = clock.nowInstant();
				const prepared = await prepareReminderEmail(
					tx,
					organizationId,
					id,
					now,
					"attempted",
				);
				if (!prepared) return;
				const { payload, condition } = prepared;
				try {
					const { sendEmailNotification } = await import(
						"@/lib/notifications/email-notifications"
					);
					const sent = await sendEmailNotification(payload, {
						throwOnError: true,
					});
					await tx
						.update(drivingLicenceReminderDelivery)
						.set({
							emailState: sent ? "sent" : "unavailable",
							emailedAt: sent ? dateFromInstant(now) : null,
						})
						.where(condition);
					if (sent) result.emailSent++;
				} catch {
					result.emailFailed++;
				}
			});
		}
		result.organizationsProcessed++;
	}
	return result;
}
