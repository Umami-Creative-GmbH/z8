import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, notificationPreference } from "@/db/schema";
import {
	drivingAuthorization,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import {
	drivingLicencePolicy,
	drivingLicencePolicyRevision,
} from "@/db/schema/driving-licence-policy";
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
import {
	type DrivingLicenceOffPeriod,
	drivingLicenceOffPeriods,
	reminderOccasionFellWhileOff,
} from "./off-periods";
import { DRIVING_LICENCE_PATH, drivingLicenceCheckPath } from "./paths";
import { reconcileDrivingLicenceTasks } from "./tasks";
import type {
	DrivingLicenceDatabase,
	DrivingLicenceTransaction,
} from "./verifiers";

export interface DrivingLicenceReminderOccasion {
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string | null;
	key: string;
	/** `ended`: the authorizations ended because the employee is no longer an intended driver (#1425). */
	kind: "deadline" | "suspension" | "ended";
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
type DrivingEmployment = NonNullable<
	Awaited<ReturnType<typeof currentDrivingEmployment>>
>;
type DrivingAuthorizationRow = typeof drivingAuthorization.$inferSelect;
type ReminderCommon = Pick<
	DrivingLicenceReminderOccasion,
	"organizationId" | "employeeId" | "employmentPeriodId"
>;

/** The intended drivers reminders consider (the assignment resolver, #1423), optionally one employee. */
async function reminderParticipants(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId?: string,
) {
	return (
		await listDrivingLicenceIntendedDriverIds(
			database,
			organizationId,
			employeeId,
		)
	).map((id) => ({ employeeId: id }));
}

/**
 * What reminders see of one employee in their current employment: a current
 * person-wide suspension (which replaces per-class occasions), or else the class
 * authorizations of this employment that have not ended.
 */
async function readReminderAuthorizations(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId: string,
	employment: DrivingEmployment,
) {
	const rows = await database
		.select()
		.from(drivingAuthorization)
		.where(
			and(
				eq(drivingAuthorization.organizationId, organizationId),
				eq(drivingAuthorization.employeeId, employeeId),
			),
		);
	const [global] = await database
		.select()
		.from(drivingLicenceSubject)
		.where(
			and(
				eq(drivingLicenceSubject.organizationId, organizationId),
				eq(drivingLicenceSubject.employeeId, employeeId),
			),
		);
	const currentGlobal =
		global &&
		global.employmentPeriodId === employment.periodId &&
		(!employment.lastDepartureAt ||
			instantFromDate(global.suspendedAt).epochNanoseconds >
				instantFromDate(employment.lastDepartureAt).epochNanoseconds)
			? global
			: null;
	return {
		currentGlobal,
		rows: rows.filter(
			(row) =>
				row.employmentPeriodId === employment.periodId &&
				row.state !== "ended" &&
				!(
					employment.lastDepartureAt &&
					(!row.lastSuccessfulAt ||
						instantFromDate(row.lastSuccessfulAt).epochNanoseconds <=
							instantFromDate(employment.lastDepartureAt).epochNanoseconds)
				),
		),
	};
}

function occasionIdentity(
	employment: DrivingEmployment,
	row: DrivingAuthorizationRow,
) {
	return `${employment.periodId}:${row.id}:${row.supportingCheckId}`;
}

/** One class authorization's suspension occasion; its key makes the notice once-only. */
function classSuspensionOccasion(
	common: ReminderCommon,
	employment: DrivingEmployment,
	row: DrivingAuthorizationRow,
	suspendedAt: Date | null,
): DrivingLicenceReminderOccasion {
	return {
		...common,
		key: `suspended:${occasionIdentity(employment, row)}:${suspendedAt?.toISOString()}`,
		kind: "suspension",
		classCode: row.classCode,
		validThrough: row.validThrough,
		leadDays: null,
	};
}

/** Stretches while driving licence control was off, from the append-only policy revisions. */
export async function readDrivingLicenceOffPeriods(
	database: DrivingLicenceDatabase,
	organizationId: string,
): Promise<DrivingLicenceOffPeriod[]> {
	const revisions = await database
		.select({
			policy: drivingLicencePolicyRevision.policy,
			changedAt: drivingLicencePolicyRevision.changedAt,
		})
		.from(drivingLicencePolicyRevision)
		.where(eq(drivingLicencePolicyRevision.organizationId, organizationId))
		.orderBy(asc(drivingLicencePolicyRevision.version));
	return drivingLicenceOffPeriods(
		revisions.map((revision) => ({
			enabled: revision.policy.enabled,
			changedAt: instantFromDate(revision.changedAt),
		})),
	);
}

/**
 * Current occurrences, including the closest missed lead threshold while the deadline
 * remains current. A lead threshold whose date fell while control was switched off is
 * skipped rather than caught up (#1422).
 */
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
	const participants = await reminderParticipants(
		tx,
		organizationId,
		employeeId,
	);
	const offPeriods = await readDrivingLicenceOffPeriods(tx, organizationId);
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
		const { currentGlobal, rows } = await readReminderAuthorizations(
			tx,
			organizationId,
			participant.employeeId,
			employment,
		);
		const common = {
			organizationId,
			employeeId: participant.employeeId,
			employmentPeriodId: employment.periodId,
		};
		if (currentGlobal) {
			occasions.push({
				...common,
				key: `global:${employment.periodId}:${currentGlobal.suspendedAt.toISOString()}`,
				kind: "suspension",
				classCode: null,
				validThrough: null,
				leadDays: null,
			});
			continue;
		}
		for (const row of rows) {
			if (row.state === "suspended") {
				occasions.push(
					classSuspensionOccasion(common, employment, row, row.suspendedAt),
				);
				continue;
			}
			const today = now.toZonedDateTimeISO(row.deadlineTimezone).toPlainDate();
			const days = today.until(parsePlainDate(row.validThrough)).days;
			const lead = [...policy.reminderLeadDays]
				.filter((d) => days >= 0 && days <= d)
				.sort((a, b) => a - b)[0];
			if (
				lead === undefined ||
				reminderOccasionFellWhileOff({
					validThrough: row.validThrough,
					leadDays: lead,
					timezone: row.deadlineTimezone,
					offPeriods,
				})
			)
				continue;
			occasions.push({
				...common,
				key: `deadline:${occasionIdentity(employment, row)}:${row.validThrough}:${row.deadlineTimezone}:${lead}`,
				kind: "deadline",
				classCode: row.classCode,
				validThrough: row.validThrough,
				leadDays: lead,
			});
		}
	}
	return occasions;
}

