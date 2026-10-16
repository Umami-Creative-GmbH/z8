import {
	beginDrivingLicenceRetentionChange,
	finishDrivingLicenceRetentionChange,
} from "./retention-state";
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import {
	drivingLicencePolicy,
	drivingLicencePolicyRevision,
} from "@/db/schema/driving-licence-policy";
import { employee } from "@/db/schema/organization";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import type { DrivingLicenceTransaction } from "./verifiers";

const intervalInput = z.strictObject({
	intervalMonths: z.number().int().min(1).max(120),
});
const applyInput = intervalInput.extend({
	previewToken: z.string().regex(/^[a-f0-9]{64}$/),
});
async function impact(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	intervalMonths: number,
	now: Instant,
) {
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	if (!policy) throw new Error("not_configured");
	const rows = await tx
		.select({
			authorization: drivingAuthorization,
			firstName: employee.firstName,
			lastName: employee.lastName,
		})
		.from(drivingAuthorization)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingAuthorization.employeeId),
				eq(employee.organizationId, drivingAuthorization.organizationId),
			),
		)
		.where(
			and(
				eq(drivingAuthorization.organizationId, organizationId),
				employeeHasOrganizationAccess(now),
			),
		)
		.orderBy(
			asc(drivingAuthorization.employeeId),
			asc(drivingAuthorization.classCode),
		);
	const subjects = await tx
		.select()
		.from(drivingLicenceSubject)
		.where(eq(drivingLicenceSubject.organizationId, organizationId))
		.orderBy(asc(drivingLicenceSubject.employeeId));
	const classes = rows.flatMap(
		({ authorization: row, firstName, lastName }) => {
			if (!row.lastSuccessfulAt || row.state === "ended") return [];
			const routineValidThrough = instantFromDate(row.lastSuccessfulAt)
				.toZonedDateTimeISO(row.deadlineTimezone)
				.toPlainDate()
				.add({ months: intervalMonths })
				.toString();
			const validThrough = [
				routineValidThrough,
				row.documentValidThrough,
				row.classValidThrough,
			]
				.filter((value): value is string => value !== null)
				.sort()[0];
			const expires = Temporal.PlainDate.from(validThrough)
				.add({ days: 1 })
				.toZonedDateTime({ timeZone: row.deadlineTimezone, plainTime: "00:00" })
				.toInstant();
			const suspended =
				row.state !== "active" ||
				instantFromDate(row.expiresAt).epochNanoseconds <=
					now.epochNanoseconds ||
				subjects.some(
					(subject) =>
						subject.employeeId === row.employeeId &&
						subject.employmentPeriodId === row.employmentPeriodId,
				);
			const overdue = expires.epochNanoseconds <= now.epochNanoseconds;
			return [
				{
					employeeId: row.employeeId,
					employeeName:
						[firstName, lastName].filter(Boolean).join(" ") || row.employeeId,
					classCode: row.classCode,
					previousValidThrough: row.validThrough,
					routineValidThrough,
					validThrough,
					deadlineTimezone: row.deadlineTimezone,
					newlyOverdue: !suspended && overdue,
					remainsSuspended: suspended,
					expiresAt: expires.toString(),
				},
			];
		},
	);
	// A digest is a concurrency token, never client authority: apply rebuilds every fact and date.
	const previewToken = createHash("sha256")
		.update(JSON.stringify({ policy, rows, subjects, intervalMonths, classes }))
		.digest("hex");
	return {
		policy,
		rows,
		preview: {
			intervalMonths,
			previousIntervalMonths: policy.intervalMonths,
			policyVersion: policy.version,
			previewToken,
			classes,
		},
	};
}
export type DrivingLicenceIntervalPreview = Awaited<
	ReturnType<typeof previewDrivingLicenceInterval>
>;
export async function previewDrivingLicenceInterval(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	if (!actor.isAdministrator) throw new Error("forbidden");
	const { intervalMonths } = intervalInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		return (
			await impact(
				tx,
				actor.organizationId,
				intervalMonths,
				systemClock.nowInstant(),
			)
		).preview;
	});
}
export async function applyDrivingLicenceInterval(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	if (!actor.isAdministrator) throw new Error("forbidden");
	const input = applyInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const now = systemClock.nowInstant();
		const retentionBefore = await beginDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
		);
		const current = await impact(
			tx,
			actor.organizationId,
			input.intervalMonths,
			now,
		);
		if (current.preview.previewToken !== input.previewToken)
			throw new Error("stale_preview");
		if (current.policy.intervalMonths === input.intervalMonths)
			return current.preview;
		// Persist OLD elapsed deadlines first; extending a deadline must never erase a suspension.
		await materializeExpiredDrivingAuthorizations(
			tx,
			actor.organizationId,
			now,
		);
		const version = current.policy.version + 1;
		const changedAt = dateFromInstant(now);
		await tx
			.update(drivingLicencePolicy)
			.set({
				intervalMonths: input.intervalMonths,
				version,
				updatedAt: changedAt,
				updatedBy: actor.userId,
			})
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		await tx.insert(drivingLicencePolicyRevision).values({
			organizationId: actor.organizationId,
			version,
			policy: {
				enabled: current.policy.enabled,
				intervalMonths: input.intervalMonths,
				timezone: current.policy.timezone,
				reminderLeadDays: current.policy.reminderLeadDays,
				retentionMonths: current.policy.retentionMonths,
				retentionJustification: current.policy.retentionJustification,
			},
			changedAt,
			changedBy: actor.userId,
		});
		const rowsByClass = new Map(
			current.rows.map(({ authorization }) => [
				`${authorization.employeeId}:${authorization.classCode}`,
				authorization,
			]),
		);
		for (const next of current.preview.classes) {
			const row = rowsByClass.get(`${next.employeeId}:${next.classCode}`);
			if (!row) throw new Error("stale_preview");
			await tx
				.update(drivingAuthorization)
				.set({
					routineValidThrough: next.routineValidThrough,
					validThrough: next.validThrough,
					expiresAt: dateFromInstant(Temporal.Instant.from(next.expiresAt)),
				})
				.where(
					and(
						eq(drivingAuthorization.organizationId, actor.organizationId),
						eq(drivingAuthorization.id, row.id),
					),
				);
			if (next.newlyOverdue) {
				await tx
					.update(drivingAuthorization)
					.set({
						state: "suspended",
						suspensionReason: "check_overdue",
						suspendedAt: changedAt,
					})
					.where(
						and(
							eq(drivingAuthorization.organizationId, actor.organizationId),
							eq(drivingAuthorization.id, row.id),
						),
					);
				await tx.insert(drivingAuthorizationEvent).values({
					organizationId: actor.organizationId,
					employeeId: row.employeeId,
					employmentPeriodId: row.employmentPeriodId,
					classCode: row.classCode,
					checkId: row.supportingCheckId,
					kind: "suspended",
					reason: "check_overdue",
					effectiveAt: changedAt,
					recordedAt: changedAt,
					actorUserId: actor.userId,
				});
			}
			await tx.insert(drivingAuthorizationEvent).values({
				organizationId: actor.organizationId,
				employeeId: row.employeeId,
				employmentPeriodId: row.employmentPeriodId,
				classCode: row.classCode,
				checkId: row.supportingCheckId,
				kind: "policy_interval_changed",
				reason: `policy_version:${version}`,
				effectiveAt: changedAt,
				recordedAt: changedAt,
				actorUserId: actor.userId,
			});
		}
		await finishDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
			retentionBefore,
		);
		return current.preview;
	});
}
