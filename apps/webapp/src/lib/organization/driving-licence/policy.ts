import "server-only";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	drivingLicenceParticipant,
	drivingLicencePolicy,
	drivingLicencePolicyRevision,
} from "@/db/schema/driving-licence-policy";
import { employee } from "@/db/schema/organization";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
	readEffectiveDrivingAuthorization,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
export const drivingLicencePolicyInput = z
	.strictObject({
		enabled: z.boolean(),
		intervalMonths: z.number().int().min(1).max(120),
		timezone: z
			.string()
			.max(100)
			.refine((zone) => {
				try {
					Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(
						zone,
					);
					return zone.includes("/") || zone === "UTC";
				} catch {
					return false;
				}
			}),
		reminderLeadDays: z
			.array(z.number().int().min(0).max(365))
			.min(1)
			.max(12)
			.refine((days) => new Set(days).size === days.length),
		retentionMonths: z.number().int().min(1).max(120).nullable(),
		retentionJustification: z.string().trim().max(2000).nullable(),
	})
	.refine(
		(p) =>
			!p.enabled ||
			(p.retentionMonths !== null &&
				(p.retentionJustification?.length ?? 0) >= 10),
	);
export type DrivingLicencePolicyInput = z.infer<
	typeof drivingLicencePolicyInput
>;
export async function readDrivingLicencePolicy(organizationId: string) {
	const [policy] = await db
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	return policy ?? null;
}
export async function saveDrivingLicencePolicy(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const policy = drivingLicencePolicyInput.parse(raw);
	return db.transaction(async (tx) => {
		// Serialize configuration with checks, reports and lifecycle transitions.
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const [previous] = await tx
			.select()
			.from(drivingLicencePolicy)
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		// Once established, a finite policy survives deactivation and cannot be erased.
		if (
			previous?.retentionMonths &&
			(policy.retentionMonths === null ||
				(policy.retentionJustification?.length ?? 0) < 10)
		)
			throw new Error("retention_required");
		if (previous && previous.intervalMonths !== policy.intervalMonths)
			throw new Error("interval_preview_required");
		if (previous && previous.timezone !== policy.timezone)
			throw new Error("timezone_fixed");
		const now = systemClock.nowInstant();
		await materializeExpiredDrivingAuthorizations(
			tx,
			actor.organizationId,
			now,
		);
		const changedAt = dateFromInstant(now);
		const version = (previous?.version ?? 0) + 1;
		await tx
			.insert(drivingLicencePolicy)
			.values({
				...policy,
				organizationId: actor.organizationId,
				version,
				updatedAt: changedAt,
				updatedBy: actor.userId,
			})
			.onConflictDoUpdate({
				target: drivingLicencePolicy.organizationId,
				set: {
					...policy,
					version,
					updatedAt: changedAt,
					updatedBy: actor.userId,
				},
			});
		await tx.insert(drivingLicencePolicyRevision).values({
			organizationId: actor.organizationId,
			version,
			policy,
			changedAt,
			changedBy: actor.userId,
		});
		return policy;
	});
}
export async function listDrivingLicenceEmployees(organizationId: string) {
	return db
		.select({
			id: employee.id,
			name: user.name,
		})
		.from(employee)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				employeeHasOrganizationAccess(),
			),
		);
}
export async function enrollDrivingLicenceEmployee(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const { employeeId } = z.strictObject({ employeeId: z.uuid() }).parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const [policy] = await tx
			.select()
			.from(drivingLicencePolicy)
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		if (!policy?.enabled) throw new Error("not_enabled");
		const [target] = await tx
			.select({ id: employee.id })
			.from(employee)
			.innerJoin(
				member,
				and(
					eq(member.userId, employee.userId),
					eq(member.organizationId, employee.organizationId),
					eq(member.status, "approved"),
				),
			)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(employee.id, employeeId),
					employeeHasOrganizationAccess(),
				),
			);
		if (!target) throw new Error("forbidden");
		await tx
			.insert(drivingLicenceParticipant)
			.values({
				organizationId: actor.organizationId,
				employeeId,
				enrolledBy: actor.userId,
				enrolledAt: dateFromInstant(systemClock.nowInstant()),
			})
			.onConflictDoNothing();
		return {
			employeeId,
			status: "not_yet_checked" as const,
			authorizedClasses: [] as string[],
		};
	});
}
export async function listDrivingLicenceParticipants(organizationId: string) {
	const rows = await db
		.select({
			employeeId: drivingLicenceParticipant.employeeId,
			enrolledAt: drivingLicenceParticipant.enrolledAt,
		})
		.from(drivingLicenceParticipant)
		.where(eq(drivingLicenceParticipant.organizationId, organizationId));
	return Promise.all(
		rows.map(async (row) => {
			const status = await readEffectiveDrivingAuthorization(
				db,
				organizationId,
				row.employeeId,
			);
			return {
				...row,
				enrolledAt: row.enrolledAt.toISOString(),
				status: status.status,
				authorizedClasses: status.authorizedClasses,
			};
		}),
	);
}