const DEADLINE_SUSPENSION_REASONS = new Set([
	"check_overdue",
	"document_expired",
	"class_expired",
]);

/**
 * The suspensions switching driving licence control on again settles (#1422): class
 * authorizations whose routine deadline, document expiry or class expiry passed after
 * `offAt` (the switch-off), whether still active or already suspended silently by
 * evidence cleanup while off. Read-only, so it is also the confirmation's impact count;
 * eligibility matches the reminder occasions, so the job never adds a notice for them.
 */
export async function collectDrivingLicenceReactivationSuspensions(
	database: DrivingLicenceDatabase,
	organizationId: string,
	offAt: Instant | null,
	now: Instant,
): Promise<DrivingLicenceReminderOccasion[]> {
	if (!offAt) return [];
	const passedWhileOff = (at: Date) => {
		const ns = instantFromDate(at).epochNanoseconds;
		return ns > offAt.epochNanoseconds && ns <= now.epochNanoseconds;
	};
	const occasions: DrivingLicenceReminderOccasion[] = [];
	for (const participant of await reminderParticipants(
		database,
		organizationId,
	)) {
		const employment = await currentDrivingEmployment(
			database,
			organizationId,
			participant.employeeId,
			now,
		);
		if (!employment?.hasAccess) continue;
		const { currentGlobal, rows } = await readReminderAuthorizations(
			database,
			organizationId,
			participant.employeeId,
			employment,
		);
		// A current person-wide suspension already stands for every class.
		if (currentGlobal) continue;
		const common = {
			organizationId,
			employeeId: participant.employeeId,
			employmentPeriodId: employment.periodId,
		};
		for (const row of rows) {
			// Expiry materializes with suspendedAt = expiresAt, so both read the same key.
			const suspendedAt =
				row.state === "active" && passedWhileOff(row.expiresAt)
					? row.expiresAt
					: row.state === "suspended" &&
							row.suspendedAt &&
							DEADLINE_SUSPENSION_REASONS.has(row.suspensionReason ?? "") &&
							passedWhileOff(row.suspendedAt)
						? row.suspendedAt
						: null;
			if (suspendedAt)
				occasions.push(
					classSuspensionOccasion(common, employment, row, suspendedAt),
				);
		}
	}
	return occasions;
}
const DRIVING_AUTHORIZATION_ENDED_COPY = {
	titleKey: "common:notifications.content.drivingAuthorizationEnded.title",
	titleDefault: "Driving authorization ended",
	messageKey: "common:notifications.content.drivingAuthorizationEnded.message",
	messageDefault:
		"{employeeName} is no longer an intended driver, so their driving authorization ({classes}) has ended. Driving again requires a new check.",
};
/**
 * In-app and email payload for one recipient. The employee is linked to their own licence;
 * a verifier to that employee's check page (#1429).
 */
