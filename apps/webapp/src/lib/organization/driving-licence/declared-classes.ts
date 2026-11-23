import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { drivingLicenceDeclaredClasses } from "@/db/schema/driving-licence-declared-classes";
import { dateFromInstant, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { translatedContent } from "@/lib/notifications/notification-copy";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { LICENCE_CLASS_INFO, LICENCE_CLASSES } from "./check-types";
import { readEffectiveDrivingAuthorization } from "./checks";
import type { DrivingLicenceActor } from "./context";
import { assertDrivingLicenceControlOn } from "./control-state";
import { deleteDeclaredLicenceClasses } from "./declared-classes-store";
import { isDrivingLicenceIntendedDriver } from "./intended-drivers";
import { lockDrivingLicenceOrganization } from "./locks";
import { drivingLicenceCheckPath } from "./paths";
import { resolveDrivingLicenceReminderRecipients } from "./reminders";
import type { DrivingLicenceTransaction } from "./verifiers";

/**
 * Declared classes (#2003): an intended driver states which licence classes they hold. The
 * statement grants no authorization. It tells planners who can drive what, and it prepares the
 * verifier's check, which replaces it for the classes inspected.
 */

const calendarDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		try {
			parsePlainDate(value);
			return true;
		} catch {
			return false;
		}
	});

export const declaredLicenceClassesInput = z
	.strictObject({
		classes: z
			.array(
				z.strictObject({
					code: z.enum(LICENCE_CLASSES),
					expiryDate: calendarDate.nullable(),
				}),
			)
			.min(1)
			.max(LICENCE_CLASSES.length),
		documentExpiresOn: calendarDate.nullable(),
	})
	.superRefine((value, ctx) => {
		if (new Set(value.classes.map((entry) => entry.code)).size !== value.classes.length)
			ctx.addIssue({ code: "custom", message: "Each class must appear once" });
		if (value.classes.some((entry) => entry.expiryDate && !LICENCE_CLASS_INFO[entry.code].expires))
			ctx.addIssue({ code: "custom", message: "Only C and D classes have their own expiry" });
	});
export type DeclaredLicenceClassesInput = z.input<typeof declaredLicenceClassesInput>;

/** The actor's own employee while they are an intended driver of a current employment. */
async function requireDeclaringEmployee(tx: DrivingLicenceTransaction, actor: DrivingLicenceActor) {
	await lockDrivingLicenceOrganization(tx, actor.organizationId);
	await assertDrivingLicenceControlOn(tx, actor.organizationId);
	if (!actor.employeeId) throw new Error("not_intended_driver");
	const now = systemClock.nowInstant();
	const [current] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.id, actor.employeeId),
				eq(employee.userId, actor.userId),
				employeeHasOrganizationAccess(now),
			),
		)
		.for("share");
	if (
		!current ||
		!(await isDrivingLicenceIntendedDriver(tx, {
			organizationId: actor.organizationId,
			employeeId: current.id,
		}))
	)
		throw new Error("not_intended_driver");
	return { employeeId: current.id, now };
}

/**
 * Saves the actor's own statement, replacing the previous one. Classes already authorized are
 * left out: a check covers them. Responsible verifiers get one notice per save that adds a class
 * they have not checked yet.
 */
export async function saveDeclaredLicenceClasses(actor: DrivingLicenceActor, raw: unknown) {
	const input = declaredLicenceClassesInput.parse(raw);
	return db.transaction(async (tx) => {
		const { employeeId, now } = await requireDeclaringEmployee(tx, actor);
		const before = await readEffectiveDrivingAuthorization(
			tx,
			actor.organizationId,
			employeeId,
			now,
		);
		const authorized = new Set(before.authorizedClasses);
		const order = (code: string) =>
			LICENCE_CLASSES.indexOf(code as (typeof LICENCE_CLASSES)[number]);
		const classes = input.classes
			.filter((entry) => !authorized.has(entry.code))
			.sort((left, right) => order(left.code) - order(right.code));
		if (!classes.length) {
			await deleteDeclaredLicenceClasses(tx, actor.organizationId, employeeId);
			return { declared: 0 };
		}
		const [row] = await tx
			.insert(drivingLicenceDeclaredClasses)
			.values({
				organizationId: actor.organizationId,
				employeeId,
				classes,
				documentExpiresOn: input.documentExpiresOn,
				updatedAt: dateFromInstant(now),
				updatedBy: actor.userId,
			})
			.onConflictDoUpdate({
				target: [
					drivingLicenceDeclaredClasses.organizationId,
					drivingLicenceDeclaredClasses.employeeId,
				],
				set: {
					classes,
					documentExpiresOn: input.documentExpiresOn,
					updatedAt: dateFromInstant(now),
					updatedBy: actor.userId,
					version: sql`${drivingLicenceDeclaredClasses.version} + 1`,
				},
			})
			.returning({
				id: drivingLicenceDeclaredClasses.id,
				version: drivingLicenceDeclaredClasses.version,
			});
		const previously = new Set(before.declaredUnchecked);
		const added = classes.map((entry) => entry.code).filter((code) => !previously.has(code));
		if (row && added.length)
			await notifyVerifiers(tx, {
				organizationId: actor.organizationId,
				employeeId,
				statementId: row.id,
				version: row.version,
				classCodes: added,
				now,
			});
		return { declared: classes.length };
	});
}

/** Withdraws the actor's own statement. */
export async function withdrawDeclaredLicenceClasses(actor: DrivingLicenceActor) {
	return db.transaction(async (tx) => {
		const { employeeId } = await requireDeclaringEmployee(tx, actor);
		await deleteDeclaredLicenceClasses(tx, actor.organizationId, employeeId);
		return { declared: 0 };
	});
}

/** "{name} declared class C: check it." In-app only, straight to the check page. */
async function notifyVerifiers(
	tx: DrivingLicenceTransaction,
	input: {
		organizationId: string;
		employeeId: string;
		statementId: string;
		version: number;
		classCodes: string[];
		now: ReturnType<typeof systemClock.nowInstant>;
	},
) {
	const recipients = await resolveDrivingLicenceReminderRecipients(
		tx,
		input.organizationId,
		input.employeeId,
		input.now,
	);
	if (!recipients.employee) return;
	const content = translatedContent(
		{
			titleKey: "common:notifications.content.drivingLicenceDeclared.title",
			titleDefault: "Licence classes to check",
			messageKey: "common:notifications.content.drivingLicenceDeclared.message",
			messageDefault:
				"{employeeName} declared licence classes {classes}. Inspect the original licence to authorize them; a declaration alone grants nothing.",
		},
		{ employeeName: recipients.employee.name, classes: input.classCodes.join(", ") },
	);
	for (const verifier of recipients.verifiers)
		// Ordered writes on the caller's transaction connection.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await insertInAppNotification(
			{
				userId: verifier.userId,
				organizationId: input.organizationId,
				type: "driving_licence_reminder",
				title: content.title,
				message: content.message,
				entityType: "driving_licence_declared_classes",
				entityId: input.statementId,
				actionUrl: drivingLicenceCheckPath(input.employeeId),
				idempotencyKey: `driving-declared:${input.statementId}:${input.version}:${verifier.userId}`,
				metadata: {
					i18n: content.i18n,
					employeeId: input.employeeId,
					classCodes: input.classCodes,
				},
			},
			tx,
		);
}
