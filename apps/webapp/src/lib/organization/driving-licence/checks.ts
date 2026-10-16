import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, employeeEmploymentPeriod } from "@/db/schema";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import {
	drivingLicenceParticipant,
	drivingLicencePolicy,
} from "@/db/schema/driving-licence-policy";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	assertDrivingLicenceRecordAccess,
	assertDrivingLicenceVerifierAccess,
	listDrivingLicenceVerifierEmployees,
} from "./access";
import {
	type AuthorizationStatus,
	EMPLOYEE_DRIVING_DECLARATION,
	LICENCE_CLASSES,
} from "./check-types";
import type { DrivingLicenceActor } from "./context";
import type {
	DrivingLicenceDatabase,
	DrivingLicenceTransaction,
} from "./verifiers";

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
export const originalCheckInput = z
	.strictObject({
		employeeId: z.uuid(),
		commandId: z.uuid(),
		originalInspected: z.boolean(),
		identityConfirmed: z.boolean(),
		employeeDeclaration: z.boolean(),
		verifierConfirmed: z.literal(true),
		documentIssuedOn: calendarDate,
		documentExpiresOn: calendarDate,
		classes: z
			.array(
				z.strictObject({
					code: z.enum(LICENCE_CLASSES),
					result: z.enum(["successful", "unsuccessful", "inconclusive"]),
					expiryDate: calendarDate.nullable(),
					restrictions: z.string().trim().max(300),
				}),
			)
			.min(1)
			.max(LICENCE_CLASSES.length),
		failureScope: z.enum(["classes", "document", "person"]).default("classes"),
	})

	.superRefine((value, ctx) => {
		if (new Set(value.classes.map((c) => c.code)).size !== value.classes.length)
			ctx.addIssue({
				code: "custom",
				message: "Each inspected class must appear once",
			});
		if (value.documentIssuedOn > value.documentExpiresOn)
			ctx.addIssue({ code: "custom", message: "Invalid document dates" });
		if (
			value.classes.some((c) => c.result === "successful") &&
			(!value.originalInspected ||
				!value.identityConfirmed ||
				!value.employeeDeclaration)
		)
			ctx.addIssue({
				code: "custom",
				message:
					"Successful classes require the original, identity and employee declaration",
			});
		if (
			value.failureScope !== "classes" &&
			value.classes.every((c) => c.result === "successful")
		)
			ctx.addIssue({
				code: "custom",
				message:
					"A global failure needs an unsuccessful or inconclusive outcome",
			});
	});