function reminderParams(
	occasion: DrivingLicenceReminderOccasion,
	recipientUserId: string,
	employee: { userId: string; name: string },
): CreateNotificationParams {
	const employeeName = employee.name;
	// The end notice shares the suspension notice's type and channels (#1425).
	const suspended = occasion.kind !== "deadline";
	const copy =
		occasion.kind === "ended"
			? DRIVING_AUTHORIZATION_ENDED_COPY
			: suspended
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
		actionUrl:
			recipientUserId === employee.userId
				? DRIVING_LICENCE_PATH
				: drivingLicenceCheckPath(occasion.employeeId),
		idempotencyKey: `driving:${occasion.key}:${recipientUserId}`,
		metadata: {
			i18n: content.i18n,
			employeeId: occasion.employeeId,
			occasionKey: occasion.key,
		},
	};
}
/**
 * The end notice of a delivery (#1425): key `ended:<period>:<instant>:<class+class…>`.
 * The class list is read back from the key on purpose: the delivery row has no structured
 * class field, the ended classes are fixed at the ending instant, and the key is also the
 * notice's once-only identity. A column only for this email copy was not worth a migration
 * (#1418 review).
 */
function endedOccasion(
	organizationId: string,
	delivery: typeof drivingLicenceReminderDelivery.$inferSelect,
): DrivingLicenceReminderOccasion | undefined {
	const key = delivery.occasionKey;
	if (!key.startsWith("ended:")) return undefined;
	return {
		organizationId,
		employeeId: delivery.employeeId,
		employmentPeriodId: delivery.employmentPeriodId,
		key,
		kind: "ended",
		classCode: key
			.slice(key.lastIndexOf(":") + 1)
			.split("+")
			.join(", "),
		validThrough: null,
		leadDays: null,
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
	// An end notice reports a past fact; it is not re-collected like current occasions.
	const current =
		endedOccasion(organizationId, delivery) ??
		(
			await collectDrivingLicenceReminderOccasions(
				tx,
				organizationId,
				now,
				delivery.employeeId,
			)
		).find(
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
		recipients.employee,
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

/**
 * Delivers one occasion to the employee (personal route) and every responsible
 * verifier: a delivery row per recipient, which makes it once-only, and the mandatory
 * in-app notice. The email stays pending for the reminder job's email phase, which
 * applies the recipient's email preference. Returns the in-app notices created.
 */
export async function deliverDrivingLicenceOccasion(
	tx: DrivingLicenceTransaction,
	occasion: DrivingLicenceReminderOccasion,
	now: Instant,
) {
	const { organizationId } = occasion;
	const recipients = await resolveDrivingLicenceReminderRecipients(
		tx,
		organizationId,
		occasion.employeeId,
		now,
	);
	if (!recipients.employee) return 0;
	const userIds = [
		...new Set([
			...recipients.verifiers.map((v) => v.userId),
			...(recipients.employee.personalRoute
				? [recipients.employee.userId]
				: []),
		]),
	];
	let created = 0;
	for (const userId of userIds) {
		const payload = reminderParams(occasion, userId, recipients.employee);
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
						eq(drivingLicenceReminderDelivery.organizationId, organizationId),
						eq(drivingLicenceReminderDelivery.id, delivery.id),
					),
				);
			created++;
		}
	}
	return created;
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
			for (const occasion of occasions)
				result.inAppCreated += await deliverDrivingLicenceOccasion(
					tx,
					occasion,
					now,
				);
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