function scope(organizationId: string, employeeId: string) {
	return and(
		eq(drivingAuthorization.organizationId, organizationId),
		eq(drivingAuthorization.employeeId, employeeId),
	);
}
function deadlineReason(row: typeof drivingAuthorization.$inferSelect) {
	return row.documentValidThrough === row.validThrough
		? "document_expired"
		: row.classValidThrough === row.validThrough
			? "class_expired"
			: "check_overdue";
}
export async function lockDrivingLicenceOrganization(
	tx: DrivingLicenceTransaction,
	organizationId: string,
) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`driving-licence:${organizationId}`},0))`,
	);
	// Lifecycle transitions lock this tenant row before changing employment/grants.
	await tx
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.for("share");
}
export async function materializeExpiredDrivingAuthorizations(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	employeeId?: string,
) {
	const rows = await tx
		.select()
		.from(drivingAuthorization)
		.where(
			and(
				eq(drivingAuthorization.organizationId, organizationId),
				eq(drivingAuthorization.state, "active"),
				lte(drivingAuthorization.expiresAt, dateFromInstant(now)),
				employeeId
					? eq(drivingAuthorization.employeeId, employeeId)
					: undefined,
			),
		)
		.for("update");
	for (const row of rows) {
		const reason = deadlineReason(row);
		await tx
			.update(drivingAuthorization)
			.set({
				state: "suspended",
				suspensionReason: reason,
				suspendedAt: row.expiresAt,
			})
			.where(
				and(
					eq(drivingAuthorization.organizationId, organizationId),
					eq(drivingAuthorization.id, row.id),
				),
			);
		await tx.insert(drivingAuthorizationEvent).values({
			organizationId,
			employeeId: row.employeeId,
			employmentPeriodId: row.employmentPeriodId,
			classCode: row.classCode,
			checkId: row.supportingCheckId,
			kind: "suspended",
			reason,
			effectiveAt: row.expiresAt,
			recordedAt: dateFromInstant(now),
		});
	}
}
export async function currentDrivingEmployment(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId: string,
	now: Instant,
) {
	const [target] = await database
		.select({
			id: employee.id,
			userId: employee.userId,
			hasAccess: employeeHasOrganizationAccess(now),
			periodId: employeeEmploymentPeriod.id,
			lastDepartureAt: sql<Date | null>`(SELECT max(d.cutoff_at) FROM employee_departure d WHERE d.organization_id=${organizationId} AND d.employee_id=${employeeId} AND d.status='effective')`,
		})
		.from(employee)
		.leftJoin(
			employeeEmploymentPeriod,
			and(
				eq(employeeEmploymentPeriod.employeeId, employee.id),
				eq(employeeEmploymentPeriod.organizationId, employee.organizationId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.id, employeeId),
			),
		)
		.limit(1);
	return target ?? null;
}
export async function readEffectiveDrivingAuthorization(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId: string,
	now: Instant = systemClock.nowInstant(),
) {
	const [[participant], [policy], rows, [global], employment] =
		await Promise.all([
			database
				.select()
				.from(drivingLicenceParticipant)
				.where(
					and(
						eq(drivingLicenceParticipant.organizationId, organizationId),
						eq(drivingLicenceParticipant.employeeId, employeeId),
					),
				),
			database
				.select()
				.from(drivingLicencePolicy)
				.where(eq(drivingLicencePolicy.organizationId, organizationId)),
			database
				.select()
				.from(drivingAuthorization)
				.where(scope(organizationId, employeeId))
				.orderBy(asc(drivingAuthorization.classCode)),
			database
				.select()
				.from(drivingLicenceSubject)
				.where(
					and(
						eq(drivingLicenceSubject.organizationId, organizationId),
						eq(drivingLicenceSubject.employeeId, employeeId),
					),
				),
			currentDrivingEmployment(database, organizationId, employeeId, now),
		]);
	const classes = rows.map((row) => {
		const ended =
			!employment?.hasAccess ||
			row.employmentPeriodId !== employment.periodId ||
			(!!employment.lastDepartureAt &&
				!!row.lastSuccessfulAt &&
				instantFromDate(employment.lastDepartureAt).epochNanoseconds >=
					instantFromDate(row.lastSuccessfulAt).epochNanoseconds);
		const globalApplies =
			global && global.employmentPeriodId === row.employmentPeriodId;
		const expired =
			instantFromDate(row.expiresAt).epochNanoseconds <= now.epochNanoseconds;
		const status =
			ended || row.state === "ended"
				? "ended"
				: globalApplies || row.state === "suspended" || expired
					? "suspended"
					: "active";
		return {
			code: row.classCode,
			status,
			reason: ended
				? "employment_ended"
				: globalApplies
					? `${global.suspensionKind}_impediment`
					: (row.suspensionReason ?? (expired ? deadlineReason(row) : null)),
			validThrough: row.validThrough,
			deadlineTimezone: row.deadlineTimezone,
			expiresAt: row.expiresAt.toISOString(),
			lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
			supportingCheckId: row.supportingCheckId,
			restrictions: row.restrictions,
		};
	});
	const authorizedClasses = classes
		.filter((c) => c.status === "active")
		.map((c) => c.code);
	const status: AuthorizationStatus = !participant
		? "not_enrolled"
		: !classes.length
			? "not_yet_checked"
			: authorizedClasses.length === classes.length
				? "active"
				: authorizedClasses.length
					? "partially_active"
					: classes.every((c) => c.status === "ended")
						? "ended"
						: "suspended";
	return {
		enrolled: !!participant,
		status,
		authorizedClasses,
		classes,
		timezone: policy?.timezone ?? null,
	};
}
export async function readDrivingLicenceEmployeeRecord(
	actor: DrivingLicenceActor,
	employeeId: string,
) {
	const now = systemClock.nowInstant();
	await assertDrivingLicenceRecordAccess(db, {
		organizationId: actor.organizationId,
		userId: actor.userId,
		employeeId,
		now,
	});
	const [status, checks, events] = await Promise.all([
		readEffectiveDrivingAuthorization(
			db,
			actor.organizationId,
			employeeId,
			now,
		),
		db
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.employeeId, employeeId),
				),
			)
			.orderBy(
				desc(drivingLicenceCheck.controlledAt),
				desc(drivingLicenceCheck.id),
			),
		db
			.select()
			.from(drivingAuthorizationEvent)
			.where(
				and(
					eq(drivingAuthorizationEvent.organizationId, actor.organizationId),
					eq(drivingAuthorizationEvent.employeeId, employeeId),
				),
			)
			.orderBy(
				asc(drivingAuthorizationEvent.effectiveAt),
				asc(drivingAuthorizationEvent.id),
			),
	]);
	return {
		...status,
		checks: checks.map((row) => ({
			...row,
			controlledAt: row.controlledAt.toISOString(),
			declarationAt: row.controlledAt.toISOString(),
		})),
		events: events.map((row) => ({
			...row,
			effectiveAt: row.effectiveAt.toISOString(),
			recordedAt: row.recordedAt.toISOString(),
		})),
	};
}
export type DrivingLicenceEmployeeRecord = Awaited<
	ReturnType<typeof readDrivingLicenceEmployeeRecord>
>;
export async function completeDrivingLicenceCheck(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = originalCheckInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const now = systemClock.nowInstant();
		// A row lock serializes completion with grant revocation/replacement.
		await tx
			.select({ id: drivingLicenceVerifierGrant.id })
			.from(drivingLicenceVerifierGrant)
			.where(
				and(
					eq(drivingLicenceVerifierGrant.organizationId, actor.organizationId),
					eq(
						drivingLicenceVerifierGrant.verifierEmployeeId,
						actor.employeeId ?? "00000000-0000-0000-0000-000000000000",
					),
				),
			)
			.for("share");
		await assertDrivingLicenceVerifierAccess(tx, {
			organizationId: actor.organizationId,
			userId: actor.userId,
			employeeId: input.employeeId,
			now,
		});
		// One PostgreSQL transaction has one connection: keep its queries ordered.
		const [policy] = await tx
			.select()
			.from(drivingLicencePolicy)
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		const [participant] = await tx
			.select()
			.from(drivingLicenceParticipant)
			.where(
				and(
					eq(drivingLicenceParticipant.organizationId, actor.organizationId),
					eq(drivingLicenceParticipant.employeeId, input.employeeId),
				),
			);
		const employment = await currentDrivingEmployment(
			tx,
			actor.organizationId,
			input.employeeId,
			now,
		);
		if (
			!policy?.enabled ||
			!participant ||
			!employment?.hasAccess ||
			!actor.employeeId
		)
			throw new Error("unavailable");
		const [duplicate] = await tx
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.commandId, input.commandId),
				),
			);
		if (duplicate) {
			if (
				duplicate.employeeId !== input.employeeId ||
				duplicate.verifierUserId !== actor.userId
			)
				throw new Error("unavailable");
			return { checkId: duplicate.id };
		}
		const localDate = now.toZonedDateTimeISO(policy.timezone).toPlainDate();
		if (input.documentIssuedOn > localDate.toString())
			throw new Error("invalid_dates");
		await materializeExpiredDrivingAuthorizations(
			tx,
			actor.organizationId,
			now,
			input.employeeId,
		);
		const identities = await tx
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inArray(user.id, [employment.userId, actor.userId]));
		const namesById = new Map(
			identities.map((identity) => [identity.id, identity.name]),
		);
		const [check] = await tx
			.insert(drivingLicenceCheck)
			.values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				verifierEmployeeId: actor.employeeId,
				verifierUserId: actor.userId,
				employeeName: namesById.get(employment.userId) ?? input.employeeId,
				verifierName: namesById.get(actor.userId) ?? actor.userId,
				controlledAt: dateFromInstant(now),
				commandId: input.commandId,
				policyVersion: policy.version,
				intervalMonths: policy.intervalMonths,
				deadlineTimezone: policy.timezone,
				documentIssuedOn: input.documentIssuedOn,
				documentExpiresOn: input.documentExpiresOn,
				originalInspected: input.originalInspected,
				identityConfirmed: input.identityConfirmed,
				employeeDeclaration: input.employeeDeclaration,
				declarationText: EMPLOYEE_DRIVING_DECLARATION,
				verifierConfirmed: input.verifierConfirmed,
				classes: input.classes,
				failureScope: input.failureScope,
			})
			.returning();
		if (!check) throw new Error("save_failed");
		const globalKind =
			!input.employeeDeclaration || input.failureScope === "person"
				? "person"
				: !input.originalInspected ||
						!input.identityConfirmed ||
						input.failureScope === "document"
					? "document"
					: null;
		if (globalKind) {
			await tx
				.insert(drivingLicenceSubject)
				.values({
					organizationId: actor.organizationId,
					employeeId: input.employeeId,
					employmentPeriodId: employment.periodId,
					suspensionKind: globalKind,
					suspendedAt: dateFromInstant(now),
					sourceCheckId: check.id,
				})
				.onConflictDoUpdate({
					target: [
						drivingLicenceSubject.organizationId,
						drivingLicenceSubject.employeeId,
					],
					set: {
						employmentPeriodId: employment.periodId,
						suspensionKind: globalKind,
						suspendedAt: dateFromInstant(now),
						sourceCheckId: check.id,
					},
				});
			await tx
				.update(drivingAuthorization)
				.set({
					state: "suspended",
					suspensionReason: `${globalKind}_impediment`,
					suspendedAt: dateFromInstant(now),
				})
				.where(
					and(
						scope(actor.organizationId, input.employeeId),
						eq(drivingAuthorization.state, "active"),
					),
				);
		}
		const [global] = await tx
			.select()
			.from(drivingLicenceSubject)
			.where(
				and(
					eq(drivingLicenceSubject.organizationId, actor.organizationId),
					eq(drivingLicenceSubject.employeeId, input.employeeId),
				),
			);
		for (const inspected of input.classes) {
			const [previous] = await tx
				.select()
				.from(drivingAuthorization)
				.where(
					and(
						scope(actor.organizationId, input.employeeId),
						eq(drivingAuthorization.classCode, inspected.code),
					),
				);
			const samePeriod = previous?.employmentPeriodId === employment.periodId;
			const routineValidThrough = localDate
				.add({ months: policy.intervalMonths })
				.toString();
			const validThrough = [
				routineValidThrough,
				input.documentExpiresOn,
				inspected.expiryDate,
			]
				.filter((value): value is string => value !== null)
				.sort()[0];
			const expires = Temporal.PlainDate.from(validThrough)
				.add({ days: 1 })
				.toZonedDateTime({ timeZone: policy.timezone, plainTime: "00:00" })
				.toInstant();
			const suspendedAlready = samePeriod && previous?.state !== "active";
			const globalActive = global?.employmentPeriodId === employment.periodId;
			const successful = inspected.result === "successful";
			const state: "active" | "suspended" =
				successful &&
				!suspendedAlready &&
				!globalActive &&
				expires.epochNanoseconds > now.epochNanoseconds
					? "active"
					: "suspended";
			const suspensionReason =
				state === "active"
					? null
					: globalActive
						? `${global.suspensionKind}_impediment`
						: suspendedAlready
							? previous.suspensionReason
							: !successful
								? `check_${inspected.result}`
								: input.documentExpiresOn === validThrough
									? "document_expired"
									: inspected.expiryDate === validThrough
										? "class_expired"
										: "check_overdue";
			const preserveAnchor = samePeriod && previous && !successful;
			const values = {
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				classCode: inspected.code,
				supportingCheckId: preserveAnchor
					? previous.supportingCheckId
					: check.id,
				lastSuccessfulAt: successful
					? dateFromInstant(now)
					: preserveAnchor
						? previous.lastSuccessfulAt
						: null,
				routineValidThrough: preserveAnchor
					? previous.routineValidThrough
					: routineValidThrough,
				documentValidThrough: preserveAnchor
					? previous.documentValidThrough
					: input.documentExpiresOn,
				classValidThrough: preserveAnchor
					? previous.classValidThrough
					: inspected.expiryDate,
				validThrough: preserveAnchor ? previous.validThrough : validThrough,
				deadlineTimezone: preserveAnchor
					? previous.deadlineTimezone
					: policy.timezone,
				expiresAt: preserveAnchor
					? previous.expiresAt
					: dateFromInstant(expires),
				restrictions: inspected.restrictions,
				state,
				suspensionReason,
				suspendedAt:
					state === "suspended"
						? (previous?.suspendedAt ?? dateFromInstant(now))
						: null,
			};
			await tx
				.insert(drivingAuthorization)
				.values(values)
				.onConflictDoUpdate({
					target: [
						drivingAuthorization.organizationId,
						drivingAuthorization.employeeId,
						drivingAuthorization.classCode,
					],
					set: values,
				});
			await tx.insert(drivingAuthorizationEvent).values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				classCode: inspected.code,
				checkId: check.id,
				kind: state === "active" ? "authorized" : "suspended",
				reason: suspensionReason,
				effectiveAt: dateFromInstant(now),
				recordedAt: dateFromInstant(now),
				actorUserId: actor.userId,
			});
		}
		if (globalKind)
			await tx.insert(drivingAuthorizationEvent).values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				checkId: check.id,
				kind: "global_suspension",
				reason: `${globalKind}_impediment`,
				effectiveAt: dateFromInstant(now),
				recordedAt: dateFromInstant(now),
				actorUserId: actor.userId,
			});
		return { checkId: check.id };
	});
}
export async function readDrivingLicenceWorklist(actor: DrivingLicenceActor) {
	const now = systemClock.nowInstant();
	const available = await listDrivingLicenceVerifierEmployees(db, {
		organizationId: actor.organizationId,
		userId: actor.userId,
		now,
	});
	const rows = await Promise.all(
		available
			.filter((target) => target.canVerify)
			.map(async (target) => {
				const status = await readEffectiveDrivingAuthorization(
					db,
					actor.organizationId,
					target.id,
					now,
				);
				if (!status.enrolled) return null;
				const [identity] = await db
					.select({ name: user.name })
					.from(employee)
					.innerJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, actor.organizationId),
							eq(employee.id, target.id),
						),
					);
				return {
					employeeId: target.id,
					name: identity?.name ?? target.id,
					...status,
				};
			}),
	);
	return rows.filter((row): row is NonNullable<typeof row> => row !== null);
}
